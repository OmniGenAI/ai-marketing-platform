from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.models.post import Post
from app.models.social_account import SocialAccount
from app.schemas.post import PostCreate, PostUpdate, PostResponse
from app.dependencies import get_current_user
from app.services.social import publish_to_facebook, publish_to_instagram

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
        # Publish to the platform
        if post.platform.lower() == "facebook":
            # Combine content and hashtags for Facebook
            full_content = f"{post.content}\n\n{post.hashtags}" if post.hashtags else post.content

            result = await publish_to_facebook(
                page_id=social_account.page_id,
                access_token=social_account.access_token,
                content=full_content
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
                caption=caption
            )

        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Platform {post.platform} is not supported yet",
            )

        # Update post status
        post.status = "published"
        post.published_at = datetime.utcnow()
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
