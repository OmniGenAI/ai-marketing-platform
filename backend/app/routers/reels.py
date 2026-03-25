"""
API endpoints for Instagram Reel generation and publishing.
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
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
    process_reel_generation,
)
from app.services.social import publish_to_instagram_reels

router = APIRouter(prefix="/api/reels", tags=["reels"])

# Cost per reel generation
REEL_CREDIT_COST = 4


@router.get("/voices", response_model=VoicesResponse)
def list_voices():
    """Get list of available TTS voices for reel generation."""
    voices = get_available_voices()
    return VoicesResponse(
        voices=[VoiceOption(**v) for v in voices]
    )


@router.post("", response_model=ReelResponse)
async def create_reel(
    data: ReelGenerateRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Create a new reel and start generation in background.
    Costs 4 credits.
    """
    # Check wallet balance
    wallet = db.query(Wallet).filter(Wallet.user_id == current_user.id).first()

    has_unlimited_credits = wallet and wallet.balance == -1
    has_credits = wallet and wallet.balance >= REEL_CREDIT_COST

    if not wallet or (not has_unlimited_credits and not has_credits):
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=f"Insufficient credits. Reel generation requires {REEL_CREDIT_COST} credits.",
        )

    # Get business config for context
    config = (
        db.query(BusinessConfig)
        .filter(BusinessConfig.user_id == current_user.id)
        .first()
    )

    # Create reel record
    reel = Reel(
        user_id=current_user.id,
        topic=data.topic,
        tone=data.tone,
        voice=data.voice,
        duration_target=data.duration_target,
        status="pending",
    )
    db.add(reel)

    # Deduct credits
    if wallet.balance != -1:
        wallet.balance -= REEL_CREDIT_COST
    wallet.total_credits_used += REEL_CREDIT_COST

    usage_log = UsageLog(
        wallet_id=wallet.id,
        action="generate_reel",
        credits_used=REEL_CREDIT_COST,
        description=f"Generated Instagram Reel: {data.topic[:50]}",
    )
    db.add(usage_log)
    db.commit()
    db.refresh(reel)

    # Start background generation
    background_tasks.add_task(
        run_reel_generation,
        reel_id=reel.id,
        topic=data.topic,
        tone=data.tone,
        voice=data.voice,
        duration_target=data.duration_target,
        user_id=current_user.id,
        business_name=config.business_name if config else "",
        niche=config.niche if config else "",
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
):
    """Background task wrapper for reel generation."""
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        await process_reel_generation(
            reel_id=reel_id,
            topic=topic,
            tone=tone,
            voice=voice,
            duration_target=duration_target,
            user_id=user_id,
            business_name=business_name,
            niche=niche,
            db_session=db,
        )
    except Exception as e:
        print(f"Reel generation failed: {e}")
        # Error is already saved to DB in process_reel_generation
    finally:
        db.close()


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


@router.post("/{reel_id}/publish", response_model=ReelResponse)
async def publish_reel(
    reel_id: str,
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

    # Build caption with script and hashtags
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
