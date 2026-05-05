"""
Per-post analytics router.

Given a published Post (one with `external_post_id` set), fetch metrics from
the matching social platform's API using the user's stored token. The
provider abstraction normalizes responses into `PostMetrics` so the frontend
gets the same shape regardless of platform.

Endpoints
---------
GET /api/posts/{post_id}/analytics
    Single-post live metrics from the matching platform.

GET /api/posts/published-summary
    All published posts AND blogs for the current user with metrics fetched
    in parallel. Powers the analytics dashboard's "Published Posts" tab.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.post import Post
from app.models.reel import Reel
from app.models.seo_save import SeoSave
from app.models.social_account import SocialAccount
from app.models.user import User
from app.services.oauth import (
    OAuthProvider,
    PostMetrics,
    get_provider,
    get_valid_token,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/posts", tags=["post-analytics"])


class AnalyticsResponse(BaseModel):
    post_id: str
    platform: str
    external_post_id: str
    impressions: int | None = None
    reach: int | None = None
    likes: int | None = None
    comments: int | None = None
    shares: int | None = None
    clicks: int | None = None
    views: int | None = None
    raw: dict = {}


@router.get("/{post_id}/analytics", response_model=AnalyticsResponse)
async def get_post_analytics(
    post_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Check Post table first, then fall back to Reel (reels share the same
    # analytics endpoint but live in a separate table).
    raw_post = (
        db.query(Post)
        .filter(Post.id == post_id, Post.user_id == current_user.id)
        .first()
    )
    if raw_post:
        post = raw_post
    else:
        reel = (
            db.query(Reel)
            .filter(Reel.id == post_id, Reel.user_id == current_user.id)
            .first()
        )
        if not reel:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Post not found"
            )
        post = _ReelProxy(reel)  # type: ignore[assignment]

    if not post.external_post_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Post has not been published yet — no analytics available.",
        )

    provider = get_provider(post.platform)
    if provider is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"No analytics provider for platform '{post.platform}'.",
        )

    account = (
        db.query(SocialAccount)
        .filter(
            SocialAccount.user_id == current_user.id,
            SocialAccount.platform == post.platform,
        )
        .first()
    )
    if not account:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                f"You haven't connected {post.platform} — reconnect from "
                "Settings to view analytics."
            ),
        )

    # Refresh expired tokens silently when possible. If refresh isn't supported,
    # surface a 401 so the frontend can prompt reconnection.
    try:
        await get_valid_token(db, account, provider)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc))

    try:
        metrics = await provider.fetch_post_analytics(
            account, post.external_post_id
        )
    except Exception as exc:
        logger.exception("[analytics] fetch failed for %s/%s", post.platform, post.id)
        raise HTTPException(
            status_code=502, detail=f"{post.platform} API error: {exc}"
        )

    return AnalyticsResponse(
        post_id=post.id,
        platform=post.platform,
        external_post_id=post.external_post_id,
        impressions=metrics.impressions,
        reach=metrics.reach,
        likes=metrics.likes,
        comments=metrics.comments,
        shares=metrics.shares,
        clicks=metrics.clicks,
        views=metrics.views,
        raw=metrics.raw or {},
    )


# ---------------------------------------------------------------------------
# Bulk summary — powers the dashboard "Published Posts" tab
# ---------------------------------------------------------------------------
class PublishedPostSummary(BaseModel):
    """One row per published post or blog. Metrics are best-effort: any
    platform call failure leaves them as None and sets `error` so the UI can
    show why."""

    post_id: str
    platform: str
    external_post_id: str
    content_preview: str
    image_url: str | None = None
    published_at: datetime | None = None
    # "post" for social posts, "blog" for long-form articles. Lets the UI
    # show different icons / link to different detail pages.
    kind: str = "post"
    url: str | None = None  # canonical platform URL when known (blogs only today)
    impressions: int | None = None
    reach: int | None = None
    likes: int | None = None
    comments: int | None = None
    shares: int | None = None
    clicks: int | None = None
    views: int | None = None
    error: str | None = None  # populated if metrics fetch failed


class PublishedSummaryResponse(BaseModel):
    posts: list[PublishedPostSummary]
    totals: dict[str, int]  # aggregated counts across all posts


def _post_url(platform: str, external_post_id: str | None) -> str | None:
    """Construct a canonical public URL for a published social post.

    Facebook stores the id as "{page_id}_{post_id}"; the public permalink is
    https://www.facebook.com/{page_id}/posts/{post_id}.
    Instagram media permalinks require an extra API call — we link to the
    profile page instead since the media permalink needs insights scope.
    """
    if not external_post_id:
        return None
    p = platform.lower()
    if p == "facebook":
        parts = external_post_id.split("_", 1)
        # Real FB ids are all-numeric; mock/dev ids start with "mock_post_"
        if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
            return f"https://www.facebook.com/{parts[0]}/posts/{parts[1]}"
        # Bare numeric photo id (legacy posts before the post_id fix) —
        # link to the photo permalink which is always accessible.
        if external_post_id.isdigit():
            return f"https://www.facebook.com/photo/?fbid={external_post_id}"
        return None
    if p == "instagram":
        # Instagram media permalinks use shortcodes, not numeric IDs.
        # The numeric media_id is what the Graph API returns at publish time
        # but it cannot be used directly in a /p/ URL.  We link to the IG
        # profile page (no public permalink available without an extra API call).
        return None
    if p == "linkedin":
        # Activity URN → linkedin.com/feed/update/urn:li:activity:...
        return f"https://www.linkedin.com/feed/update/{external_post_id}"
    if p == "twitter":
        return None  # need username to build URL, not stored here
    return None


async def _fetch_one(
    *,
    db: Session,
    post: Post,
    provider: OAuthProvider | None,
    account: SocialAccount | None,
) -> PublishedPostSummary:
    """Build one summary row. Errors are caught and reported per-post so a
    single bad token doesn't break the whole dashboard."""
    # Reels are passed in via _reel_as_post which stamps kind="reel"; regular
    # Post rows don't have that attribute so getattr falls back to "post".
    kind = getattr(post, "kind", "post")
    base = PublishedPostSummary(
        post_id=post.id,
        platform=post.platform,
        external_post_id=post.external_post_id or "",
        content_preview=(post.content or "")[:140],
        image_url=post.image_url,
        published_at=post.published_at,
        kind=kind,
        url=_post_url(post.platform, post.external_post_id),
    )
    if not account:
        base.error = "Connect this platform in Settings to view analytics."
        return base
    if not post.external_post_id:
        base.error = "Metrics unavailable — published before post tracking was enabled."
        return base
    if not provider:
        base.error = "No analytics provider for this platform."
        return base

    try:
        await get_valid_token(db, account, provider)
        m: PostMetrics = await provider.fetch_post_analytics(
            account, post.external_post_id
        )
    except Exception as exc:
        # Most likely cause: token expired + no refresh, or IG insights window
        # closed (FB only returns insights for posts < 90 days old by default).
        base.error = str(exc)[:200]
        return base

    base.impressions = m.impressions
    base.reach = m.reach
    base.likes = m.likes
    base.comments = m.comments
    base.shares = m.shares
    base.clicks = m.clicks
    base.views = m.views
    return base


