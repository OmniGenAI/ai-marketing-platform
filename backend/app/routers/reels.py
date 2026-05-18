"""
API endpoints for Instagram Reel generation and publishing.

Two-phase flow:
  1. POST /api/reels                — generates SCRIPT + SEO keywords synchronously
                                      (no credits), returns status="script_ready".
  2. POST /api/reels/{id}/generate-video — charges REEL_CREDIT_COST and kicks off
                                           the video pipeline in the background.
"""
import asyncio
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy import and_, update
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.models.reel import Reel
from app.models.business_config import BusinessConfig
from app.models.wallet import Wallet, UsageLog
from app.models.social_account import SocialAccount
from app.schemas.reel import (
    ReelGenerateRequest,
    ReelResponse,
    VoicesResponse,
    VoiceOption,
)
from app.dependencies import get_current_user
from app.services.reel_service import (
    get_available_voices,
    generate_reel_script,
    process_reel_generation,
)
from app.routers.seo import extract_seo_keywords, _slug_to_hashtag
from app.models.seo_save import SeoSave
import json as _json
from app.services.social import (
    publish_to_instagram_reels,
    publish_to_facebook_reel,
    publish_to_linkedin_video,
    publish_to_youtube_short,
    publish_to_reddit_video,
)

from app.services.credits import COST_REEL_VIDEO, COST_REEL_CANCEL

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/reels", tags=["reels"])

# Cost per video render — charged only when the user confirms they want the
# video. Sourced from settings via app.services.credits so the value is
# env-tunable and the frontend can read it from /api/credits/costs.
REEL_CREDIT_COST = COST_REEL_VIDEO

REEL_PIPELINE_TIMEOUT_S = 15 * 60


def _pipeline_timeout_for(duration_target: int) -> int:
    """xAI grok-imagine-video maxes out at 15s per clip, so a 60s reel needs
    4 sequential/parallel segment generations + merge + TTS + upload. Scale
    the wall-clock budget with the requested duration so a 60s reel doesn't
    inherit the same 15-minute deadline as a 15s reel."""
    if duration_target <= 15:
        return 15 * 60
    if duration_target <= 30:
        return 25 * 60
    return 40 * 60  # 60s+ — 4 segments in parallel + compose


def _refund_reel_credits(db: Session, user_id: str, reason: str) -> None:
    """Credit back REEL_CREDIT_COST after a pipeline failure. No-op for unlimited wallets."""
    wallet = db.query(Wallet).filter(Wallet.user_id == user_id).first()
    if not wallet or wallet.balance == -1:
        return
    wallet.balance += REEL_CREDIT_COST
    wallet.total_credits_used = max(0, wallet.total_credits_used - REEL_CREDIT_COST)
    db.add(UsageLog(
        wallet_id=wallet.id,
        action="refund_reel_video",
        credits_used=-REEL_CREDIT_COST,
        description=f"Refund: {reason[:200]}",
    ))
    db.commit()


@router.get("/voices", response_model=VoicesResponse)
def list_voices():
    """Get list of available TTS voices for reel generation."""
    voices = get_available_voices()
    return VoicesResponse(
        voices=[VoiceOption(**v) for v in voices]
    )


