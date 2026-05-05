"""
YouTube OAuth provider (uses Google OAuth 2.0).

Google issues a refresh_token ONLY on the very first authorization with
`access_type=offline` AND `prompt=consent`. Without these, a re-authorizing
user gets a new access token but no refresh token. We always include both so
refresh works reliably.

Analytics: per-video stats (views, likes, comments) come from the YouTube
Data API v3 `videos.list` with `part=statistics`. Watch-time + retention
require YouTube Analytics API (separate scope) — out of scope here.
"""
from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urlencode

import httpx

from app.config import settings
from app.models.social_account import SocialAccount
from app.services.oauth import (
    AccountProfile,
    OAuthProvider,
    PostMetrics,
    TokenBundle,
    register,
)

logger = logging.getLogger(__name__)

GOOGLE_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
YT_API = "https://www.googleapis.com/youtube/v3"

_YT_SCOPES = " ".join([
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
    "openid",
    "email",
])


class YouTubeProvider(OAuthProvider):
    platform = "youtube"

    def is_configured(self) -> bool:
        return bool(settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET)

    def auth_url(self, *, redirect_uri: str, state: str) -> str:
        params = {
            "client_id": settings.GOOGLE_CLIENT_ID,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": _YT_SCOPES,
            "state": state,
            "access_type": "offline",   # required to get a refresh_token
            "prompt": "consent",         # forces refresh_token even on re-auth
            "include_granted_scopes": "true",
        }
        return f"{GOOGLE_AUTHORIZE}?{urlencode(params)}"

    async def exchange_code(
        self, *, code: str, redirect_uri: str
    ) -> TokenBundle:
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.post(
                GOOGLE_TOKEN,
                data={
                    "code": code,
                    "client_id": settings.GOOGLE_CLIENT_ID,
                    "client_secret": settings.GOOGLE_CLIENT_SECRET,
                    "redirect_uri": redirect_uri,
                    "grant_type": "authorization_code",
                },
            )
            r.raise_for_status()
            data = r.json()

        return TokenBundle(
            access_token=data["access_token"],
            refresh_token=data.get("refresh_token"),
            expires_in=data.get("expires_in"),  # ~3600s
            scope=data.get("scope") or _YT_SCOPES,
        )

    async def refresh(self, account: SocialAccount) -> TokenBundle | None:
        if not account.refresh_token:
            return None
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.post(
                GOOGLE_TOKEN,
                data={
                    "client_id": settings.GOOGLE_CLIENT_ID,
                    "client_secret": settings.GOOGLE_CLIENT_SECRET,
                    "refresh_token": account.refresh_token,
                    "grant_type": "refresh_token",
                },
            )
            if r.status_code != 200:
                logger.warning("[YT refresh] %s: %s", r.status_code, r.text[:200])
                return None
            data = r.json()

        # Google sometimes omits refresh_token on refresh — keep the existing.
        return TokenBundle(
            access_token=data["access_token"],
            refresh_token=data.get("refresh_token") or account.refresh_token,
            expires_in=data.get("expires_in"),
            scope=data.get("scope"),
        )

    async def fetch_profile(self, token: TokenBundle) -> AccountProfile:
        """Pull the user's primary YouTube channel."""
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(
                f"{YT_API}/channels",
                params={"part": "snippet,id", "mine": "true"},
                headers={"Authorization": f"Bearer {token.access_token}"},
            )
            r.raise_for_status()
            items = r.json().get("items", []) or []

        if not items:
            raise ValueError(
                "No YouTube channel found on this Google account. Create a "
                "channel at studio.youtube.com first."
            )
        ch = items[0]
        snip = ch.get("snippet", {}) or {}
        return AccountProfile(
            provider_user_id=ch["id"],
            page_id=ch["id"],
            page_name=snip.get("title") or "YouTube channel",
            extra={
                "thumbnail": (snip.get("thumbnails") or {}).get("default", {}).get("url"),
                "custom_url": snip.get("customUrl"),
            },
        )

    async def fetch_post_analytics(
        self, account: SocialAccount, external_post_id: str
    ) -> PostMetrics:
        """`external_post_id` is the 11-char video id."""
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(
                f"{YT_API}/videos",
                params={"part": "statistics", "id": external_post_id},
                headers={"Authorization": f"Bearer {account.access_token}"},
            )
            if r.status_code != 200:
                logger.warning(
                    "[YT analytics] %s: %s", r.status_code, r.text[:200]
                )
                return PostMetrics()
            items = r.json().get("items", []) or []

        if not items:
            return PostMetrics()
        stats: dict[str, Any] = items[0].get("statistics", {}) or {}

        # YouTube returns counts as strings; coerce to int defensively.
        def _i(key: str) -> int | None:
            v = stats.get(key)
            try:
                return int(v) if v is not None else None
            except (ValueError, TypeError):
                return None

        return PostMetrics(
            views=_i("viewCount"),
            likes=_i("likeCount"),
            comments=_i("commentCount"),
            raw=stats,
        )


register(YouTubeProvider())