async def _fetch_blog_row(
    *,
    db: Session,
    save: SeoSave,
    platform: str,
    pub_meta: dict,
    account: SocialAccount | None,
) -> PublishedPostSummary:
    """Build one summary row for a published blog. `pub_meta` is the dict we
    stored under `data["published"][platform]` at publish time.

    Side effect: if the platform reports a different URL or published_at than
    what we have on file (e.g. user published from a draft on Dev.to so the
    slug changed), we silently sync those back into seo_saves.data so the
    "Open ↗" link stays accurate.
    """
    provider = get_provider(platform)
    article_id = str(pub_meta.get("id") or "")
    base = PublishedPostSummary(
        post_id=save.id,
        platform=platform,
        external_post_id=article_id,
        content_preview=(save.title or "(untitled blog)")[:140],
        kind="blog",
        url=pub_meta.get("url"),
        published_at=_parse_iso(pub_meta.get("published_at")),
    )
    if not provider or not account or not article_id:
        base.error = (
            f"Connect {platform} in Settings to view analytics."
            if not account
            else "No analytics provider for this platform."
        )
        return base

    try:
        await get_valid_token(db, account, provider)
        m = await provider.fetch_post_analytics(account, article_id)
    except Exception as exc:
        base.error = str(exc)[:200]
        return base

    base.impressions = m.impressions
    base.reach = m.reach
    base.likes = m.likes
    base.comments = m.comments
    base.shares = m.shares
    base.clicks = m.clicks
    base.views = m.views

    # ---- URL / published_at drift sync --------------------------------
    # Dev.to (and similar) change a draft's slug when the user clicks
    # Publish on their site, so the URL we stored at publish time can go
    # stale. The provider returns the live URL in `raw["url"]`; if it
    # differs, mutate the save in place.
    raw = m.raw or {}
    fresh_url = raw.get("url") if isinstance(raw, dict) else None
    fresh_pub_at = raw.get("published_at") if isinstance(raw, dict) else None
    needs_sync = False
    if fresh_url and fresh_url != pub_meta.get("url"):
        pub_meta["url"] = fresh_url
        base.url = fresh_url
        needs_sync = True
    if fresh_pub_at and fresh_pub_at != pub_meta.get("published_at"):
        pub_meta["published_at"] = fresh_pub_at
        base.published_at = _parse_iso(fresh_pub_at)
        needs_sync = True

    if needs_sync:
        try:
            blog_data = json.loads(save.data or "{}")
            blog_data.setdefault("published", {})[platform] = pub_meta
            save.data = json.dumps(blog_data, ensure_ascii=False)
            db.commit()
            logger.info(
                "[blog sync] updated %s URL for save %s → %s",
                platform, save.id, fresh_url,
            )
        except Exception as exc:
            # Drift sync is best-effort — analytics call succeeded, so don't
            # fail the request just because the in-place save couldn't commit.
            logger.warning("[blog sync] failed to persist URL update: %s", exc)
            db.rollback()

    return base


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


