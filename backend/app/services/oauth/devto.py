"""
Dev.to "OAuth" provider — actually an API key flow.

Dev.to has no OAuth. Users generate a personal API key from
https://dev.to/settings/extensions and paste it. We validate by calling
`GET /api/users/me`. The router exposes a special endpoint
`POST /api/social/devto/connect` that uses `connect_with_api_key()` instead
of the OAuth flow.

Analytics: `GET /api/articles/{id}` returns `page_views_count`,
`positive_reactions_count`, and `comments_count` for the user's own posts.
"""
from __future__ import annotations

import logging
from typing import Any

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

DEVTO_API = "https://dev.to/api"


class DevToProvider(OAuthProvider):
    platform = "devto"

    def is_configured(self) -> bool:
        return bool(settings.DEVTO_ENABLED)

    # --- OAuth interface methods are stubs because Dev.to uses API keys ---
    def auth_url(self, *, redirect_uri: str, state: str) -> str:
        raise NotImplementedError(
            "Dev.to uses API keys, not OAuth. Call connect_with_api_key() instead."
        )

    async def exchange_code(
        self, *, code: str, redirect_uri: str, state: str | None = None,
    ) -> TokenBundle:
        del state  # not used
        raise NotImplementedError("Dev.to uses API keys, not OAuth.")

    async def fetch_profile(self, token: TokenBundle) -> AccountProfile:
        return await self._fetch_profile_with_key(token.access_token)

    # ------------------------------------------------------------------
    # API-key specific helpers (called from the router)
    # ------------------------------------------------------------------
    async def connect_with_api_key(
        self, api_key: str
    ) -> tuple[TokenBundle, AccountProfile]:
        """Validate the key by fetching the user profile, return both
        objects so the router can persist them through `upsert_account`."""
        profile = await self._fetch_profile_with_key(api_key)
        token = TokenBundle(
            access_token=api_key,
            scope="api_key",
            extra={"auth_method": "api_key"},
        )
        return token, profile

    async def _fetch_profile_with_key(self, api_key: str) -> AccountProfile:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(
                f"{DEVTO_API}/users/me",
                headers={"api-key": api_key, "Accept": "application/json"},
            )
            if r.status_code == 401:
                raise ValueError(
                    "Invalid Dev.to API key. Generate a new one at "
                    "https://dev.to/settings/extensions and try again."
                )
            r.raise_for_status()
            user = r.json()

        return AccountProfile(
            provider_user_id=str(user.get("id", "")),
            page_id=str(user.get("id", "")),
            page_name=user.get("username") or user.get("name") or "Dev.to",
            extra={
                "twitter_username": user.get("twitter_username"),
                "github_username": user.get("github_username"),
                "summary": user.get("summary"),
            },
        )

    async def fetch_post_analytics(
        self, account: SocialAccount, external_post_id: str
    ) -> PostMetrics:
        """`external_post_id` is the article id (numeric, stored as str)."""
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(
                f"{DEVTO_API}/articles/{external_post_id}",
                headers={
                    "api-key": account.access_token,
                    "Accept": "application/json",
                },
            )
            if r.status_code != 200:
                logger.warning(
                    "[Dev.to analytics] %s: %s", r.status_code, r.text[:200]
                )
                return PostMetrics()
            article: dict[str, Any] = r.json()

        return PostMetrics(
            views=article.get("page_views_count"),
            likes=article.get("positive_reactions_count"),
            comments=article.get("comments_count"),
            raw={
                "tag_list": article.get("tag_list"),
                "published_at": article.get("published_at"),
                "url": article.get("url"),
            },
        )


register(DevToProvider())
