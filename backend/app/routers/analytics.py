"""
Analytics module — first-party tracking pixel + dashboard aggregation.

Three concerns live in this router:
  1. Authenticated site management (create/list/delete tracking sites).
  2. Authenticated summary aggregation over tracking_events.
  3. Public collector + JS pixel (no auth, CORS-open) for the user's website
     to call from the browser.
"""
import hashlib
import json as _json
import logging
import re
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.tracking import TrackingSite, TrackingEvent
from app.models.user import User
from app.services.ai import call_llm_with_fallback

logger = logging.getLogger(__name__)

router = APIRouter(tags=["analytics"])

EVENT_RETENTION_DAYS = 90


def cleanup_old_events(db: Session) -> int:
    """Delete tracking_events older than EVENT_RETENTION_DAYS. Returns row count."""
    from sqlalchemy import delete
    cutoff = datetime.now(timezone.utc) - timedelta(days=EVENT_RETENTION_DAYS)
    res = db.execute(delete(TrackingEvent).where(TrackingEvent.created_at < cutoff))
    db.commit()
    return res.rowcount or 0


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class SiteCreateRequest(BaseModel):
    domain: str
    name: Optional[str] = None


class SiteResponse(BaseModel):
    id: str
    domain: str
    name: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class CollectPayload(BaseModel):
    site: str
    type: str = "pageview"
    url: Optional[str] = None
    referrer: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_DOMAIN_RE = re.compile(
    r"^(?!-)(?:[A-Za-z0-9-]{1,63}\.)+[A-Za-z]{2,63}$"
)


def _normalize_domain(value: str) -> str:
    """Strip scheme/path, lowercase, drop leading 'www.'."""
    v = value.strip().lower()
    if "://" in v:
        v = urlparse(v).netloc or v.split("://", 1)[1]
    v = v.split("/")[0].strip()
    if v.startswith("www."):
        v = v[4:]
    return v


def _device_from_ua(ua: str) -> str:
    ua_l = ua.lower()
    if "mobile" in ua_l or "android" in ua_l or "iphone" in ua_l:
        return "mobile"
    if "ipad" in ua_l or "tablet" in ua_l:
        return "tablet"
    return "desktop"


def _browser_from_ua(ua: str) -> str:
    ua_l = ua.lower()
    if "edg/" in ua_l:
        return "Edge"
    if "chrome/" in ua_l and "chromium" not in ua_l:
        return "Chrome"
    if "safari/" in ua_l and "chrome" not in ua_l:
        return "Safari"
    if "firefox/" in ua_l:
        return "Firefox"
    return "Other"


_BOT_PATTERNS = ("bot", "spider", "crawl", "headlesschrome", "phantomjs", "slurp")


def _is_bot(ua: str) -> bool:
    ua_l = ua.lower()
    return any(p in ua_l for p in _BOT_PATTERNS)


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "0.0.0.0"


# In-memory rolling window per IP — single-process only, fine for v1.
_RATE_BUCKET: dict[str, deque] = defaultdict(deque)
_RATE_LIMIT = 60     # max events
_RATE_WINDOW = 60.0  # per N seconds


def _rate_limited(ip: str) -> bool:
    now = time.time()
    q = _RATE_BUCKET[ip]
    while q and now - q[0] > _RATE_WINDOW:
        q.popleft()
    if len(q) >= _RATE_LIMIT:
        return True
    q.append(now)
    return False


def _origin_matches(referer: str | None, origin: str | None, domain: str) -> bool:
    """Loose check: does the request come from a host on (or sub of) site.domain?"""
    candidates: list[str] = []
    for h in (referer, origin):
        if not h:
            continue
        try:
            host = urlparse(h).netloc.lower().split(":")[0]
            if host.startswith("www."):
                host = host[4:]
            if host:
                candidates.append(host)
        except Exception:
            continue
    if not candidates:
        return True  # missing — don't reject; some browsers strip referer
    d = domain.lower()
    return any(c == d or c.endswith("." + d) for c in candidates)


