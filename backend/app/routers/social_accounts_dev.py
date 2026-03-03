"""
Development-only social accounts endpoints
These allow testing without Facebook App setup

WARNING: DO NOT use in production!
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime

from app.database import get_db
from app.models.user import User
from app.models.social_account import SocialAccount
from app.dependencies import get_current_user

router = APIRouter(prefix="/api/social/dev", tags=["social-accounts-dev"])


@router.post("/mock/facebook")
def mock_connect_facebook(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Development only: Mock Facebook connection
    Creates a fake Facebook account with test tokens
    """
    # Check if already exists
    existing = (
        db.query(SocialAccount)
        .filter(
            SocialAccount.user_id == current_user.id,
            SocialAccount.platform == "facebook"
        )
        .first()
    )

    if existing:
        return {
            "message": "Facebook account already connected (mock)",
            "account": {
                "id": existing.id,
                "platform": "facebook",
                "page_name": existing.page_name
            }
        }

    # Create mock account
    account = SocialAccount(
        user_id=current_user.id,
        platform="facebook",
        access_token="MOCK_FB_TOKEN_DEV_ONLY",
        page_id="123456789",
        page_name="Test Facebook Page"
    )
    db.add(account)
    db.commit()
    db.refresh(account)

    return {
        "message": "Facebook account connected successfully (mock)",
        "account": {
            "id": account.id,
            "platform": "facebook",
            "page_name": account.page_name
        }
    }


@router.post("/mock/instagram")
def mock_connect_instagram(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Development only: Mock Instagram connection
    Creates a fake Instagram account with test tokens
    """
    # Check if already exists
    existing = (
        db.query(SocialAccount)
        .filter(
            SocialAccount.user_id == current_user.id,
            SocialAccount.platform == "instagram"
        )
        .first()
    )

    if existing:
        return {
            "message": "Instagram account already connected (mock)",
            "account": {
                "id": existing.id,
                "platform": "instagram",
                "page_name": existing.page_name
            }
        }

    # Create mock account
    account = SocialAccount(
        user_id=current_user.id,
        platform="instagram",
        access_token="MOCK_IG_TOKEN_DEV_ONLY",
        page_id="987654321",
        page_name="@test_instagram"
    )
    db.add(account)
    db.commit()
    db.refresh(account)

    return {
        "message": "Instagram account connected successfully (mock)",
        "account": {
            "id": account.id,
            "platform": "instagram",
            "page_name": account.page_name
        }
    }
