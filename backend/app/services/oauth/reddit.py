"""
Reddit OAuth provider.

Reddit uses HTTP Basic auth on the token endpoint (client_id:client_secret),
issues a 1-hour access token, and (with `duration=permanent`) returns a
refresh token. A custom User-Agent is mandatory per Reddit's TOS — we read
it from `settings.REDDIT_USER_AGENT`.

Analytics: per-submission upvotes/comments come from `/api/info` (no auth
upgrade required). Real impressions/reach are not exposed by Reddit's
public API.
"""
from __future__ import annotations

import base64
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

REDDIT_AUTHORIZE = "https://www.reddit.com/api/v1/authorize"
REDDIT_TOKEN = "https://www.reddit.com/api/v1/access_token"
REDDIT_OAUTH_API = "https://oauth.reddit.com"

_REDDIT_SCOPES = " ".join([
    "identity",
    "submit",
    "read",
    "history",
    "edit",
])


def _basic_auth_header() -> str:
    raw = f"{settings.REDDIT_CLIENT_ID}:{settings.REDDIT_CLIENT_SECRET}"
    return "Basic " + base64.b64encode(raw.encode()).decode()


class RedditProvider(OAuthProvider):
    platform = "reddit"

    def is_configured(self) -> bool:
        return bool(settings.REDDIT_CLIENT_ID and settings.REDDIT_CLIENT_SECRET)

    def auth_url(self, *, redirect_uri: str, state: str) -> str:
        params = {
            "client_id": settings.REDDIT_CLIENT_ID,
            "response_type": "code",
            "state": state,
            "redirect_uri": redirect_uri,
            "duration": "permanent",  # required for refresh_token
            "scope": _REDDIT_SCOPES,
        }
        return f"{REDDIT_AUTHORIZE}?{urlencode(params)}"

    async def exchange_code(
        self, *, code: str, redirect_uri: str, state: str | None = None,
    ) -> TokenBundle:
        del state  # not used
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.post(
                REDDIT_TOKEN,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": redirect_uri,
                },
                headers={
                    "Authorization": _basic_auth_header(),
                    "User-Agent": settings.REDDIT_USER_AGENT,
                },
            )
            r.raise_for_status()
            data = r.json()

        return TokenBundle(
            access_token=data["access_token"],
            refresh_token=data.get("refresh_token"),
            expires_in=data.get("expires_in"),  # ~3600s
            scope=data.get("scope") or _REDDIT_SCOPES,
        )

    async def refresh(self, account: SocialAccount) -> TokenBundle | None:
        if not account.refresh_token:
            return None
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.post(
                REDDIT_TOKEN,
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": account.refresh_token,
                },
                headers={
                    "Authorization": _basic_auth_header(),
                    "User-Agent": settings.REDDIT_USER_AGENT,
                },
            )
            if r.status_code != 200:
                logger.warning(
                    "[Reddit refresh] %s: %s", r.status_code, r.text[:200]
                )
                return None
            data = r.json()

        return TokenBundle(
            access_token=data["access_token"],
            # Reddit doesn't return a fresh refresh_token; reuse the old one.
            refresh_token=account.refresh_token,
            expires_in=data.get("expires_in"),
            scope=data.get("scope"),
        )

    async def fetch_profile(self, token: TokenBundle) -> AccountProfile:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(
                f"{REDDIT_OAUTH_API}/api/v1/me",
                headers={
                    "Authorization": f"Bearer {token.access_token}",
                    "User-Agent": settings.REDDIT_USER_AGENT,
                },
            )
            r.raise_for_status()
            me = r.json()

        return AccountProfile(
            provider_user_id=str(me.get("id", "")),
            page_id=me.get("name") or "",
            page_name=f"u/{me.get('name')}" if me.get("name") else "Reddit",
            extra={
                "link_karma": me.get("link_karma"),
                "comment_karma": me.get("comment_karma"),
            },
        )

    async def fetch_post_analytics(
        self, account: SocialAccount, external_post_id: str
    ) -> PostMetrics:
        """`external_post_id` is the submission fullname (e.g. "t3_abc123")."""
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(
                f"{REDDIT_OAUTH_API}/api/info",
                params={"id": external_post_id},
                headers={
                    "Authorization": f"Bearer {account.access_token}",
                    "User-Agent": settings.REDDIT_USER_AGENT,
                },
            )
            if r.status_code != 200:
                logger.warning(
                    "[Reddit analytics] %s: %s", r.status_code, r.text[:200]
                )
                return PostMetrics()
            data = r.json()

        children = (data.get("data") or {}).get("children", []) or []
        if not children:
            return PostMetrics()
        post: dict[str, Any] = children[0].get("data", {}) or {}

        return PostMetrics(
            views=post.get("view_count"),  # often None — Reddit hides this
            likes=post.get("ups"),
            comments=post.get("num_comments"),
            shares=post.get("num_crossposts"),
            raw={
                "subreddit": post.get("subreddit"),
                "score": post.get("score"),
                "upvote_ratio": post.get("upvote_ratio"),
                "permalink": post.get("permalink"),
            },
        )


register(RedditProvider())
