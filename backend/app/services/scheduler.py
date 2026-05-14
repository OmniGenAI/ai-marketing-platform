"""
Global Publish Scheduler
========================
Single APScheduler job that picks up every kind of scheduled content the
platform supports and publishes it when its time arrives:

  - **Posts**  — social posts in the `posts` table
                 (status="scheduled" + scheduled_at <= now)
  - **Reels**  — videos in the `reels` table
                 (status="ready" + published_at <= now)
  - **Blogs**  — markdown drafts in the `seo_saves` table (type="blog")
                 with a `scheduledAt` key in their JSON data

On success each row is flipped to "published" (with `published_at` rewritten
to the actual publish moment). On failure the row is marked "failed" /
"publish_failed" and the error message is persisted so the UI can show why.

Architecture
------------
APScheduler runs on the existing Uvicorn event loop (AsyncIOScheduler). Fine
for single-worker deployments; for multi-worker production swap this for
Celery Beat + Redis so only one worker fires each job.

Everything is centralised here — never add a second scheduler. To support a
new content type, register it inside `run_due_items` and add a handler.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.post import Post
from app.models.reel import Reel
from app.models.seo_save import SeoSave
from app.models.social_account import SocialAccount
from app.services.social import (
    publish_to_facebook,
    publish_to_facebook_reel,
    publish_to_instagram,
    publish_to_instagram_reels,
    publish_to_linkedin,
    publish_to_linkedin_video,
    publish_to_reddit,
    publish_to_reddit_video,
    publish_to_threads,
    publish_to_twitter,
    publish_to_youtube_short,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Posts — handler
# ---------------------------------------------------------------------------
async def _publish_post(db: Session, post: Post) -> None:
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
        platform = post.platform.lower()
        full = f"{post.content}\n\n{post.hashtags}" if post.hashtags else post.content

        if is_mock:
            result = {"id": f"mock_scheduled_{post.id}"}

        elif platform == "facebook":
            result = await publish_to_facebook(
                page_id=social_account.page_id,
                access_token=social_account.access_token,
                content=full,
                image_url=post.image_url if post.image_url else None,
            )

        elif platform == "instagram":
            if not post.image_url:
                raise ValueError("Instagram posts require an image_url")
            result = await publish_to_instagram(
                instagram_account_id=social_account.page_id,
                access_token=social_account.access_token,
                image_url=post.image_url,
                caption=full,
                user_id=post.user_id,
            )

        elif platform == "linkedin":
            result = await publish_to_linkedin(
                member_urn=social_account.page_id,
                access_token=social_account.access_token,
                content=full,
                image_url=post.image_url if post.image_url else None,
            )

        elif platform == "reddit":
            result = await publish_to_reddit(
                username=social_account.page_id,
                image_url=post.image_url if post.image_url else None,
                access_token=social_account.access_token,
                content=full,
            )

        elif platform == "twitter":
            result = await publish_to_twitter(
                access_token=social_account.access_token,
                content=full,
                image_url=post.image_url if post.image_url else None,
            )

        elif platform == "threads":
            result = await publish_to_threads(
                threads_user_id=social_account.page_id,
                access_token=social_account.access_token,
                content=full,
                image_url=post.image_url if post.image_url else None,
            )

        else:
            raise ValueError(
                f"Platform '{post.platform}' is not supported by the scheduler"
            )

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


# ---------------------------------------------------------------------------
# Reels — handler
# ---------------------------------------------------------------------------
async def _publish_reel(db: Session, reel: Reel) -> None:
    """Attempt to publish a single due reel. Updates reel status in DB.

    Reels store their target publish time in `published_at` (no `scheduled_at`
    column). After a successful publish we overwrite that field with the
    actual publish moment so the UI shows the correct "Published at" time.
    """
    if not reel.video_url:
        logger.warning("[scheduler] Reel %s has no video_url — marking failed", reel.id)
        reel.status = "publish_failed"
        reel.error_message = "No video_url"
        db.commit()
        return

    platform = (reel.platform or "instagram").lower()
    social_account = (
        db.query(SocialAccount)
        .filter(
            SocialAccount.user_id == reel.user_id,
            SocialAccount.platform == platform,
        )
        .first()
    )
    if not social_account:
        logger.warning(
            "[scheduler] No connected %s account for user %s — reel %s skipped",
            platform, reel.user_id, reel.id,
        )
        reel.status = "publish_failed"
        reel.error_message = f"No connected {platform} account"
        db.commit()
        return

    caption = reel.script or ""
    if reel.hashtags:
        caption = f"{caption}\n\n{reel.hashtags}"

    try:
        result: dict = {}
        if platform == "instagram":
            result = await publish_to_instagram_reels(
                instagram_account_id=social_account.page_id,
                access_token=social_account.access_token,
                video_url=reel.video_url,
                caption=caption,
                thumbnail_url=reel.thumbnail_url,
            )
        elif platform == "facebook":
            result = await publish_to_facebook_reel(
                page_id=social_account.page_id,
                access_token=social_account.access_token,
                video_url=reel.video_url,
                caption=caption,
            )
        elif platform == "linkedin":
            result = await publish_to_linkedin_video(
                member_urn=social_account.page_id,
                access_token=social_account.access_token,
                video_url=reel.video_url,
                caption=caption,
            )
        elif platform == "youtube":
            tags = [
                t.lstrip("#") for t in (reel.hashtags or "").split() if t.startswith("#")
            ][:30]
            result = await publish_to_youtube_short(
                access_token=social_account.access_token,
                video_url=reel.video_url,
                title=(reel.topic or "Reel")[:100],
                description=caption,
                tags=tags,
            )
        elif platform == "reddit":
            result = await publish_to_reddit_video(
                username=social_account.page_id,
                access_token=social_account.access_token,
                video_url=reel.video_url,
                caption=caption,
            )
        else:
            raise ValueError(f"Platform '{platform}' is not supported for reels")

        reel.status = "published"
        reel.published_at = datetime.now(timezone.utc)
        reel.error_message = None
        if platform == "instagram" and isinstance(result, dict) and result.get("id"):
            reel.instagram_media_id = str(result["id"])
        db.commit()
        logger.info("[scheduler] Published reel %s to %s", reel.id, platform)

    except Exception as exc:
        logger.exception("[scheduler] Failed to publish reel %s: %s", reel.id, exc)
        reel.status = "publish_failed"
        reel.error_message = str(exc)[:500]
        db.commit()


# ---------------------------------------------------------------------------
# Blogs — handler
# ---------------------------------------------------------------------------
def _blog_scheduled_dt(save: SeoSave) -> datetime | None:
    """Pull the scheduledAt timestamp out of a blog save's JSON, or None."""
    try:
        data = json.loads(save.data or "{}")
    except (TypeError, json.JSONDecodeError):
        return None
    raw = data.get("scheduledAt")
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.rstrip("Z")).replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


