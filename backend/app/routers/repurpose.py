import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.database import get_db
from app.dependencies import get_current_user
from app.models.business_config import BusinessConfig
from app.models.seo_save import SeoSave
from app.models.user import User
from app.models.wallet import UsageLog, Wallet
from app.routers.seo import extract_seo_keywords
from app.schemas.repurpose import (
    ALL_PLATFORMS,
    ContentGoal,
    CtaStyle,
    RegenerateRequest,
    RegenerateResponse,
    RepurposeFormats,
    RepurposePatchRequest,
    RepurposePatchResponse,
    RepurposeRequest,
    RepurposeResponse,
    RepurposeSaveItem,
    VoicePreset,
)
from app.services.repurpose_service import regenerate_section, repurpose_content

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/repurpose", tags=["repurpose"])


REPURPOSE_CREDIT_COST = 1
# Phase B: free rerolls per save per day before credit is charged
FREE_REROLLS_PER_DAY = 3
REROLL_CREDIT_COST = 1
# Inline autosave payload guard — reject anything unreasonably large.
MAX_PATCH_PAYLOAD_BYTES = 512 * 1024


@router.post("", response_model=RepurposeResponse)
def create_repurpose(
    data: RepurposeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # 1. Wallet pre-check (credit deducted only after LLM success)
    wallet = db.query(Wallet).filter(Wallet.user_id == current_user.id).first()
    has_unlimited = bool(wallet and wallet.balance == -1)
    has_credits = bool(wallet and wallet.balance >= REPURPOSE_CREDIT_COST)
    if not wallet or (not has_unlimited and not has_credits):
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Insufficient credits. Please upgrade your plan.",
        )

    # 2. Resolve source content
    if data.blog_save_id:
        row = (
            db.query(SeoSave)
            .filter(
                SeoSave.id == data.blog_save_id,
                SeoSave.user_id == current_user.id,
                SeoSave.type == "blog",
            )
            .first()
        )
        if not row:
            raise HTTPException(status_code=404, detail="Blog save not found.")
        try:
            payload = json.loads(row.data or "{}")
        except json.JSONDecodeError:
            raise HTTPException(status_code=500, detail="Blog save is corrupted.")
        blog_title = str(payload.get("title") or row.title or "").strip()
        blog_content = str(payload.get("content") or "").strip()
        source_url = (data.source_url or "").strip()
        primary_keyword = (
            data.primary_keyword
            or str(payload.get("primary_keyword") or "").strip()
        )
        sec_from_blog = payload.get("secondary_keywords") or []
        secondary_keywords = (
            data.secondary_keywords
            or [str(k).strip() for k in sec_from_blog if str(k).strip()]
        )[:5]
    else:
        blog_title = (data.blog_title or "").strip()
        blog_content = (data.blog_content or "").strip()
        source_url = (data.source_url or "").strip()
        primary_keyword = (data.primary_keyword or "").strip()
        secondary_keywords = [k for k in (data.secondary_keywords or []) if k][:5]

    if len(blog_content) < 200:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Content too short to repurpose (needs at least 200 chars).",
        )

    # 3. Backfill keywords if the raw paste didn't include them
    if not primary_keyword:
        try:
            kw = extract_seo_keywords(
                blog_title or blog_content[:200],
                use_serp_grounding=False,
            )
            primary_keyword = (kw.get("primary_keyword") or "").strip()
            if not secondary_keywords:
                secondary_keywords = [
                    str(k).strip()
                    for k in (kw.get("secondary_keywords") or [])
                    if str(k).strip()
                ][:5]
        except Exception as e:
            logger.warning(f"[repurpose] keyword backfill failed: {e}")

    # 4. Optional business context
    biz = (
        db.query(BusinessConfig)
        .filter(BusinessConfig.user_id == current_user.id)
        .first()
    )
    business_name = (data.business_name or (biz.business_name if biz else "") or "").strip()
    niche = (data.niche or (biz.niche if biz else "") or "").strip()

    # 5. Generate
    try:
        formats_dict = repurpose_content(
            blog_title=blog_title,
            blog_content=blog_content,
            source_url=source_url,
            primary_keyword=primary_keyword,
            secondary_keywords=secondary_keywords,
            voice=data.voice.value,
            goal=data.goal.value,
            cta_style=data.cta_style.value,
            platforms=data.platforms,
            variations_per_platform=data.variations_per_platform,
            include_hook_variations=data.include_hook_variations,
            variations_across_voices=data.variations_across_voices,
            business_name=business_name,
            niche=niche,
        )
    except ValueError as e:
        # Parse / validation failures — don't charge
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e))
    except Exception as e:
        logger.error(f"[repurpose] generation failed for user {current_user.id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Repurpose failed — please retry.",
        )

    # 6. Deduct credit (only on success)
    if wallet.balance != -1:
        wallet.balance -= REPURPOSE_CREDIT_COST
    wallet.total_credits_used = (wallet.total_credits_used or 0) + REPURPOSE_CREDIT_COST
    db.add(
        UsageLog(
            wallet_id=wallet.id,
            action="repurpose",
            credits_used=REPURPOSE_CREDIT_COST,
            description=(
                f"Repurposed blog ({data.voice.value}/{data.goal.value}, "
                f"{len(data.platforms)} platforms): {blog_title[:60]}"
            ),
        )
    )

    # 7. Persist output
    save_payload = {
        "source_url": source_url,
        "primary_keyword": primary_keyword,
        "secondary_keywords": secondary_keywords,
        "blog_title": blog_title,
        "blog_save_id": data.blog_save_id,
        "voice": data.voice.value,
        "goal": data.goal.value,
        "cta_style": data.cta_style.value,
        "platforms": data.platforms,
        "variations_per_platform": data.variations_per_platform,
        "variations_across_voices": data.variations_across_voices,
        "formats": formats_dict,
    }
    save = SeoSave(
        user_id=current_user.id,
        type="repurpose",
        title=(blog_title or "Repurpose")[:500],
        data=json.dumps(save_payload),
    )
    db.add(save)
    db.commit()
    db.refresh(save)

    keywords_used = [k for k in ([primary_keyword] + secondary_keywords) if k]

    return RepurposeResponse(
        save_id=save.id,
        source_url=source_url,
        primary_keyword=primary_keyword,
        keywords_used=keywords_used,
        voice=data.voice,
        goal=data.goal,
        platforms=data.platforms,
        formats=RepurposeFormats(**formats_dict),
    )


