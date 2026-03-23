"""
Development-only social accounts endpoints
These allow testing without Facebook App setup

WARNING: DO NOT use in production!
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime
import os

from app.database import get_db
from app.models.user import User
from app.models.social_account import SocialAccount
from app.dependencies import get_current_user

# Mock values - can be overridden by environment variables
MOCK_FB_TOKEN = os.getenv("MOCK_FB_TOKEN", "MOCK_FB_TOKEN_DEV_ONLY")
MOCK_FB_PAGE_ID = os.getenv("MOCK_FB_PAGE_ID", "123456789")
MOCK_FB_PAGE_NAME = os.getenv("MOCK_FB_PAGE_NAME", "Test Facebook Page")

MOCK_IG_TOKEN = os.getenv("MOCK_IG_TOKEN", "MOCK_IG_TOKEN_DEV_ONLY")
MOCK_IG_ACCOUNT_ID = os.getenv("MOCK_IG_ACCOUNT_ID", "987654321")
MOCK_IG_USERNAME = os.getenv("MOCK_IG_USERNAME", "@test_instagram")

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
        access_token=MOCK_FB_TOKEN,
        page_id=MOCK_FB_PAGE_ID,
        page_name=MOCK_FB_PAGE_NAME
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
        access_token=MOCK_IG_TOKEN,
        page_id=MOCK_IG_ACCOUNT_ID,
        page_name=MOCK_IG_USERNAME
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
