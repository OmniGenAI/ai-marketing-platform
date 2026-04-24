"""
API endpoints for Instagram Reel generation and publishing.

Two-phase flow:
  1. POST /api/reels                — generates SCRIPT + SEO keywords synchronously
                                      (no credits), returns status="script_ready".
  2. POST /api/reels/{id}/generate-video — charges REEL_CREDIT_COST and kicks off
                                           the video pipeline in the background.
"""
import asyncio
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
from app.services.social import publish_to_instagram_reels

router = APIRouter(prefix="/api/reels", tags=["reels"])

# Cost per video render — charged only when the user confirms they want the video.
REEL_CREDIT_COST = 4

REEL_PIPELINE_TIMEOUT_S = 15 * 60


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
        # Never leak upstream provider text — it can include headers / keys.
        print(f"[Reel] Script generation failed: {exc}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to generate script. Please try again.",
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

    # Atomic idempotency guard: only transition from script_ready/failed → generating_audio
    # in a single UPDATE so a double-click can't spawn two pipelines or double-charge.
    transition = db.execute(
        update(Reel)
        .where(and_(
            Reel.id == reel_id,
            Reel.user_id == current_user.id,
            Reel.status.in_(("script_ready", "failed")),
        ))
        .values(status="generating_audio", error_message=None)
    )
    if transition.rowcount == 0:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"Video generation already in progress or completed (status: {reel.status}).",
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
            timeout=REEL_PIPELINE_TIMEOUT_S,
        )
    except asyncio.TimeoutError:
        print(f"[Reel {reel_id}] pipeline deadline exceeded — refunding credits")
        _mark_reel_failed(db, reel_id, "Video generation timed out")
        _refund_reel_credits(db, user_id, f"reel {reel_id} timed out")
    except Exception as e:
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
    caption_override: str | None = None  # SEO caption built on the frontend


@router.post("/{reel_id}/publish", response_model=ReelResponse)
async def publish_reel(
    reel_id: str,
    payload: PublishReelRequest | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Publish a reel to Instagram."""
    # Get the reel
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

    if reel.status != "ready":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Reel is not ready for publishing. Current status: {reel.status}",
        )

    if not reel.video_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reel has no video URL",
        )

    # Get Instagram account
    instagram_account = (
        db.query(SocialAccount)
        .filter(
            SocialAccount.user_id == current_user.id,
            SocialAccount.platform == "instagram",
        )
        .first()
    )

    if not instagram_account:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No Instagram account connected. Please connect your Instagram account first.",
        )
    if payload and payload.caption_override and payload.caption_override.strip():
        caption = payload.caption_override.strip()
    else:
        caption = reel.script or ""
        if reel.hashtags:
            caption = f"{caption}\n\n{reel.hashtags}"

    try:
        # Publish to Instagram Reels
        result = await publish_to_instagram_reels(
            instagram_account_id=instagram_account.page_id,
            access_token=instagram_account.access_token,
            video_url=reel.video_url,
            caption=caption,
            thumbnail_url=reel.thumbnail_url,
        )

        # Update reel status
        reel.status = "published"
        reel.published_at = datetime.now(timezone.utc)
        reel.instagram_media_id = result.get("id")
        db.commit()
        db.refresh(reel)

        return reel

    except Exception as e:
        reel.status = "publish_failed"
        reel.error_message = str(e)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to publish reel: {str(e)}",
        )


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
