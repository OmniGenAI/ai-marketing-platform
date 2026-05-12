"""
Unified Calendar Endpoint
=========================
GET /api/calendar?year=&month=

Returns a single list of CalendarItem covering all content types:
  post    — social posts (posts table)
  reel    — video reels (reels table)
  poster  — poster / graphic (posters table)
  blog    — blog drafts (seo_saves where type='draft')

Each item carries the fields the frontend needs to render a chip and a
detail panel. The `date` field is what the frontend uses to place the
item in a day cell:
  post    → scheduled_at ?? published_at
  reel    → published_at ?? created_at
  poster  → created_at
  blog    → updated_at (last edit is most relevant)
"""
from __future__ import annotations

import json
import logging
from calendar import monthrange
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.post import Post
from app.models.reel import Reel
from app.models.poster import Poster
from app.models.seo_save import SeoSave

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/calendar", tags=["calendar"])


class CalendarItem(BaseModel):
    id: str
    type: Literal["post", "reel", "poster", "blog"]
    # The date used to place this item in a calendar cell (ISO-8601 UTC)
    date: str
    # Display
    title: str          # chip text
    platform: str | None = None
    status: str
    image_url: str | None = None
    video_url: str | None = None
    thumbnail_url: str | None = None
    # Full detail
    content: str | None = None
    hashtags: str | None = None
    scheduled_at: str | None = None
    published_at: str | None = None
    created_at: str


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


