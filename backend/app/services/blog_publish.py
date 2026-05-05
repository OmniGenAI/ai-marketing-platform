"""
Blog publishing service.

Publishes a saved blog draft (markdown content stored in seo_saves.data) to a
connected blogging platform. Currently supports Dev.to; LinkedIn long-form
articles, Hashnode, and others can be added by following the same pattern.

Each provider's publish function:
  - Pulls the user's connected SocialAccount for the platform
  - POSTs the markdown body + frontmatter to the platform's API
  - Returns the platform-issued article id + canonical URL

The caller persists those values back into the seo_save's `data` JSON so the
analytics dashboard can later fetch engagement metrics.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

from app.models.social_account import SocialAccount

logger = logging.getLogger(__name__)

DEVTO_API = "https://dev.to/api"


@dataclass
class PublishResult:
    """Outcome of a successful publish — written back into seo_saves.data."""

    platform: str
    external_post_id: str  # platform's article id (string-cast for portability)
    url: str
    raw: dict


# ---------------------------------------------------------------------------
# Dev.to
# ---------------------------------------------------------------------------
async def publish_to_devto(
    *,
    account: SocialAccount,
    title: str,
    markdown: str,
    tags: list[str] | None = None,
    canonical_url: str | None = None,
    publish: bool = True,
) -> PublishResult:
    """Publish a markdown article to Dev.to using the user's API key.

    `tags` are normalised: max 4, alphanumeric only, lowercase (Dev.to rules).
    `canonical_url` lets users mark Dev.to as a republish to avoid SEO conflict
    with their own blog.

    Raises ValueError on validation failures, httpx.HTTPStatusError on API errors.
    """
    if not account.access_token:
        raise ValueError("Dev.to is not connected — paste your API key in Settings.")
    if not title.strip():
        raise ValueError("Title is required.")
    if not markdown.strip():
        raise ValueError("Article body is empty.")

    # Dev.to constraints: alphanumeric tags, max 4, lowercase, ≤30 chars.
    clean_tags: list[str] = []
    for raw in (tags or [])[:8]:
        slug = "".join(ch for ch in (raw or "").lower() if ch.isalnum())[:30]
        if slug and slug not in clean_tags:
            clean_tags.append(slug)
        if len(clean_tags) >= 4:
            break

    article_payload: dict = {
        "title": title.strip()[:128],  # Dev.to title cap
        "published": publish,
        "body_markdown": markdown,
    }
    if clean_tags:
        article_payload["tags"] = clean_tags
    if canonical_url:
        article_payload["canonical_url"] = canonical_url

    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(
            f"{DEVTO_API}/articles",
            headers={
                "api-key": account.access_token,
                "Content-Type": "application/json",
                "Accept": "application/vnd.forem.api-v1+json",
            },
            json={"article": article_payload},
        )

        if r.status_code == 401:
            raise ValueError(
                "Dev.to rejected the API key. Reconnect in Settings."
            )
        if r.status_code == 422:
            # Validation error — surface their message verbatim so users can fix it.
            try:
                detail = r.json().get("error") or r.text
            except Exception:
                detail = r.text
            raise ValueError(f"Dev.to validation failed: {detail}")
        r.raise_for_status()
        data = r.json()

    article_id = data.get("id")
    url = data.get("url") or data.get("canonical_url") or ""
    if not article_id:
        raise ValueError("Dev.to API returned no article id.")

    logger.info("[blog publish] devto article %s → %s", article_id, url)
    return PublishResult(
        platform="devto",
        external_post_id=str(article_id),
        url=url,
        raw={
            "slug": data.get("slug"),
            "published_at": data.get("published_at"),
            "published": data.get("published"),
            "tag_list": data.get("tag_list"),
        },
    )