@router.post("", response_model=ReelResponse)
def create_reel(
    data: ReelGenerateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Phase 1: generate the SEO-optimised script synchronously so the user can
    review it before spending credits on video rendering.

    Steps:
      1. Extract primary keyword + hashtags from the topic (SEO-first).
      2. Generate the script with the keyword injected into the prompt.
      3. Persist script/hashtags/primary_keyword and return status="script_ready".

    No credits are deducted here — the credit charge happens in
    POST /api/reels/{id}/generate-video once the user approves the script.
    """
    # Pre-check wallet so the user isn't surprised later — but don't deduct.
    wallet = db.query(Wallet).filter(Wallet.user_id == current_user.id).first()
    has_unlimited = wallet and wallet.balance == -1
    has_credits = wallet and wallet.balance >= REEL_CREDIT_COST
    if not wallet or (not has_unlimited and not has_credits):
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=f"Insufficient credits. Video generation requires {REEL_CREDIT_COST} credits.",
        )

    config = (
        db.query(BusinessConfig)
        .filter(BusinessConfig.user_id == current_user.id)
        .first()
    )

    # --- 1. SEO-first: reuse an existing brief if provided, else extract fresh
    primary_keyword = ""
    seo_hashtags: list[str] = []
    if data.seo_save_id:
        brief_row = (
            db.query(SeoSave)
            .filter(
                SeoSave.id == data.seo_save_id,
                SeoSave.user_id == current_user.id,
                SeoSave.type == "brief",
            )
            .first()
        )
        if brief_row:
            try:
                brief = _json.loads(brief_row.data)
                primary_keyword = (brief.get("primary_keyword") or "").strip()
                # Build hashtags from the brief's primary + top secondary keywords.
                pool = [primary_keyword] + list(brief.get("secondary_keywords") or [])
                seen: set[str] = set()
                for term in pool:
                    tag = _slug_to_hashtag(term or "")
                    if tag and tag.lower() not in seen:
                        seen.add(tag.lower())
                        seo_hashtags.append(tag)
                    if len(seo_hashtags) >= 5:
                        break
            except Exception as exc:
                print(f"[Reel] Failed to reuse brief {data.seo_save_id}: {exc}")

    # Fallback: derive from topic (SERP-grounded LLM call).
    if not primary_keyword or not seo_hashtags:
        try:
            seo = extract_seo_keywords(data.topic)
        except Exception as exc:
            print(f"[Reel] Keyword extraction failed, continuing: {exc}")
            seo = {"primary_keyword": "", "hashtags": []}
        primary_keyword = primary_keyword or seo.get("primary_keyword", "")
        seo_hashtags = seo_hashtags or (seo.get("hashtags", []) or [])

    # --- 2. Generate script synchronously ---------------------------------
    try:
        script_result = generate_reel_script(
            topic=data.topic,
            tone=data.tone,
            duration_target=data.duration_target,
            business_name=config.business_name if config else "",
            niche=config.niche if config else "",
            primary_keyword=primary_keyword,
            description=data.description,
        )
    except Exception as exc:
        # Log the full chain for Render Logs; surface a short reason in the
        # API response so the frontend can show *which* provider/cause failed
        # without leaking secrets (the underlying providers are quoted by
        # name, not by raw error text from their HTTP responses).
        import traceback
        traceback.print_exc()
        print(f"[Reel] Script generation failed: {exc}")
        reason = str(exc)[:200] or type(exc).__name__
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to generate script: {reason}",
        )

    # Prefer SEO-researched hashtags over whatever the LLM freestyled; fall
    # back to the LLM's list only if keyword extraction came back empty.
    hashtags_text = (
        " ".join(f"#{h}" for h in seo_hashtags)
        if seo_hashtags
        else (script_result.get("hashtags") or "")
    )

    reel = Reel(
        user_id=current_user.id,
        topic=data.topic,
        tone=data.tone,
        voice=data.voice,
        duration_target=data.duration_target,
        script=script_result.get("script", ""),
        hashtags=hashtags_text,
        primary_keyword=primary_keyword or None,
        status="script_ready",
    )
    db.add(reel)
    db.commit()
    db.refresh(reel)
    return reel


@router.post("/{reel_id}/generate-video", response_model=ReelResponse)
def generate_video(
    reel_id: str,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Phase 2: charge credits and start the background video pipeline
    (voiceover → AI/stock video → compose → upload → thumbnail).
    """
    reel = (
        db.query(Reel)
        .filter(Reel.id == reel_id, Reel.user_id == current_user.id)
        .first()
    )
    if not reel:
        raise HTTPException(status_code=404, detail="Reel not found")

    if not (reel.script or "").strip():
        raise HTTPException(
            status_code=400,
            detail="Reel has no script yet — generate the script first.",
        )

    wallet = db.query(Wallet).filter(Wallet.user_id == current_user.id).first()
    has_unlimited = wallet and wallet.balance == -1
    has_credits = wallet and wallet.balance >= REEL_CREDIT_COST
    if not wallet or (not has_unlimited and not has_credits):
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=f"Insufficient credits. Video generation requires {REEL_CREDIT_COST} credits.",
        )

    # Atomic idempotency guard: only transition from a terminal-ish status
    # (script_ready / failed / ready / published) into generating_audio in a
    # single UPDATE so a double-click can't spawn two pipelines or
    # double-charge. ``ready`` and ``published`` are included so users can
    # explicitly regenerate a finished reel (e.g. when stock fallback was
    # used and they want to retry the AI path).
    transition = db.execute(
        update(Reel)
        .where(and_(
            Reel.id == reel_id,
            Reel.user_id == current_user.id,
            Reel.status.in_(("script_ready", "failed", "ready", "published")),
        ))
        .values(status="generating_audio", error_message=None)
    )
    if transition.rowcount == 0:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"Video generation already in progress (status: {reel.status}).",
        )

    config = (
        db.query(BusinessConfig)
        .filter(BusinessConfig.user_id == current_user.id)
        .first()
    )

    if wallet.balance != -1:
        wallet.balance -= REEL_CREDIT_COST
    wallet.total_credits_used += REEL_CREDIT_COST

    db.add(UsageLog(
        wallet_id=wallet.id,
        action="generate_reel_video",
        credits_used=REEL_CREDIT_COST,
        description=f"Generated Reel video: {reel.topic[:50]}",
    ))
    db.commit()
    db.refresh(reel)

    background_tasks.add_task(
        run_reel_generation,
        reel_id=reel.id,
        topic=reel.topic,
        tone=reel.tone,
        voice=reel.voice,
        duration_target=reel.duration_target,
        user_id=current_user.id,
        business_name=config.business_name if config else "",
        niche=config.niche if config else "",
        primary_keyword=reel.primary_keyword or "",
    )
    return reel


