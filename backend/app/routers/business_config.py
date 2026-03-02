from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.models.business_config import BusinessConfig
from app.schemas.business_config import BusinessConfigCreate, BusinessConfigResponse
from app.dependencies import get_current_user

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