class _ReelProxy:
    """Minimal Post-shaped object so Reel rows can be passed to _fetch_one."""

    __slots__ = (
        "id", "user_id", "platform", "content", "hashtags",
        "image_url", "status", "published_at", "external_post_id", "kind",
    )

    def __init__(self, reel: "Reel") -> None:
        self.id = reel.id
        self.user_id = reel.user_id
        self.platform = "instagram"
        self.content = reel.script or ""
        self.hashtags = reel.hashtags or ""
        self.image_url = reel.thumbnail_url
        self.status = "published"
        self.published_at = reel.published_at
        self.external_post_id = reel.instagram_media_id
        self.kind = "reel"


@router.get("/published-summary", response_model=PublishedSummaryResponse)
async def published_summary(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """All published posts AND blogs for the current user with live metrics.
    Fetches per-item metrics in parallel — total wall time ~= slowest single
    call, not sum of all calls."""
    posts: list[Post] = (
        db.query(Post)
        .filter(
            Post.user_id == current_user.id,
            Post.status == "published",
        )
        .order_by(Post.published_at.desc().nullslast(), Post.created_at.desc())
        .all()
    )

    # Blogs are stored in seo_saves with type="blog"; published ones have
    # `data["published"][<platform>] = {id, url, ...}` set by the publish
    # endpoint. Walk every save and emit one row per platform it was published to.
    blog_saves: list[SeoSave] = (
        db.query(SeoSave)
        .filter(
            SeoSave.user_id == current_user.id,
            SeoSave.type == "blog",
        )
        .all()
    )

    reels: list[Reel] = (
        db.query(Reel)
        .filter(
            Reel.user_id == current_user.id,
            Reel.status == "published",
            Reel.instagram_media_id.isnot(None),
        )
        .order_by(Reel.published_at.desc().nullslast(), Reel.created_at.desc())
        .all()
    )

    # Pre-fetch all the user's social accounts in one query so each post lookup
    # is a dict access instead of another DB hit.
    accounts_by_platform = {
        a.platform: a
        for a in db.query(SocialAccount)
        .filter(SocialAccount.user_id == current_user.id)
        .all()
    }

    post_tasks = [
        _fetch_one(
            db=db,
            post=p,
            provider=get_provider(p.platform),
            account=accounts_by_platform.get(p.platform),
        )
        for p in posts
    ]

    blog_tasks: list = []
    for save in blog_saves:
        try:
            data = json.loads(save.data or "{}")
        except json.JSONDecodeError:
            continue
        for platform, meta in (data.get("published") or {}).items():
            if not isinstance(meta, dict):
                continue
            blog_tasks.append(
                _fetch_blog_row(
                    db=db,
                    save=save,
                    platform=platform,
                    pub_meta=meta,
                    account=accounts_by_platform.get(platform),
                )
            )

    reel_tasks = [
        _fetch_one(
            db=db,
            post=_ReelProxy(r),  # type: ignore[arg-type]
            provider=get_provider("instagram"),
            account=accounts_by_platform.get("instagram"),
        )
        for r in reels
    ]

    if not post_tasks and not blog_tasks and not reel_tasks:
        return PublishedSummaryResponse(posts=[], totals={})

    rows: list[PublishedPostSummary] = await asyncio.gather(
        *post_tasks, *blog_tasks, *reel_tasks
    )

    # Newest first. Normalize all datetimes to UTC-aware so naive vs aware
    # comparison can't blow up; rows without published_at fall back to epoch.
    from datetime import timezone as _tz
    _epoch = datetime(1970, 1, 1, tzinfo=_tz.utc)
    def _sort_key(r: PublishedPostSummary) -> datetime:
        dt = r.published_at
        if dt is None:
            return _epoch
        return dt.replace(tzinfo=_tz.utc) if dt.tzinfo is None else dt
    rows.sort(key=_sort_key, reverse=True)

    # Roll up totals — None values count as 0 for the dashboard headline.
    def _sum(field: str) -> int:
        return sum(getattr(r, field) or 0 for r in rows)

    totals = {
        "posts": sum(1 for r in rows if r.kind == "post"),
        "reels": sum(1 for r in rows if r.kind == "reel"),
        "blogs": sum(1 for r in rows if r.kind == "blog"),
        "impressions": _sum("impressions"),
        "reach": _sum("reach"),
        "likes": _sum("likes"),
        "comments": _sum("comments"),
        "shares": _sum("shares"),
        "clicks": _sum("clicks"),
        "views": _sum("views"),
    }

    return PublishedSummaryResponse(posts=rows, totals=totals)
