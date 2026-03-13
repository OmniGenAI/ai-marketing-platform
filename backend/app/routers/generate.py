from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.models.business_config import BusinessConfig
from app.models.wallet import Wallet, UsageLog
from app.schemas.post import GenerateRequest, GenerateResponse
from app.dependencies import get_current_user
from app.services.ai import generate_social_post

router = APIRouter(prefix="/api/generate", tags=["generate"])


@router.post("", response_model=GenerateResponse)
def generate_post(
    data: GenerateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Check wallet balance
    wallet = (
        db.query(Wallet).filter(Wallet.user_id == current_user.id).first()
    )

    # Wallet balance of -1 means unlimited credits
    has_unlimited_credits = wallet and wallet.balance == -1
    has_credits = wallet and wallet.balance > 0

    if not wallet or (not has_unlimited_credits and not has_credits):
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Insufficient credits. Please upgrade your plan.",
        )

    # Get business config
    config = (
        db.query(BusinessConfig)
        .filter(BusinessConfig.user_id == current_user.id)
        .first()
    )
    if not config:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please configure your business profile first.",
        )

    # Generate post using AI
    result = generate_social_post(
        business_name=config.business_name,
        niche=config.niche,
        tone=data.tone,
        products=config.products,
        brand_voice=config.brand_voice,
        target_audience=config.target_audience,
        hashtags=config.hashtags,
        platform=data.platform,
        topic=data.topic,
    )

    # Deduct credit (unless unlimited)
    if wallet.balance != -1:
        wallet.balance -= 1
    wallet.total_credits_used += 1

    usage_log = UsageLog(
        wallet_id=wallet.id,
        action="generate_post",
        credits_used=1,
        description=f"Generated {data.platform} post",
    )
    db.add(usage_log)
    db.commit()

    return GenerateResponse(
        content=result["content"],
        hashtags=result["hashtags"],
    )