def _visitor_hash(ip: str, ua: str, site_id: str) -> str:
    """Daily-rotating visitor identifier — no cookies, no PII stored."""
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    raw = f"{day}|{site_id}|{ip}|{ua}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Site management (authenticated)
# ---------------------------------------------------------------------------

@router.get("/api/analytics/sites", response_model=list[SiteResponse])
def list_sites(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(TrackingSite)
        .filter(TrackingSite.user_id == current_user.id)
        .order_by(TrackingSite.created_at.desc())
        .all()
    )
    return rows


@router.post("/api/analytics/sites", response_model=SiteResponse, status_code=status.HTTP_201_CREATED)
def create_site(
    payload: SiteCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    domain = _normalize_domain(payload.domain)
    if not _DOMAIN_RE.match(domain):
        raise HTTPException(status_code=400, detail="Invalid domain")

    existing = (
        db.query(TrackingSite)
        .filter(TrackingSite.user_id == current_user.id, TrackingSite.domain == domain)
        .first()
    )
    if existing:
        return existing

    site = TrackingSite(
        user_id=current_user.id,
        domain=domain,
        name=(payload.name or "").strip() or None,
    )
    db.add(site)
    db.commit()
    db.refresh(site)
    return site


@router.delete("/api/analytics/sites/{site_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_site(
    site_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    site = db.query(TrackingSite).filter(
        TrackingSite.id == site_id,
        TrackingSite.user_id == current_user.id,
    ).first()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    db.query(TrackingEvent).filter(TrackingEvent.site_id == site_id).delete()
    db.delete(site)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Summary aggregation (authenticated)
# ---------------------------------------------------------------------------

_RANGE_DAYS = {"24h": 1, "7d": 7, "30d": 30, "90d": 90}


def _require_owned_site(db: Session, user_id: str, site_id: str) -> TrackingSite:
    site = db.query(TrackingSite).filter(
        TrackingSite.id == site_id,
        TrackingSite.user_id == user_id,
    ).first()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    return site


@router.get("/api/analytics/site/{site_id}/summary")
def site_summary(
    site_id: str,
    range: str = "7d",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    site = _require_owned_site(db, current_user.id, site_id)
    days = _RANGE_DAYS.get(range, 7)
    since = datetime.now(timezone.utc) - timedelta(days=days)

    base = db.query(TrackingEvent).filter(
        TrackingEvent.site_id == site.id,
        TrackingEvent.created_at >= since,
    )

    pageviews = base.filter(TrackingEvent.type == "pageview").count()
    visitors = (
        db.query(func.count(func.distinct(TrackingEvent.visitor_hash)))
        .filter(
            TrackingEvent.site_id == site.id,
            TrackingEvent.created_at >= since,
        )
        .scalar()
        or 0
    )

    # Bounce rate: visitors with exactly 1 pageview / total visitors
    sub = (
        db.query(
            TrackingEvent.visitor_hash,
            func.count(TrackingEvent.id).label("cnt"),
        )
        .filter(
            TrackingEvent.site_id == site.id,
            TrackingEvent.type == "pageview",
            TrackingEvent.created_at >= since,
        )
        .group_by(TrackingEvent.visitor_hash)
        .subquery()
    )
    bounced = db.query(func.count()).select_from(sub).filter(sub.c.cnt == 1).scalar() or 0
    total_visitors_with_pv = db.query(func.count()).select_from(sub).scalar() or 0
    bounce_rate = round(100 * bounced / total_visitors_with_pv, 1) if total_visitors_with_pv else 0.0
    pages_per_visit = round(pageviews / total_visitors_with_pv, 2) if total_visitors_with_pv else 0.0

    # Timeseries (pageviews/day)
    ts_rows = (
        db.query(
            func.date_trunc("day", TrackingEvent.created_at).label("day"),
            func.count(TrackingEvent.id).label("c"),
        )
        .filter(
            TrackingEvent.site_id == site.id,
            TrackingEvent.type == "pageview",
            TrackingEvent.created_at >= since,
        )
        .group_by("day")
        .order_by("day")
        .all()
    )
    timeseries = [{"date": r.day.isoformat(), "pageviews": r.c} for r in ts_rows]

    def _top(column, limit=10):
        rows = (
            db.query(column, func.count(TrackingEvent.id).label("c"))
            .filter(
                TrackingEvent.site_id == site.id,
                TrackingEvent.type == "pageview",
                TrackingEvent.created_at >= since,
            )
            .group_by(column)
            .order_by(func.count(TrackingEvent.id).desc())
            .limit(limit)
            .all()
        )
        return [{"value": r[0] or "(unknown)", "count": r[1]} for r in rows]

    return {
        "site": {"id": site.id, "domain": site.domain, "name": site.name},
        "range": range,
        "totals": {
            "pageviews": pageviews,
            "visitors": int(visitors),
            "bounce_rate": bounce_rate,
            "pages_per_visit": pages_per_visit,
        },
        "timeseries": timeseries,
        "top_pages": _top(TrackingEvent.path),
        "top_referrers": _top(TrackingEvent.referrer),
        "top_countries": _top(TrackingEvent.country),
        "devices": _top(TrackingEvent.device, limit=5),
        "browsers": _top(TrackingEvent.browser, limit=5),
    }


@router.get("/api/analytics/site/{site_id}/insights")
def site_insights(
    site_id: str,
    range: str = "7d",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """3-bullet plain-English summary of the analytics for this site."""
    summary = site_summary(site_id, range, current_user, db)  # reuse
    if summary["totals"]["pageviews"] == 0:
        return {"insights": ["No data yet — install the snippet and revisit this card after some visitors arrive."]}

    prompt = (
        "You are an analytics analyst. Given this JSON for a website's traffic, "
        "return EXACTLY 3 short bullets (<=22 words each) with the most useful "
        "observations for the site owner. Mention concrete numbers, top pages, "
        "and traffic sources. Avoid filler.\n\n"
        f"DATA:\n{_json.dumps(summary, default=str)[:6000]}\n\n"
        "Return JSON: {\"insights\": [\"...\", \"...\", \"...\"]}"
    )
    try:
        raw = call_llm_with_fallback(prompt, expect_json=True, caller="analytics_insights")
        data = _json.loads(raw)
        bullets = data.get("insights") or []
        return {"insights": [str(b)[:240] for b in bullets][:3]}
    except Exception as e:
        logger.warning("insights LLM failed: %s", e)
        # Deterministic fallback
        t = summary["totals"]
        top = (summary["top_pages"][0]["value"] if summary["top_pages"] else "/")
        return {"insights": [
            f"{t['pageviews']} pageviews from {t['visitors']} visitors over the last {range}.",
            f"Top page: {top}. Bounce rate {t['bounce_rate']}%, {t['pages_per_visit']} pages/visit.",
            "Insights from AI are unavailable right now — try refreshing in a moment.",
        ]}


@router.get("/api/analytics/site/{site_id}/realtime")
def site_realtime(
    site_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    site = _require_owned_site(db, current_user.id, site_id)
    since = datetime.now(timezone.utc) - timedelta(minutes=30)
    visitors = (
        db.query(func.count(func.distinct(TrackingEvent.visitor_hash)))
        .filter(TrackingEvent.site_id == site.id, TrackingEvent.created_at >= since)
        .scalar()
        or 0
    )
    last_event = (
        db.query(TrackingEvent.created_at)
        .filter(TrackingEvent.site_id == site.id)
        .order_by(TrackingEvent.created_at.desc())
        .first()
    )
    return {
        "active_visitors": int(visitors),
        "last_event_at": last_event[0].isoformat() if last_event else None,
        "verified": last_event is not None,
    }


# ---------------------------------------------------------------------------
# Public collector + pixel (NO auth, CORS-open)
# ---------------------------------------------------------------------------

@router.options("/api/track/collect")
def track_collect_options():
    return Response(
        status_code=204,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "86400",
        },
    )


@router.post("/api/track/collect")
async def track_collect(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    response.headers["Access-Control-Allow-Origin"] = "*"

    ip = _client_ip(request)
    if _rate_limited(ip):
        return {"ok": False, "reason": "rate_limited"}

    # Read raw body so we accept text/plain (sendBeacon w/ Blob 'text/plain'
    # avoids CORS preflight from arbitrary user domains).
    try:
        raw = await request.body()
        data = _json.loads(raw.decode("utf-8") or "{}")
        payload = CollectPayload(**data)
    except Exception:
        return {"ok": False, "reason": "bad_payload"}
    site = db.query(TrackingSite).filter(TrackingSite.id == payload.site).first()
    if not site:
        return {"ok": False, "reason": "unknown_site"}

    if not _origin_matches(
        request.headers.get("referer"),
        request.headers.get("origin"),
        site.domain,
    ):
        return {"ok": False, "reason": "origin_mismatch"}

    ua = request.headers.get("user-agent", "")
    if _is_bot(ua):
        return {"ok": True, "skipped": "bot"}

    path = "/"
    if payload.url:
        try:
            parsed = urlparse(payload.url)
            path = (parsed.path or "/")[:500]
        except Exception:
            path = "/"

    ip = _client_ip(request)
    country = (
        request.headers.get("cf-ipcountry")
        or request.headers.get("x-vercel-ip-country")
        or None
    )

    event = TrackingEvent(
        site_id=site.id,
        type=(payload.type or "pageview")[:20],
        path=path,
        referrer=(payload.referrer or None) and payload.referrer[:500],
        country=country[:8] if country else None,
        device=_device_from_ua(ua),
        browser=_browser_from_ua(ua),
        visitor_hash=_visitor_hash(ip, ua, site.id),
    )
    db.add(event)
    db.commit()
    return {"ok": True}


# Allow the snippet host to be overridden via env (NEXT_PUBLIC_API_URL),
# but at runtime we just use the request origin so users can copy-paste.
_TRACK_JS = """(function(){
  try {
    var s = document.currentScript;
    var siteId = s && s.getAttribute('data-site');
    if (!siteId) return;
    var endpoint = (s && s.getAttribute('data-endpoint')) || (new URL(s.src)).origin + '/api/track/collect';

    function send(type){
      var body = JSON.stringify({
        site: siteId,
        type: type || 'pageview',
        url: location.href,
        referrer: document.referrer || null
      });
      try {
        if (navigator.sendBeacon) {
          navigator.sendBeacon(endpoint, new Blob([body], {type: 'text/plain'}));
        } else {
          fetch(endpoint, {method:'POST', headers:{'Content-Type':'text/plain'}, body: body, keepalive: true, mode: 'cors'});
        }
      } catch(e) {}
    }

    send('pageview');

    var lastUrl = location.href;
    var origPush = history.pushState;
    history.pushState = function(){ origPush.apply(this, arguments); setTimeout(check, 0); };
    window.addEventListener('popstate', check);
    function check(){
      if (location.href !== lastUrl){ lastUrl = location.href; send('pageview'); }
    }

    document.addEventListener('click', function(ev){
      var a = ev.target && ev.target.closest && ev.target.closest('a[href^="http"], [data-track]');
      if (!a) return;
      try {
        var dest = a.getAttribute('href') || '';
        if (dest && new URL(dest, location.href).host !== location.host) send('outbound');
        else if (a.hasAttribute('data-track')) send('event');
      } catch(e) {}
    }, true);
  } catch(e) {}
})();
"""


@router.get("/track.js")
def serve_pixel():
    return PlainTextResponse(
        _TRACK_JS,
        media_type="application/javascript; charset=utf-8",
        headers={"Cache-Control": "public, max-age=300"},
    )


# ---------------------------------------------------------------------------
# URL Inspect — content + SEO health for any public URL
# ---------------------------------------------------------------------------

class UrlInspectRequest(BaseModel):
    url: str


_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def _fetch_for_inspect(url: str) -> str:
    """Try ScrapingAnt if available, else direct httpx."""
    import os
    key = os.getenv("SCRAPINGANT_API_KEY", "")
    if key:
        try:
            r = httpx.get(
                "https://api.scrapingant.com/v2/extended",
                params={"url": url, "x-api-key": key, "browser": "false"},
                timeout=25.0,
                follow_redirects=True,
            )
            r.raise_for_status()
            data = r.json()
            html = data.get("content") or data.get("html") or ""
            if html:
                return html
        except Exception as e:
            logger.warning("ScrapingAnt inspect failed: %s", e)
    r = httpx.get(url, headers={"User-Agent": _USER_AGENT},
                  timeout=20.0, follow_redirects=True, verify=False)
    r.raise_for_status()
    return r.text


@router.post("/api/analytics/url/inspect")
def inspect_url(
    payload: UrlInspectRequest,
    current_user: User = Depends(get_current_user),
):
    url = payload.url.strip()
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    try:
        html = _fetch_for_inspect(url)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not fetch URL: {e}")

    soup = BeautifulSoup(html, "lxml")
    parsed = urlparse(url)

    title = soup.find("title")
    title_text = title.get_text(strip=True) if title else ""
    meta_desc_tag = soup.find("meta", attrs={"name": "description"})
    meta_desc = (meta_desc_tag.get("content") or "").strip() if meta_desc_tag else ""
    canonical = soup.find("link", rel="canonical")
    canonical_url = canonical.get("href", "") if canonical else ""
    og_title = soup.find("meta", property="og:title")
    og_image = soup.find("meta", property="og:image")
    twitter_card = soup.find("meta", attrs={"name": "twitter:card"})

    h1 = [t.get_text(strip=True) for t in soup.find_all("h1") if t.get_text(strip=True)]
    h2 = [t.get_text(strip=True) for t in soup.find_all("h2") if t.get_text(strip=True)]
    h3 = [t.get_text(strip=True) for t in soup.find_all("h3") if t.get_text(strip=True)]

    imgs = soup.find_all("img")
    missing_alt = sum(1 for i in imgs if not (i.get("alt") or "").strip())

    links = soup.find_all("a", href=True)
    internal = external = 0
    for a in links:
        try:
            host = urlparse(a["href"]).netloc.lower()
            if not host or host == parsed.netloc.lower():
                internal += 1
            else:
                external += 1
        except Exception:
            continue

    main_text = ""
    for tag in ("article", "main"):
        el = soup.find(tag)
        if el:
            main_text = el.get_text(" ", strip=True)
            break
    if not main_text and soup.body:
        for x in soup.body(["script", "style", "nav", "footer", "header", "aside"]):
            x.decompose()
        main_text = soup.body.get_text(" ", strip=True)
    words = len([w for w in re.split(r"\s+", main_text) if w])
    reading_min = max(1, round(words / 220))

    schema = bool(soup.find("script", attrs={"type": "application/ld+json"}))

    checks = [
        {"name": "Title length 30-65 chars", "ok": 30 <= len(title_text) <= 65, "value": f"{len(title_text)} chars"},
        {"name": "Meta description 70-160 chars", "ok": 70 <= len(meta_desc) <= 160, "value": f"{len(meta_desc)} chars"},
        {"name": "Single H1", "ok": len(h1) == 1, "value": f"{len(h1)} found"},
        {"name": "Canonical URL set", "ok": bool(canonical_url), "value": canonical_url or "missing"},
        {"name": "Open Graph title + image", "ok": bool(og_title and og_image), "value": "present" if (og_title and og_image) else "missing"},
        {"name": "Twitter card meta", "ok": bool(twitter_card), "value": "present" if twitter_card else "missing"},
        {"name": "Schema.org JSON-LD", "ok": schema, "value": "present" if schema else "missing"},
        {"name": "All images have alt text", "ok": missing_alt == 0, "value": f"{missing_alt}/{len(imgs)} missing"},
        {"name": "Word count >= 300", "ok": words >= 300, "value": f"{words} words"},
    ]
    score = round(100 * sum(1 for c in checks if c["ok"]) / max(1, len(checks)))

    return {
        "url": url,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "score": score,
        "checks": checks,
        "content": {
            "title": title_text,
            "meta_description": meta_desc,
            "h1": h1[:5],
            "h2_count": len(h2),
            "h3_count": len(h3),
            "word_count": words,
            "reading_minutes": reading_min,
            "image_count": len(imgs),
            "missing_alt_count": missing_alt,
            "internal_links": internal,
            "external_links": external,
            "html_size_kb": round(len(html) / 1024, 1),
        },
    }