@router.get("", response_model=list[CalendarItem])
def get_calendar(
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _, last_day = monthrange(year, month)
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    end = datetime(year, month, last_day, 23, 59, 59, tzinfo=timezone.utc)

    items: list[CalendarItem] = []

    # ------------------------------------------------------------------
    # Posts — use scheduled_at or published_at
    # ------------------------------------------------------------------
    posts = (
        db.query(Post)
        .filter(
            Post.user_id == current_user.id,
            Post.status.in_(["scheduled", "published"]),
            or_(
                Post.scheduled_at.between(start, end),
                Post.published_at.between(start, end),
            ),
        )
        .all()
    )
    for p in posts:
        date = p.scheduled_at or p.published_at
        if not date:
            continue
        items.append(CalendarItem(
            id=p.id,
            type="post",
            date=date.isoformat(),
            title=p.content[:60] if p.content else "Post",
            platform=p.platform,
            status=p.status,
            image_url=p.image_url,
            content=p.content,
            hashtags=p.hashtags,
            scheduled_at=_iso(p.scheduled_at),
            published_at=_iso(p.published_at),
            created_at=p.created_at.isoformat(),
        ))

    # ------------------------------------------------------------------
    # Reels — scheduled or published.
    # A scheduled reel keeps status "ready" with published_at set to the
    # target date (there is no scheduled_at column on Reel), so "ready"
    # reels with a published_at must be included too.
    # ------------------------------------------------------------------
    reels = (
        db.query(Reel)
        .filter(
            Reel.user_id == current_user.id,
            Reel.status.in_(["ready", "scheduled", "published"]),
            Reel.published_at.isnot(None),
            Reel.published_at.between(start, end),
        )
        .all()
    )
    now = datetime.now(timezone.utc)
    for r in reels:
        date = r.published_at or r.created_at
        # A "ready" reel with a future published_at is effectively scheduled.
        display_status = r.status
        if r.status == "ready" and r.published_at and r.published_at > now:
            display_status = "scheduled"
        items.append(CalendarItem(
            id=r.id,
            type="reel",
            date=date.isoformat(),
            title=r.topic[:60] if r.topic else "Reel",
            platform=r.platform,
            status=display_status,
            image_url=r.thumbnail_url,
            video_url=r.video_url,
            thumbnail_url=r.thumbnail_url,
            content=r.script,
            hashtags=r.hashtags,
            published_at=_iso(r.published_at),
            created_at=r.created_at.isoformat(),
        ))

    # ------------------------------------------------------------------
    # Posters — scheduled or published
    # ------------------------------------------------------------------
    posters = (
        db.query(Poster)
        .filter(
            Poster.user_id == current_user.id,
            Poster.status.in_(["scheduled", "published"]),
            Poster.updated_at.between(start, end),
        )
        .all()
    )
    for po in posters:
        items.append(CalendarItem(
            id=po.id,
            type="poster",
            date=po.created_at.isoformat(),
            title=po.title[:60] if po.title else "Poster",
            platform=None,
            status=po.status,
            image_url=po.background_image_url,
            content=po.caption,
            created_at=po.created_at.isoformat(),
        ))

    # ------------------------------------------------------------------
    # Blogs (seo_saves with type='draft')
    # Priority: scheduledAt (from data JSON) > updated_at
    # We fetch ALL drafts then filter by whichever date falls in range.
    # ------------------------------------------------------------------
    all_blogs = (
        db.query(SeoSave)
        .filter(
            SeoSave.user_id == current_user.id,
            SeoSave.type == "draft",
        )
        .all()
    )
    for b in all_blogs:
        try:
            data = json.loads(b.data) if b.data else {}
        except Exception:
            data = {}

        # Only include blogs that have an explicit scheduledAt
        scheduled_at_raw = data.get("scheduledAt")
        if not scheduled_at_raw:
            continue
        try:
            blog_date = datetime.fromisoformat(scheduled_at_raw.rstrip("Z")).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        blog_status = "scheduled"

        # Only include if the resolved date falls in the requested month
        if not (start <= blog_date <= end):
            continue

        # Use first saved platform if available
        platforms = data.get("platforms") or []
        blog_platform = platforms[0] if platforms else None

        # Return full content for blogs (rendered as HTML in the calendar detail sheet)
        raw_content = data.get("content") or data.get("outline") or ""
        content_preview = raw_content  # full HTML — frontend renders it

        items.append(CalendarItem(
            id=b.id,
            type="blog",
            date=blog_date.isoformat(),
            title=b.title[:60] if b.title else "Blog Draft",
            platform=blog_platform,
            status=blog_status,
            scheduled_at=scheduled_at_raw,
            content=content_preview or None,
            created_at=b.created_at.isoformat(),
        ))

    # Sort by date ascending
    items.sort(key=lambda x: x.date)
    return items

# ---------------------------------------------------------------------------
# Unified reschedule — handles all calendar item types
# ---------------------------------------------------------------------------
class RescheduleRequest(BaseModel):
    scheduled_at: str   # ISO-8601 datetime string


@router.patch("/{item_type}/{item_id}/reschedule", response_model=CalendarItem)
async def reschedule_item(
    item_type: Literal["post", "reel", "poster", "blog"],
    item_id: str,
    data: RescheduleRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Reschedule any calendar item by moving it to a new date."""
    from fastapi import HTTPException, status as http_status

    try:
        new_dt = datetime.fromisoformat(data.scheduled_at.rstrip("Z")).replace(tzinfo=timezone.utc)
    except ValueError:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Invalid scheduled_at format")

    if item_type == "post":
        obj = db.query(Post).filter(Post.id == item_id, Post.user_id == current_user.id).first()
        if not obj:
            raise HTTPException(status_code=404, detail="Post not found")
        if obj.status == "published":
            raise HTTPException(status_code=400, detail="Cannot reschedule a published post")
        obj.scheduled_at = new_dt
        obj.status = "scheduled"
        db.commit()
        db.refresh(obj)
        return CalendarItem(
            id=obj.id, type="post", date=new_dt.isoformat(),
            title=(obj.content or "")[:60], platform=obj.platform,
            status=obj.status, image_url=obj.image_url,
            scheduled_at=new_dt.isoformat(),
            published_at=_iso(obj.published_at),
            created_at=obj.created_at.isoformat(),
        )

    elif item_type == "reel":
        obj = db.query(Reel).filter(Reel.id == item_id, Reel.user_id == current_user.id).first()
        if not obj:
            raise HTTPException(status_code=404, detail="Reel not found")
        # Reels don't have a scheduled_at column — store in published_at as the target date
        obj.published_at = new_dt
        db.commit()
        db.refresh(obj)
        return CalendarItem(
            id=obj.id, type="reel", date=new_dt.isoformat(),
            title=(obj.topic or "")[:60], platform=obj.platform,
            status=obj.status, image_url=obj.thumbnail_url,
            video_url=obj.video_url, thumbnail_url=obj.thumbnail_url,
            content=obj.script, hashtags=obj.hashtags,
            scheduled_at=new_dt.isoformat(),
            published_at=new_dt.isoformat(),
            created_at=obj.created_at.isoformat(),
        )

    elif item_type == "poster":
        obj = db.query(Poster).filter(Poster.id == item_id, Poster.user_id == current_user.id).first()
        if not obj:
            raise HTTPException(status_code=404, detail="Poster not found")
        # Posters don't have a date column — store note in metadata; update updated_at
        from sqlalchemy import func
        obj.updated_at = new_dt
        db.commit()
        db.refresh(obj)
        return CalendarItem(
            id=obj.id, type="poster", date=new_dt.isoformat(),
            title=(obj.title or "")[:60], platform=None,
            status=obj.status, image_url=obj.background_image_url,
            content=obj.caption, scheduled_at=new_dt.isoformat(),
            created_at=obj.created_at.isoformat(),
        )

    elif item_type == "blog":
        obj = db.query(SeoSave).filter(SeoSave.id == item_id, SeoSave.user_id == current_user.id).first()
        if not obj:
            raise HTTPException(status_code=404, detail="Blog not found")
        existing = json.loads(obj.data or "{}")
        existing["scheduledAt"] = new_dt.isoformat()
        obj.data = json.dumps(existing, ensure_ascii=False)
        db.commit()
        db.refresh(obj)
        return CalendarItem(
            id=obj.id, type="blog", date=new_dt.isoformat(),
            title=(obj.title or "")[:60], platform=None,
            status="scheduled", scheduled_at=new_dt.isoformat(),
            content=existing.get("content", "")[:300] or None,
            created_at=obj.created_at.isoformat(),
        )

    raise HTTPException(status_code=400, detail=f"Unknown item type: {item_type}")