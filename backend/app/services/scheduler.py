"""
Post Scheduler Service
======================
Polls the DB every minute for posts where:
  - status == "scheduled"
  - scheduled_at <= now (UTC)

For each due post it calls the same publish logic used by the manual
POST /api/posts/{id}/publish endpoint, then:
  - On success: status → "published", published_at = now
  - On failure: status → "failed", logs the error

Architecture note
-----------------
APScheduler runs in the same process as Uvicorn (AsyncIOScheduler on the
existing event loop). This is fine for a single-worker deployment.
For multi-worker production, swap the BackgroundScheduler + DB polling
approach here for Celery Beat + Redis so only one worker fires each job.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.post import Post
from app.models.social_account import SocialAccount
from app.services.social import (
    publish_to_facebook,
    publish_to_instagram,
    publish_to_linkedin,
    publish_to_reddit,
)

logger = logging.getLogger(__name__)


async def _publish_one(db: Session, post: Post) -> None:
    """Attempt to publish a single scheduled post. Updates post status in DB."""
    social_account = (
        db.query(SocialAccount)
        .filter(
            SocialAccount.user_id == post.user_id,
            SocialAccount.platform == post.platform.lower(),
        )
        .first()
    )

    if not social_account:
        logger.warning(
            "[scheduler] No connected %s account for user %s — post %s skipped",
            post.platform, post.user_id, post.id,
        )
        post.status = "failed"
        db.commit()
        return

    try:
        is_mock = social_account.access_token.startswith("MOCK_")
        result: dict = {}

        if is_mock:
            result = {"id": f"mock_scheduled_{post.id}"}

        elif post.platform.lower() == "facebook":
            full = f"{post.content}\n\n{post.hashtags}" if post.hashtags else post.content
            result = await publish_to_facebook(
                page_id=social_account.page_id,
                access_token=social_account.access_token,
                content=full,
                image_url=post.image_url if post.image_url else None,
            )

        elif post.platform.lower() == "instagram":
            if not post.image_url:
                raise ValueError("Instagram posts require an image_url")
            caption = f"{post.content}\n\n{post.hashtags}" if post.hashtags else post.content
            result = await publish_to_instagram(
                instagram_account_id=social_account.page_id,
                access_token=social_account.access_token,
                image_url=post.image_url,
                caption=caption,
                user_id=post.user_id,
            )

        elif post.platform.lower() == "linkedin":
            full = f"{post.content}\n\n{post.hashtags}" if post.hashtags else post.content
            result = await publish_to_linkedin(
                member_urn=social_account.page_id,
                access_token=social_account.access_token,
                content=full,
                image_url=post.image_url if post.image_url else None,
            )

        elif post.platform.lower() == "reddit":
            full = f"{post.content}\n\n{post.hashtags}" if post.hashtags else post.content
            result = await publish_to_reddit(
                username=social_account.page_id,
                image_url=post.image_url if post.image_url else None,
                access_token=social_account.access_token,
                content=full,
            )

        else:
            raise ValueError(f"Platform '{post.platform}' is not supported by the scheduler")

        post.status = "published"
        post.published_at = datetime.now(timezone.utc)
        if isinstance(result, dict) and result.get("id"):
            post.external_post_id = str(result["id"])
        db.commit()
        logger.info("[scheduler] Published post %s to %s", post.id, post.platform)

    except Exception as exc:
        logger.exception("[scheduler] Failed to publish post %s: %s", post.id, exc)
        post.status = "failed"
        db.commit()


async def run_due_posts() -> None:
    """Called by APScheduler every minute. Publishes all posts due right now."""
    if not SessionLocal:
        return

    now = datetime.now(timezone.utc)
    db: Session = SessionLocal()
    try:
        due_posts = (
            db.query(Post)
            .filter(
                Post.status == "scheduled",
                Post.scheduled_at <= now,
            )
            .all()
        )

        if due_posts:
            logger.info("[scheduler] %d post(s) due — publishing now", len(due_posts))

        for post in due_posts:
            await _publish_one(db, post)

    except Exception as exc:
        logger.exception("[scheduler] Unexpected error in run_due_posts: %s", exc)
    finally:
        db.close()