async def _publish_blog(db: Session, save: SeoSave) -> None:
    """Attempt to publish a single due blog draft.

    Picks the first entry in `data["platforms"]` and dispatches:
      - dev.to     → `publish_to_devto` (markdown blog)
      - linkedin   → `publish_to_linkedin` (long-form text share)
      - facebook   → `publish_to_facebook`
      - other      → marks the save failed; user has to publish manually.

    Persists publish metadata into `data["published"][platform]` and writes
    `data["status"] = "published"` + `data["publishedAt"]` so the calendar
    and analytics views can detect the transition.
    """
    # Late import to avoid a circular import (blog_publish imports models too).
    from app.services.blog_publish import publish_to_devto

    try:
        data: dict = json.loads(save.data or "{}")
    except (TypeError, json.JSONDecodeError):
        data = {}

    platforms = [p.lower() for p in (data.get("platforms") or []) if isinstance(p, str)]
    if not platforms:
        _mark_blog_failed(db, save, data, "No platform selected — pick one before scheduling.")
        return

    platform = platforms[0]
    title = data.get("title") or save.title or "Untitled"
    markdown = data.get("content") or ""
    if not markdown.strip():
        _mark_blog_failed(db, save, data, "Blog has no content to publish.")
        return

    account = (
        db.query(SocialAccount)
        .filter(
            SocialAccount.user_id == save.user_id,
            SocialAccount.platform == platform,
        )
        .first()
    )
    if not account:
        _mark_blog_failed(
            db, save, data,
            f"No connected {platform} account — connect it in Settings.",
        )
        return

    try:
        published_record: dict = {}

        if platform == "devto":
            result = await publish_to_devto(
                account=account,
                title=title,
                markdown=markdown,
                tags=data.get("tags") or [],
                publish=True,
            )
            published_record = {
                "id": result.external_post_id,
                "url": result.url,
                **result.raw,
            }

        elif platform == "linkedin":
            # LinkedIn's standard tier has no long-form blog API — share the
            # blog as a UGC text post (title + flattened body). Clipped to
            # LinkedIn's 3,000-char share limit.
            plain = _markdown_to_plain(markdown)
            share_text = f"{title}\n\n{plain}".strip()[:2900]
            res = await publish_to_linkedin(
                member_urn=account.page_id,
                access_token=account.access_token,
                content=share_text,
                image_url=None,
            )
            post_id = str(res.get("id", ""))
            # LinkedIn activity IDs resolve as feed permalinks.
            url = f"https://www.linkedin.com/feed/update/{post_id}" if post_id else ""
            published_record = {"id": post_id, "url": url}

        elif platform == "facebook":
            # Same idea — flatten to plain text and post on the connected page.
            plain = _markdown_to_plain(markdown)
            share_text = f"{title}\n\n{plain}".strip()[:5000]
            res = await publish_to_facebook(
                page_id=account.page_id,
                access_token=account.access_token,
                content=share_text,
                image_url=None,
            )
            post_id = str(res.get("id", ""))
            # FB post ids come back as "{page_id}_{post_id}".
            url = ""
            if post_id:
                parts = post_id.split("_", 1)
                if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
                    url = f"https://www.facebook.com/{parts[0]}/posts/{parts[1]}"
            published_record = {"id": post_id, "url": url}

        else:
            raise ValueError(
                f"Platform '{platform}' is not supported for blog auto-publish."
            )

        now_iso = datetime.now(timezone.utc).isoformat()
        published_record["published_at"] = now_iso
        data.setdefault("published", {})[platform] = published_record
        data["status"] = "published"
        data["publishedAt"] = now_iso
        # Clear scheduledAt so the scheduler doesn't pick the row up again
        # on the next tick. Keep a copy under originalScheduledAt for audit.
        if "scheduledAt" in data:
            data["originalScheduledAt"] = data.pop("scheduledAt")
        save.data = json.dumps(data, ensure_ascii=False)
        db.commit()
        logger.info("[scheduler] Published blog %s to %s", save.id, platform)

    except Exception as exc:
        logger.exception("[scheduler] Failed to publish blog %s: %s", save.id, exc)
        _mark_blog_failed(db, save, data, str(exc)[:500])


