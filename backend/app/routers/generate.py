from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
import json
import logging

from app.database import get_db
from app.models.user import User
from app.models.business_config import BusinessConfig
from app.models.business_image import BusinessImage
from app.models.wallet import Wallet, UsageLog
from app.schemas.post import GenerateRequest, GenerateResponse
from app.dependencies import get_current_user
from app.services.ai import generate_social_post, generate_image_from_prompt

logger = logging.getLogger(__name__)

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

    # Check if website context is available and valid
    website_context_used = False
    if config.website_context:
        try:
            json.loads(config.website_context)  # Validate it's proper JSON
            website_context_used = True
            logger.info(f"Website context validated for user {current_user.id}")
        except (json.JSONDecodeError, TypeError) as e:
            logger.warning(f"Invalid website context for user {current_user.id}: {str(e)}")
    else:
        logger.info(f"No website context for user {current_user.id} - post will be generated without website data")

    # Generate post using AI with website context
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
        website_context=config.website_context,
    )

    # Handle image option
    image_url = None

    if data.image_option == "business" and data.business_image_id:
        # Get the selected business image
        business_image = (
            db.query(BusinessImage)
            .filter(
                BusinessImage.id == data.business_image_id,
                BusinessImage.user_id == current_user.id
            )
            .first()
        )
        if business_image:
            image_url = business_image.url

    elif data.image_option == "ai":
        # Generate image using AI
        image_url = generate_image_from_prompt(
            topic=data.topic,
            business_name=config.business_name,
            niche=config.niche,
        )

    elif data.image_option == "upload" and data.uploaded_image_url:
        # Use the uploaded image URL
        image_url = data.uploaded_image_url

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
        image_url=image_url,
        website_context_used=website_context_used,
    )