# In-progress statuses that can be cancelled. Anything in a terminal state
# (ready / published / failed / cancelled) is rejected with a 409.
_CANCELLABLE_STATUSES = {
    "generating_audio",
    "fetching_videos",
    "generating_ai_video",
    "downloading_videos",
    "composing_video",
    "processing_video",
    "generating",  # legacy / future status names
    "rendering",
}


@router.post("/{reel_id}/cancel", response_model=ReelResponse)
def cancel_video_generation(
    reel_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Cancel an in-flight reel video render.

    Flow:
      1. Verify the reel is in a cancellable status.
      2. Atomically flip status -> "cancel_requested" so the background
         pipeline picks it up at the next checkpoint.
      3. Refund the original REEL_VIDEO credit charge MINUS a small cancel
         fee (REEL_CANCEL_CREDIT_COST) so we recover what was already spent
         on the half-finished render (TTS / partial Sora call).
      4. Log the refund + cancel-fee as separate UsageLog entries.

    The pipeline polls the reel status at every checkpoint and raises
    ReelCancelledError when it sees "cancel_requested" — that path commits
    status="cancelled" and skips the generic-failure refund branch.
    """
    reel = (
        db.query(Reel)
        .filter(Reel.id == reel_id, Reel.user_id == current_user.id)
        .first()
    )
    if not reel:
        raise HTTPException(status_code=404, detail="Reel not found")

    if reel.status not in _CANCELLABLE_STATUSES:
        raise HTTPException(
            status_code=409,
            detail=f"Reel is not generating (status: {reel.status}).",
        )

    # Atomic transition — only one cancel wins if the user double-clicks.
    transition = db.execute(
        update(Reel)
        .where(and_(
            Reel.id == reel_id,
            Reel.user_id == current_user.id,
            Reel.status.in_(tuple(_CANCELLABLE_STATUSES)),
        ))
        .values(status="cancel_requested", error_message="Cancel requested by user")
    )
    if transition.rowcount == 0:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Cancel already in progress or pipeline already finished.",
        )

    # Refund accounting: give back the video cost, then charge the cancel
    # fee in a separate ledger entry so both numbers are auditable.
    wallet = db.query(Wallet).filter(Wallet.user_id == current_user.id).first()
    if wallet:
        try:
            net_refund = max(0, COST_REEL_VIDEO - COST_REEL_CANCEL)
            if wallet.balance != -1:
                wallet.balance += net_refund
            wallet.total_credits_used = max(
                0, (wallet.total_credits_used or 0) - net_refund
            )
            db.add(UsageLog(
                wallet_id=wallet.id,
                action="refund_reel_video",
                credits_used=-COST_REEL_VIDEO,
                description=f"Refund: cancelled reel {reel_id}",
            ))
            db.add(UsageLog(
                wallet_id=wallet.id,
                action="cancel_reel_video",
                credits_used=COST_REEL_CANCEL,
                description=f"Cancel fee for reel {reel_id}",
            ))
        except Exception as e:
            db.rollback()
            print(f"[Reel {reel_id}] Cancel refund failed: {e}")
            raise HTTPException(
                status_code=500, detail="Cancel saved but refund failed."
            )

    db.commit()
    db.refresh(reel)
    return reel


async def run_reel_generation(
    reel_id: str,
    topic: str,
    tone: str,
    voice: str,
    duration_target: int,
    user_id: str,
    business_name: str,
    niche: str,
    primary_keyword: str = "",
):
    """Background wrapper: enforce a deadline, refund credits on failure.

    NOTE: FastAPI `BackgroundTasks` dies with the process and has no retry. For
    production durability move this to a real worker (Celery/Arq/RQ). The code
    here is structured so that refunds happen on any failure path including the
    wall-clock timeout.
    """
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        await asyncio.wait_for(
            process_reel_generation(
                reel_id=reel_id,
                topic=topic,
                tone=tone,
                voice=voice,
                duration_target=duration_target,
                user_id=user_id,
                business_name=business_name,
                niche=niche,
                primary_keyword=primary_keyword,
                db_session=db,
            ),
            timeout=_pipeline_timeout_for(duration_target),
        )
    except asyncio.TimeoutError:
        print(f"[Reel {reel_id}] pipeline deadline exceeded — refunding credits")
        _mark_reel_failed(db, reel_id, "Video generation timed out")
        _refund_reel_credits(db, user_id, f"reel {reel_id} timed out")
    except Exception as e:
        # User cancels are handled separately — the /cancel endpoint already
        # refunded (minus the cancel fee), so we must NOT double-refund here.
        from app.services.reel_service import ReelCancelledError
        if isinstance(e, ReelCancelledError):
            print(f"[Reel {reel_id}] cancelled — refund already handled by /cancel")
        else:
            # process_reel_generation already persists the failed status; we just refund.
            print(f"[Reel {reel_id}] pipeline failed: {e} — refunding credits")
            _refund_reel_credits(db, user_id, f"reel {reel_id}: {e}")
    finally:
        db.close()


def _mark_reel_failed(db: Session, reel_id: str, message: str) -> None:
    reel = db.query(Reel).filter(Reel.id == reel_id).first()
    if reel:
        reel.status = "failed"
        reel.error_message = message[:500]
        db.commit()


@router.get("", response_model=list[ReelResponse])
def list_reels(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    skip: int = 0,
    limit: int = 20,
):
    """Get list of user's reels, newest first."""
    reels = (
        db.query(Reel)
        .filter(Reel.user_id == current_user.id)
        .order_by(Reel.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return reels


@router.get("/{reel_id}", response_model=ReelResponse)
def get_reel(
    reel_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get a specific reel by ID."""
    reel = (
        db.query(Reel)
        .filter(Reel.id == reel_id, Reel.user_id == current_user.id)
        .first()
    )
    if not reel:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Reel not found",
        )
    return reel


class PublishReelRequest(BaseModel):
    caption_override: str | None = None       # SEO caption built on the frontend
    platforms: list[str] | None = None        # Multi-platform: instagram, facebook, linkedin, youtube, reddit


# Map platform key → (publish function, social account platform name to look up)
# Each entry receives the resolved SocialAccount and Reel and returns the dict result.
async def _publish_reel_to_platform(
    platform: str, account: SocialAccount, reel: Reel, caption: str
) -> dict:
    if platform == "instagram":
        return await publish_to_instagram_reels(
            instagram_account_id=account.page_id,
            access_token=account.access_token,
            video_url=reel.video_url,
            caption=caption,
            thumbnail_url=reel.thumbnail_url,
        )
    if platform == "facebook":
        return await publish_to_facebook_reel(
            page_id=account.page_id,
            access_token=account.access_token,
            video_url=reel.video_url,
            caption=caption,
        )
    if platform == "linkedin":
        return await publish_to_linkedin_video(
            member_urn=account.page_id,
            access_token=account.access_token,
            video_url=reel.video_url,
            caption=caption,
        )
    if platform == "youtube":
        # Tags derived from the reel's hashtags (#tag → tag)
        tags = [t.lstrip("#") for t in (reel.hashtags or "").split() if t.startswith("#")][:30]
        return await publish_to_youtube_short(
            access_token=account.access_token,
            video_url=reel.video_url,
            title=(reel.topic or "Reel")[:100],
            description=caption,
            tags=tags,
        )
    if platform == "reddit":
        return await publish_to_reddit_video(
            username=account.page_id,
            access_token=account.access_token,
            video_url=reel.video_url,
            caption=caption,
        )
    raise ValueError(f"Unsupported platform for reel publish: {platform}")


async def _run_reel_publish(
    reel_id: str,
    user_id: str,
    targets: list[str],
    caption: str,
) -> None:
    """Background worker: actually publishes the reel to each target platform.

    Runs after the HTTP response is sent so the request handler isn't held
    open while Instagram processes the video (up to 5 minutes of polling).
    Render's platform-level request timeout would otherwise kill the
    connection and return a non-app 500 without CORS headers.

    The frontend polls GET /api/reels/{id} until status flips from
    "publishing" → "published" / "publish_failed".
    """
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        reel = (
            db.query(Reel)
            .filter(Reel.id == reel_id, Reel.user_id == user_id)
            .first()
        )
        if not reel:
            logger.warning(f"[Reel {reel_id}] vanished before background publish started")
            return

        # Re-resolve accounts in the worker's session (the request session is
        # already closed by the time we get here).
        accounts: dict[str, SocialAccount] = {}
        for plat in targets:
            acct = (
                db.query(SocialAccount)
                .filter(
                    SocialAccount.user_id == user_id,
                    SocialAccount.platform == plat,
                )
                .first()
            )
            if not acct:
                reel.status = "publish_failed"
                reel.error_message = f"No {plat} account connected"
                db.commit()
                return
            accounts[plat] = acct

        results: dict[str, dict] = {}
        failures: dict[str, str] = {}
        for plat in targets:
            try:
                results[plat] = await _publish_reel_to_platform(plat, accounts[plat], reel, caption)
            except Exception as e:
                logger.exception(f"[Reel {reel_id}] publish to {plat} failed")
                failures[plat] = str(e)

        if not results:
            reel.status = "publish_failed"
            reel.error_message = ("; ".join(f"{p}: {e}" for p, e in failures.items()))[:500]
        else:
            reel.status = "published"
            reel.published_at = datetime.now(timezone.utc)
            if "instagram" in results:
                reel.instagram_media_id = results["instagram"].get("id")
            if failures:
                reel.error_message = ("Partial failure: " + "; ".join(f"{p}: {e}" for p, e in failures.items()))[:500]
            else:
                reel.error_message = None
        db.commit()
    except Exception:
        logger.exception(f"[Reel {reel_id}] background publish crashed")
        try:
            db.rollback()
            reel = db.query(Reel).filter(Reel.id == reel_id).first()
            if reel and reel.status == "publishing":
                reel.status = "publish_failed"
                reel.error_message = "Unexpected error during publish"
                db.commit()
        except Exception:
            db.rollback()
    finally:
        db.close()


@router.post("/{reel_id}/publish", response_model=ReelResponse)
async def publish_reel(
    reel_id: str,
    background_tasks: BackgroundTasks,
    payload: PublishReelRequest | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Kick off a background publish to one or more platforms.

    Returns immediately with reel.status="publishing" so the HTTP request
    doesn't sit open while Instagram processes the video (up to ~5 minutes,
    which exceeds Render's platform request timeout). The frontend polls
    GET /api/reels/{id} for the final status transition.
    """
    reel = (
        db.query(Reel)
        .filter(Reel.id == reel_id, Reel.user_id == current_user.id)
        .first()
    )
    if not reel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reel not found")

    if not reel.video_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reel has no video URL",
        )

    # Resolve target platforms: payload override → reel.platform → instagram default
    if payload and payload.platforms:
        targets = [p.lower() for p in payload.platforms if p]
    else:
        targets = [(reel.platform or "instagram").lower()]

    if not targets:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No platforms selected")

    # Verify connected accounts up-front so a missing connection surfaces as
    # a clear 400 in the response instead of failing silently in the worker.
    for plat in targets:
        acct = (
            db.query(SocialAccount)
            .filter(
                SocialAccount.user_id == current_user.id,
                SocialAccount.platform == plat,
            )
            .first()
        )
        if not acct:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"No {plat} account connected. Please connect it in Settings.",
            )

    # Build caption (override or default content+hashtags)
    if payload and payload.caption_override and payload.caption_override.strip():
        caption = payload.caption_override.strip()
    else:
        caption = reel.script or ""
        if reel.hashtags:
            caption = f"{caption}\n\n{reel.hashtags}"

    # Atomic transition into "publishing" — a double-click can't enqueue two
    # background publishes. Allow entry from "ready", "published" (republish),
    # and "publish_failed" (retry).
    transition = db.execute(
        update(Reel)
        .where(and_(
            Reel.id == reel_id,
            Reel.user_id == current_user.id,
            Reel.status.in_(("ready", "published", "publish_failed")),
        ))
        .values(status="publishing", error_message=None)
    )
    if transition.rowcount == 0:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Reel is not ready for publishing. Current status: {reel.status}",
        )
    db.commit()
    db.refresh(reel)

    background_tasks.add_task(
        _run_reel_publish,
        reel_id=reel.id,
        user_id=current_user.id,
        targets=targets,
        caption=caption,
    )

    return reel


@router.delete("/{reel_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_reel(
    reel_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a reel."""
    reel = (
        db.query(Reel)
        .filter(Reel.id == reel_id, Reel.user_id == current_user.id)
        .first()
    )
    if not reel:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Reel not found",
        )

    db.delete(reel)
    db.commit()
    return None