def _mark_blog_failed(
    db: Session, save: SeoSave, data: dict, reason: str
) -> None:
    """Persist a failure on a blog save without clobbering existing fields."""
    data["status"] = "failed"
    data["error"] = reason
    # Clear scheduledAt so the scheduler doesn't retry forever — the user has
    # to fix the underlying issue and reschedule manually.
    data.pop("scheduledAt", None)
    save.data = json.dumps(data, ensure_ascii=False)
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.error("[scheduler] couldn't mark blog %s failed: %s", save.id, exc)


def _markdown_to_plain(md: str) -> str:
    """Best-effort flatten of markdown / HTML to plain text for social shares.

    Strips fence markers, leading list dashes, headings, bold/italic markers,
    and inline HTML so platforms that don't render markdown receive something
    readable.
    """
    import re
    text = md
    # Drop fenced code blocks entirely
    text = re.sub(r"```[\s\S]*?```", "", text)
    # Inline code
    text = re.sub(r"`([^`]+)`", r"\1", text)
    # HTML tags
    text = re.sub(r"<[^>]+>", " ", text)
    # Headings, blockquotes, list markers
    text = re.sub(r"^[#>\-\*\+]\s+", "", text, flags=re.MULTILINE)
    # Bold / italic markers (**, __, *, _)
    text = re.sub(r"(\*\*|__)(.*?)\1", r"\2", text)
    text = re.sub(r"(\*|_)(.*?)\1", r"\2", text)
    # Links [text](url) → text
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    # Collapse whitespace
    text = re.sub(r"\s+", " ", text).strip()
    return text


# ---------------------------------------------------------------------------
# Global dispatcher — one job to publish everything that's due.
# ---------------------------------------------------------------------------
async def run_due_items() -> None:
    """Single tick of the global publisher.

    Called by APScheduler every 60s. Fetches every kind of due item across
    posts / reels / blogs, publishes them sequentially, and logs how many
    of each were processed. Sequential (not parallel) so a hammered network
    or slow social API can't fan out into hundreds of concurrent requests.
    """
    if not SessionLocal:
        return

    now = datetime.now(timezone.utc)
    db: Session = SessionLocal()
    try:
        due_posts = (
            db.query(Post)
            .filter(Post.status == "scheduled", Post.scheduled_at <= now)
            .all()
        )
        due_reels = (
            db.query(Reel)
            .filter(
                Reel.status == "ready",
                Reel.published_at.isnot(None),
                Reel.published_at <= now,
            )
            .all()
        )
        # Blogs store their schedule inside the JSON `data` blob. Two row
        # shapes exist depending on where the blog was created:
        #   - type="blog"  — created by /blog/generate (BlogGenerateRequest)
        #   - type="draft" — created/saved by the SEO editor (rich-text drafts)
        # Both are scheduled the same way (data.scheduledAt), so query both.
        candidate_blogs = (
            db.query(SeoSave)
            .filter(SeoSave.type.in_(("blog", "draft")))
            .all()
        )
        due_blogs: list[SeoSave] = []
        for save in candidate_blogs:
            sched = _blog_scheduled_dt(save)
            if sched and sched <= now:
                due_blogs.append(save)

        total = len(due_posts) + len(due_reels) + len(due_blogs)
        if total:
            logger.info(
                "[scheduler] %d item(s) due — posts=%d reels=%d blogs=%d",
                total, len(due_posts), len(due_reels), len(due_blogs),
            )

        for post in due_posts:
            await _publish_post(db, post)
        for reel in due_reels:
            await _publish_reel(db, reel)
        for blog in due_blogs:
            await _publish_blog(db, blog)

    except Exception as exc:
        logger.exception("[scheduler] Unexpected error in run_due_items: %s", exc)
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Back-compat shims — old code (and any external import) keeps working while
# we migrate callers to the single `run_due_items` entry point.
# ---------------------------------------------------------------------------
async def run_due_posts() -> None:  # noqa: D401 — kept for compat
    """Deprecated alias — use `run_due_items` instead."""
    await run_due_items()


async def run_due_reels() -> None:  # noqa: D401 — kept for compat
    """Deprecated alias — use `run_due_items` instead."""
    await run_due_items()