@router.get("/saves", response_model=list[RepurposeSaveItem])
def list_repurpose_saves(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    saves = (
        db.query(SeoSave)
        .filter(SeoSave.user_id == current_user.id, SeoSave.type == "repurpose")
        .order_by(SeoSave.created_at.desc())
        .limit(100)
        .all()
    )
    out: list[RepurposeSaveItem] = []
    for s in saves:
        try:
            payload = json.loads(s.data or "{}")
        except json.JSONDecodeError:
            payload = {}
        out.append(
            RepurposeSaveItem(
                id=s.id,
                title=s.title or "Repurpose",
                source_url=str(payload.get("source_url") or ""),
                primary_keyword=str(payload.get("primary_keyword") or ""),
                created_at=s.created_at.isoformat(),
                updated_at=s.updated_at.isoformat(),
            )
        )
    return out


@router.get("/saves/{save_id}", response_model=RepurposeResponse)
def get_repurpose_save(
    save_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    save = (
        db.query(SeoSave)
        .filter(
            SeoSave.id == save_id,
            SeoSave.user_id == current_user.id,
            SeoSave.type == "repurpose",
        )
        .first()
    )
    if not save:
        raise HTTPException(status_code=404, detail="Repurpose save not found.")
    try:
        payload = json.loads(save.data or "{}")
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Repurpose save is corrupted.")

    primary_keyword = str(payload.get("primary_keyword") or "")
    secondary_keywords = list(payload.get("secondary_keywords") or [])
    keywords_used = [k for k in ([primary_keyword] + secondary_keywords) if k]

    # Voice/goal may be missing on old saves; fall back to defaults.
    try:
        voice = VoicePreset(payload.get("voice") or VoicePreset.founder_pov.value)
    except ValueError:
        voice = VoicePreset.founder_pov
    try:
        goal = ContentGoal(payload.get("goal") or ContentGoal.authority.value)
    except ValueError:
        goal = ContentGoal.authority
    platforms = list(payload.get("platforms") or ALL_PLATFORMS)

    return RepurposeResponse(
        save_id=save.id,
        source_url=str(payload.get("source_url") or ""),
        primary_keyword=primary_keyword,
        keywords_used=keywords_used,
        voice=voice,
        goal=goal,
        platforms=platforms,
        formats=RepurposeFormats(**(payload.get("formats") or {})),
    )


@router.delete("/saves/{save_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_repurpose_save(
    save_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    save = (
        db.query(SeoSave)
        .filter(
            SeoSave.id == save_id,
            SeoSave.user_id == current_user.id,
            SeoSave.type == "repurpose",
        )
        .first()
    )
    if not save:
        raise HTTPException(status_code=404, detail="Repurpose save not found.")
    db.delete(save)
    db.commit()


# ---------------------------------------------------------------------------
# Phase B — per-section regenerate
# ---------------------------------------------------------------------------

def _today_utc_iso() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _rerolls_remaining(payload: dict) -> int:
    """Return free rerolls left today for this save (0..FREE_REROLLS_PER_DAY)."""
    today = _today_utc_iso()
    if payload.get("reroll_date") != today:
        return FREE_REROLLS_PER_DAY
    used = int(payload.get("reroll_count_today") or 0)
    return max(0, FREE_REROLLS_PER_DAY - used)


def _increment_reroll(payload: dict) -> None:
    today = _today_utc_iso()
    if payload.get("reroll_date") != today:
        payload["reroll_date"] = today
        payload["reroll_count_today"] = 0
    payload["reroll_count_today"] = int(payload.get("reroll_count_today") or 0) + 1


@router.post("/saves/{save_id}/regenerate", response_model=RegenerateResponse)
def regenerate_repurpose_section(
    save_id: str,
    data: RegenerateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # 1. Load the save
    save = (
        db.query(SeoSave)
        .filter(
            SeoSave.id == save_id,
            SeoSave.user_id == current_user.id,
            SeoSave.type == "repurpose",
        )
        .first()
    )
    if not save:
        raise HTTPException(status_code=404, detail="Repurpose save not found.")
    try:
        payload = json.loads(save.data or "{}")
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Repurpose save is corrupted.")

    existing_formats = payload.get("formats") or {}

    # 2. Decide if this reroll is free or costs a credit.
    free_left = _rerolls_remaining(payload)
    credits_charged = 0
    wallet: Wallet | None = None
    if free_left <= 0:
        wallet = db.query(Wallet).filter(Wallet.user_id == current_user.id).first()
        has_unlimited = bool(wallet and wallet.balance == -1)
        has_credits = bool(wallet and wallet.balance >= REROLL_CREDIT_COST)
        if not wallet or (not has_unlimited and not has_credits):
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail=(
                    "Daily free rerolls exhausted. Next reroll costs 1 credit — "
                    "but you have no credits. Please upgrade."
                ),
            )
        credits_charged = REROLL_CREDIT_COST

    # 3. Resolve blog content — prefer the source blog save, else the persisted content.
    blog_title = str(payload.get("blog_title") or "")
    blog_content = ""
    blog_save_id = payload.get("blog_save_id")
    if blog_save_id:
        blog_row = (
            db.query(SeoSave)
            .filter(
                SeoSave.id == blog_save_id,
                SeoSave.user_id == current_user.id,
                SeoSave.type == "blog",
            )
            .first()
        )
        if blog_row:
            try:
                blog_payload = json.loads(blog_row.data or "{}")
                blog_content = str(blog_payload.get("content") or "").strip()
                if not blog_title:
                    blog_title = str(blog_payload.get("title") or "").strip()
            except json.JSONDecodeError:
                pass
    # Fallback — reuse the longest LinkedIn post + all quotes + carousel as pseudo-content.
    # This only happens for paste-mode saves where we never stored the original content.
    if not blog_content:
        fragments: list[str] = []
        for key in ("linkedin_posts", "facebook_posts", "instagram_captions"):
            v = existing_formats.get(key)
            if isinstance(v, list):
                fragments.extend(v)
        v = existing_formats.get("email") or {}
        if isinstance(v, dict) and v.get("body"):
            fragments.append(v["body"])
        yt = existing_formats.get("youtube_description")
        if yt:
            fragments.append(yt)
        blog_content = ("\n\n".join(x for x in fragments if x)).strip() or (
            blog_title or "Generate fresh variations for this section."
        )

    source_url = str(payload.get("source_url") or "")
    primary_keyword = str(payload.get("primary_keyword") or "")
    secondary_keywords = list(payload.get("secondary_keywords") or [])
    voice = str(payload.get("voice") or VoicePreset.founder_pov.value)
    goal = str(payload.get("goal") or ContentGoal.authority.value)
    cta_style = str(payload.get("cta_style") or CtaStyle.soft.value)
    variations_per_platform = int(payload.get("variations_per_platform") or 1)

    biz = (
        db.query(BusinessConfig)
        .filter(BusinessConfig.user_id == current_user.id)
        .first()
    )
    business_name = (biz.business_name if biz else "") or ""
    niche = (biz.niche if biz else "") or ""

    # 4. Regenerate
    try:
        updated_formats = regenerate_section(
            section=data.section,
            variant_index=data.variant_index,
            preset=data.preset,
            instruction=data.instruction,
            existing_formats=existing_formats,
            blog_title=blog_title,
            blog_content=blog_content,
            source_url=source_url,
            primary_keyword=primary_keyword,
            secondary_keywords=secondary_keywords,
            voice=voice,
            goal=goal,
            cta_style=cta_style,
            variations_per_platform=variations_per_platform,
            business_name=business_name,
            niche=niche,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e))
    except Exception as e:
        logger.error(f"[repurpose.regen] failed for user {current_user.id}/{save_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Regenerate failed — please retry.",
        )

    # 5. Persist + charge (only on success)
    _increment_reroll(payload)
    payload["formats"] = updated_formats
    save.data = json.dumps(payload)
    flag_modified(save, "data")

    if credits_charged > 0 and wallet is not None:
        if wallet.balance != -1:
            wallet.balance -= credits_charged
        wallet.total_credits_used = (wallet.total_credits_used or 0) + credits_charged
        db.add(
            UsageLog(
                wallet_id=wallet.id,
                action="repurpose.regen",
                credits_used=credits_charged,
                description=f"Regenerated {data.section} (paid) on save {save.id}",
            )
        )

    db.commit()
    db.refresh(save)

    return RegenerateResponse(
        section=data.section,
        variant_index=data.variant_index,
        formats=RepurposeFormats(**updated_formats),
        free_rerolls_remaining=_rerolls_remaining(payload),
        credits_charged=credits_charged,
    )


# ---------------------------------------------------------------------------
# Phase B — inline autosave
# ---------------------------------------------------------------------------

@router.patch("/saves/{save_id}", response_model=RepurposePatchResponse)
def patch_repurpose_save(
    save_id: str,
    data: RepurposePatchRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Replace the `formats` block of a repurpose save (inline-edit autosave).

    Cheap & idempotent — no LLM call, no credit cost.
    """
    save = (
        db.query(SeoSave)
        .filter(
            SeoSave.id == save_id,
            SeoSave.user_id == current_user.id,
            SeoSave.type == "repurpose",
        )
        .first()
    )
    if not save:
        raise HTTPException(status_code=404, detail="Repurpose save not found.")

    new_formats = data.formats.model_dump()
    serialized = json.dumps(new_formats)
    if len(serialized) > MAX_PATCH_PAYLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Formats payload exceeds {MAX_PATCH_PAYLOAD_BYTES} bytes.",
        )

    try:
        payload = json.loads(save.data or "{}")
    except json.JSONDecodeError:
        payload = {}
    payload["formats"] = new_formats
    save.data = json.dumps(payload)
    flag_modified(save, "data")
    db.commit()
    db.refresh(save)

    return RepurposePatchResponse(
        save_id=save.id,
        updated_at=save.updated_at.isoformat(),
    )
