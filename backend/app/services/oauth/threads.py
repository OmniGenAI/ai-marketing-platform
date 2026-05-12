"""
Threads OAuth provider (Meta Threads Graph API).

Threads has its own OAuth flow distinct from Facebook/Instagram. Tokens are
short-lived (1h) and must be exchanged for long-lived tokens (60d). Long-
lived tokens can be refreshed before expiry via `refresh_access_token`.

Docs:
- Auth:      https://developers.facebook.com/docs/threads/get-started
- Insights:  https://developers.facebook.com/docs/threads/insights

Scopes used:
    threads_basic              — read user profile + thread list
    threads_content_publish    — post threads
    threads_manage_insights    — read per-thread analytics
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

TH_AUTHORIZE = "https://threads.net/oauth/authorize"
TH_TOKEN = "https://graph.threads.net/oauth/access_token"
TH_LONG_LIVED = "https://graph.threads.net/access_token"
TH_REFRESH = "https://graph.threads.net/refresh_access_token"
TH_API = "https://graph.threads.net/v1.0"

_TH_SCOPES = ",".join([
    "threads_basic",
    "threads_content_publish",
    "threads_manage_insights",
])


class ThreadsProvider(OAuthProvider):
    platform = "threads"

    def is_configured(self) -> bool:
        return bool(settings.THREADS_CLIENT_ID and settings.THREADS_CLIENT_SECRET)

    def auth_url(self, *, redirect_uri: str, state: str) -> str:
        params = {
            "client_id": settings.THREADS_CLIENT_ID,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": _TH_SCOPES,
            "state": state,
        }
        return f"{TH_AUTHORIZE}?{urlencode(params)}"

    async def exchange_code(
        self, *, code: str, redirect_uri: str, state: str | None = None,
    ) -> TokenBundle:
        """Two-step exchange: short-lived (1h) -> long-lived (60d)."""
        del state  # not used
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.post(
                TH_TOKEN,
                data={
                    "client_id": settings.THREADS_CLIENT_ID,
                    "client_secret": settings.THREADS_CLIENT_SECRET,
                    "grant_type": "authorization_code",
                    "redirect_uri": redirect_uri,
                    "code": code,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            if r.status_code != 200:
                logger.warning("[Threads exchange] %s: %s", r.status_code, r.text[:300])
                r.raise_for_status()
            short = r.json()

            short_token = short.get("access_token")
            user_id = str(short.get("user_id", ""))
            if not short_token:
                raise ValueError("Threads token exchange returned no access_token")

            # Upgrade short-lived (~1h) to long-lived (60d). Without this step
            # the user has to reconnect every hour.
            r2 = await client.get(
                TH_LONG_LIVED,
                params={
                    "grant_type": "th_exchange_token",
                    "client_secret": settings.THREADS_CLIENT_SECRET,
                    "access_token": short_token,
                },
            )
            if r2.status_code != 200:
                logger.warning(
                    "[Threads long-lived] %s: %s", r2.status_code, r2.text[:200]
                )
                # Fall back to the short-lived token rather than failing the
                # whole connect — user can still post for the next hour.
                return TokenBundle(
                    access_token=short_token,
                    expires_in=short.get("expires_in"),
                    scope=_TH_SCOPES,
                    extra={"threads_user_id": user_id},
                )
            long_data = r2.json()

        return TokenBundle(
            access_token=long_data["access_token"],
            expires_in=long_data.get("expires_in"),  # ~5184000s (60d)
            scope=_TH_SCOPES,
            extra={"threads_user_id": user_id},
        )

    async def refresh(self, account: SocialAccount) -> TokenBundle | None:
        """Threads long-lived tokens can be refreshed before expiry (no
        refresh_token; the access_token itself is exchanged)."""
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.get(
                TH_REFRESH,
                params={
                    "grant_type": "th_refresh_token",
                    "access_token": account.access_token,
                },
            )
            if r.status_code != 200:
                logger.warning("[Threads refresh] %s: %s", r.status_code, r.text[:200])
                return None
            data = r.json()

        return TokenBundle(
            access_token=data["access_token"],
            expires_in=data.get("expires_in"),
            scope=_TH_SCOPES,
        )

    async def fetch_profile(self, token: TokenBundle) -> AccountProfile:
        user_id = token.extra.get("threads_user_id") or "me"
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(
                f"{TH_API}/{user_id}",
                params={
                    "fields": "id,username,name,threads_profile_picture_url",
                    "access_token": token.access_token,
                },
            )
            r.raise_for_status()
            me = r.json()

        uid = str(me.get("id", "")) or str(user_id)
        username = me.get("username") or ""
        return AccountProfile(
            provider_user_id=uid,
            page_id=uid,
            page_name=f"@{username}" if username else (me.get("name") or "Threads"),
            extra={
                "username": username,
                "display_name": me.get("name"),
                "profile_image_url": me.get("threads_profile_picture_url"),
            },
        )

    async def fetch_post_analytics(
        self, account: SocialAccount, external_post_id: str
    ) -> PostMetrics:
        """Fetch insights for a single thread post.

        `external_post_id` is the Threads media id. Available metrics:
        views, likes, replies, reposts, quotes, shares.
        """
        metrics = "views,likes,replies,reposts,quotes,shares"
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(
                f"{TH_API}/{external_post_id}/insights",
                params={
                    "metric": metrics,
                    "access_token": account.access_token,
                },
            )
            if r.status_code != 200:
                logger.warning(
                    "[Threads analytics] %s: %s", r.status_code, r.text[:200]
                )
                return PostMetrics()
            payload = r.json()

        bucket: dict[str, Any] = {}
        for item in payload.get("data") or []:
            name = item.get("name")
            values = item.get("values") or []
            if name and values:
                bucket[name] = values[0].get("value")

        return PostMetrics(
            views=bucket.get("views"),
            likes=bucket.get("likes"),
            comments=bucket.get("replies"),
            shares=(bucket.get("reposts") or 0)
                   + (bucket.get("quotes") or 0)
                   + (bucket.get("shares") or 0),
            raw={
                "reposts": bucket.get("reposts"),
                "quotes": bucket.get("quotes"),
                "shares_raw": bucket.get("shares"),
            },
        )


register(ThreadsProvider())
