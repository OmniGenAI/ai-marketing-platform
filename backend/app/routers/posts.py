from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.models.post import Post
from app.models.social_account import SocialAccount
from app.schemas.post import PostCreate, PostUpdate, PostResponse
from app.dependencies import get_current_user
from app.services.social import (
    publish_to_facebook,
    publish_to_instagram,
    publish_to_linkedin,
    publish_to_reddit,
)
from app.config import settings

router = APIRouter(prefix="/api/posts", tags=["posts"])


@router.get("", response_model=list[PostResponse])
def list_posts(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    posts = (
        db.query(Post)
        .filter(Post.user_id == current_user.id)
        .order_by(Post.created_at.desc())
        .all()
    )
    return posts


@router.post("", response_model=PostResponse, status_code=status.HTTP_201_CREATED)
def create_post(
    data: PostCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    post = Post(user_id=current_user.id, **data.model_dump())
    db.add(post)
    db.commit()
    db.refresh(post)
    return post


# ---------------------------------------------------------------------------
# Calendar endpoints — MUST be declared before /{post_id} so FastAPI matches
# the literal path "/calendar" before the generic param route.
# ---------------------------------------------------------------------------

class RescheduleRequest(BaseModel):
    scheduled_at: datetime


@router.get("/calendar", response_model=list[PostResponse])
def get_calendar_posts(
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return all posts whose scheduled_at OR published_at falls in the given
    year/month. Used by the calendar UI to populate day cells."""
    from calendar import monthrange
    _, last_day = monthrange(year, month)
    period_start = datetime(year, month, 1, tzinfo=timezone.utc)
    period_end = datetime(year, month, last_day, 23, 59, 59, tzinfo=timezone.utc)

    posts = (
        db.query(Post)
        .filter(
            Post.user_id == current_user.id,
            or_(
                Post.scheduled_at.between(period_start, period_end),
                Post.published_at.between(period_start, period_end),
            ),
        )
        .order_by(Post.scheduled_at.asc().nullslast(), Post.published_at.asc().nullslast())
        .all()
    )
    return posts


@router.patch("/{post_id}/reschedule", response_model=PostResponse)
def reschedule_post(
    post_id: str,
    data: RescheduleRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update scheduled_at and flip status to 'scheduled' (or back to 'draft' if null)."""
    post = (
        db.query(Post)
        .filter(Post.id == post_id, Post.user_id == current_user.id)
        .first()
    )
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    if post.status == "published":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot reschedule an already-published post.",
        )
    post.scheduled_at = data.scheduled_at
    post.status = "scheduled" if data.scheduled_at else "draft"
    db.commit()
    db.refresh(post)
    return post


@router.get("/{post_id}", response_model=PostResponse)
def get_post(
    post_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    post = (
        db.query(Post)
        .filter(Post.id == post_id, Post.user_id == current_user.id)
        .first()
    )
    if not post:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Post not found",
        )
    return post


@router.patch("/{post_id}", response_model=PostResponse)
def update_post(
    post_id: str,
    data: PostUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    post = (
        db.query(Post)
        .filter(Post.id == post_id, Post.user_id == current_user.id)
        .first()
    )
    if not post:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Post not found",
        )

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(post, field, value)

    db.commit()
    db.refresh(post)
    return post


@router.delete("/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_post(
    post_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    post = (
        db.query(Post)
        .filter(Post.id == post_id, Post.user_id == current_user.id)
        .first()
    )
    if not post:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Post not found",
        )

    db.delete(post)
    db.commit()


@router.post("/{post_id}/publish", response_model=PostResponse)
async def publish_post(
    post_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Publish a post to the specified social media platform.
    Requires a connected social account for the platform.
    """
    # Check if social posting is enabled
    if not settings.SOCIAL_POSTING_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Social media posting is temporarily disabled. Facebook/Instagram tokens need to be reconfigured. Please try again later.",
        )

    # Get the post
    post = (
        db.query(Post)
        .filter(Post.id == post_id, Post.user_id == current_user.id)
        .first()
    )
    if not post:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Post not found",
        )

    # Check if post is already published
    if post.status == "published":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Post is already published",
        )

    # Get the connected social account for this platform
    social_account = (
        db.query(SocialAccount)
        .filter(
            SocialAccount.user_id == current_user.id,
            SocialAccount.platform == post.platform.lower()
        )
        .first()
    )

    if not social_account:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No {post.platform} account connected. Please connect your account first.",
        )

    try:
        # Check if this is a mock/dev account (skip actual API calls)
        is_mock_account = social_account.access_token.startswith("MOCK_")

        if is_mock_account:
            # Simulate successful publish for development testing
            print(f"[DEV MODE] Simulating publish to {post.platform}: {post.content[:50]}...")
            result = {"id": f"mock_post_{post.id}"}

        # Publish to the platform
        elif post.platform.lower() == "facebook":
            full_content = f"{post.content}\n\n{post.hashtags}" if post.hashtags else post.content
            result = await publish_to_facebook(
                page_id=social_account.page_id,
                access_token=social_account.access_token,
                content=full_content,
                image_url=post.image_url if post.image_url else None,
            )

        elif post.platform.lower() == "instagram":
            # Instagram requires an image
            if not hasattr(post, 'image_url') or not post.image_url:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Instagram posts require an image. Please add an image URL to the post.",
                )

            # Combine content and hashtags for caption
            caption = f"{post.content}\n\n{post.hashtags}" if post.hashtags else post.content

            result = await publish_to_instagram(
                instagram_account_id=social_account.page_id,
                access_token=social_account.access_token,
                image_url=post.image_url,
                caption=caption,
                user_id=current_user.id
            )

        elif post.platform.lower() == "linkedin":
            full_content = f"{post.content}\n\n{post.hashtags}" if post.hashtags else post.content
            result = await publish_to_linkedin(
                member_urn=social_account.page_id,
                access_token=social_account.access_token,
                content=full_content,
                image_url=post.image_url if post.image_url else None,
            )

        elif post.platform.lower() == "reddit":
            full_content = f"{post.content}\n\n{post.hashtags}" if post.hashtags else post.content
            result = await publish_to_reddit(
                username=social_account.page_id,
                image_url=post.image_url if post.image_url else None,
                access_token=social_account.access_token,
                content=full_content,
            )

        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Platform {post.platform} is not supported yet",
            )

        # Update post status and store the platform-issued post ID so
        # analytics can look up metrics later.
        post.status = "published"
        post.published_at = datetime.utcnow()
        if isinstance(result, dict) and result.get("id"):
            post.external_post_id = str(result["id"])
        db.commit()
        db.refresh(post)

        return post

    except Exception as e:
        # Mark as failed
        post.status = "failed"
        db.commit()

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to publish post: {str(e)}",
        )
