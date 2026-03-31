from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.models.business_config import BusinessConfig
from app.schemas.business_config import (
    BusinessConfigCreate,
    BusinessConfigResponse,
    ScrapeWebsiteRequest,
    ScrapeWebsiteResponse,
)
from app.dependencies import get_current_user
from app.services.scraper import scrape_website, website_context_to_json

router = APIRouter(prefix="/api/business-config", tags=["business-config"])


@router.get("", response_model=BusinessConfigResponse | None)
def get_business_config(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    config = (
        db.query(BusinessConfig)
        .filter(BusinessConfig.user_id == current_user.id)
        .first()
    )
    return config


@router.post("", response_model=BusinessConfigResponse)
def create_or_update_business_config(
    data: BusinessConfigCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    config = (
        db.query(BusinessConfig)
        .filter(BusinessConfig.user_id == current_user.id)
        .first()
    )

    if config:
        for field, value in data.model_dump().items():
            setattr(config, field, value)
    else:
        config = BusinessConfig(user_id=current_user.id, **data.model_dump())
        db.add(config)

    db.commit()
    db.refresh(config)
    return config


@router.post("/scrape-website", response_model=ScrapeWebsiteResponse)
def scrape_website_endpoint(
    data: ScrapeWebsiteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Scrape a website and store the context for AI content generation.
    """
    config = (
        db.query(BusinessConfig)
        .filter(BusinessConfig.user_id == current_user.id)
        .first()
    )

    if not config:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please create a business configuration first.",
        )

    try:
        context = scrape_website(data.url)
        config.website = data.url
        config.website_context = website_context_to_json(context)
        db.commit()
        db.refresh(config)

        return ScrapeWebsiteResponse(
            success=True,
            message="Website analyzed successfully",
            context=context,
        )
    except Exception as e:
        return ScrapeWebsiteResponse(
            success=False,
            message=str(e),
            context=None,
        )


@router.post("/scrape-and-update", response_model=BusinessConfigResponse)
def scrape_and_update_config(
    data: ScrapeWebsiteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Convenience endpoint: Scrape website and update config in one call.
    """
    config = (
        db.query(BusinessConfig)
        .filter(BusinessConfig.user_id == current_user.id)
        .first()
    )

    if not config:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please create a business configuration first.",
        )

    try:
        context = scrape_website(data.url)
        config.website = data.url
        config.website_context = website_context_to_json(context)
        db.commit()
        db.refresh(config)
        return config
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
