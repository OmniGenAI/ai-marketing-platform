"""
Twitter / X OAuth 2.0 provider.

Twitter uses OAuth 2.0 with mandatory PKCE (S256). Access tokens last 2
hours; refresh tokens are returned when the `offline.access` scope is
granted and are single-use (each refresh returns a new refresh token).

Notes:
- The auth/token/me endpoints live under https://api.x.com/2 (the new domain).
  api.twitter.com/2 still resolves but x.com is the canonical one.
- App must be set to "Confidential client" in the Twitter dev portal so we
  can authenticate the token request with HTTP Basic auth. For "Public client"
  apps drop the Authorization header and add `client_id` to the form body.
- Analytics for personal posts are limited: the free tier exposes
  `non_public_metrics` only on the *authenticated user's own* tweets via
  `/2/tweets/{id}?tweet.fields=public_metrics,non_public_metrics`. Higher
  tiers needed for organic insights.
"""
from __future__ import annotations

import base64
import hashlib
import logging
import secrets
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

TW_AUTHORIZE = "https://x.com/i/oauth2/authorize"
TW_TOKEN = "https://api.x.com/2/oauth2/token"
TW_API = "https://api.x.com/2"

# Scopes:
#   tweet.read       — read tweet objects
#   tweet.write      — create tweets
#   users.read       — fetch /users/me for profile
#   offline.access   — issue refresh tokens
_TW_SCOPES = " ".join([
    "tweet.read",
    "tweet.write",
    "users.read",
    "offline.access",
])

# PKCE verifier store — maps state → code_verifier so the callback can
# complete the exchange. Same lifetime semantics as the router's state map.
_PKCE_STORE: dict[str, str] = {}


def _basic_auth_header() -> str:
    raw = f"{settings.TWITTER_CLIENT_ID}:{settings.TWITTER_CLIENT_SECRET}"
    return "Basic " + base64.b64encode(raw.encode()).decode()


def _make_pkce() -> tuple[str, str]:
    """Return (code_verifier, code_challenge). Challenge method = S256."""
    verifier = secrets.token_urlsafe(64)[:128]  # 43-128 chars per RFC 7636
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


class TwitterProvider(OAuthProvider):
    platform = "twitter"

    def is_configured(self) -> bool:
        return bool(settings.TWITTER_CLIENT_ID and settings.TWITTER_CLIENT_SECRET)

    def auth_url(self, *, redirect_uri: str, state: str) -> str:
        verifier, challenge = _make_pkce()
        # Stash the verifier keyed on the OAuth state so the callback can
        # complete PKCE without round-tripping through the frontend.
        _PKCE_STORE[state] = verifier
        params = {
            "response_type": "code",
            "client_id": settings.TWITTER_CLIENT_ID,
            "redirect_uri": redirect_uri,
            "scope": _TW_SCOPES,
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
        return f"{TW_AUTHORIZE}?{urlencode(params)}"

    async def exchange_code(
        self, *, code: str, redirect_uri: str, state: str | None = None,
    ) -> TokenBundle:
        # Pop the verifier — single use. Falls back to a synthetic one if
        # missing (will fail at the server, but with a clear error).
        verifier = _PKCE_STORE.pop(state, "") if state else ""

        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.post(
                TW_TOKEN,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": redirect_uri,
                    "client_id": settings.TWITTER_CLIENT_ID,
                    "code_verifier": verifier,
                },
                headers={
                    "Authorization": _basic_auth_header(),
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            )
            if r.status_code != 200:
                logger.warning("[Twitter exchange] %s: %s", r.status_code, r.text[:300])
                r.raise_for_status()
            data = r.json()

        return TokenBundle(
            access_token=data["access_token"],
            refresh_token=data.get("refresh_token"),
            expires_in=data.get("expires_in"),  # 7200s (2h)
            scope=data.get("scope") or _TW_SCOPES,
        )

    async def refresh(self, account: SocialAccount) -> TokenBundle | None:
        if not account.refresh_token:
            return None
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.post(
                TW_TOKEN,
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": account.refresh_token,
                    "client_id": settings.TWITTER_CLIENT_ID,
                },
                headers={
                    "Authorization": _basic_auth_header(),
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            )
            if r.status_code != 200:
                logger.warning("[Twitter refresh] %s: %s", r.status_code, r.text[:200])
                return None
            data = r.json()

        return TokenBundle(
            access_token=data["access_token"],
            # Twitter returns a NEW refresh token each time; persist it.
            refresh_token=data.get("refresh_token") or account.refresh_token,
            expires_in=data.get("expires_in"),
            scope=data.get("scope"),
        )

    async def fetch_profile(self, token: TokenBundle) -> AccountProfile:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(
                f"{TW_API}/users/me",
                params={"user.fields": "username,name,profile_image_url"},
                headers={"Authorization": f"Bearer {token.access_token}"},
            )
            r.raise_for_status()
            payload = r.json()
        me = payload.get("data") or {}

        username = me.get("username") or ""
        return AccountProfile(
            provider_user_id=str(me.get("id", "")),
            page_id=str(me.get("id", "")),
            page_name=f"@{username}" if username else (me.get("name") or "Twitter"),
            extra={
                "username": username,
                "display_name": me.get("name"),
                "profile_image_url": me.get("profile_image_url"),
            },
        )

    async def fetch_post_analytics(
        self, account: SocialAccount, external_post_id: str
    ) -> PostMetrics:
        """Fetch public metrics for a tweet authored by the connected user.

        `external_post_id` is the tweet id. Free tier exposes `public_metrics`
        (likes/retweets/replies/quotes/impressions/bookmark counts).
        """
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(
                f"{TW_API}/tweets/{external_post_id}",
                params={"tweet.fields": "public_metrics,non_public_metrics"},
                headers={"Authorization": f"Bearer {account.access_token}"},
            )
            if r.status_code != 200:
                logger.warning(
                    "[Twitter analytics] %s: %s", r.status_code, r.text[:200]
                )
                return PostMetrics()
            payload = r.json()

        data = payload.get("data") or {}
        pm: dict[str, Any] = data.get("public_metrics") or {}
        npm: dict[str, Any] = data.get("non_public_metrics") or {}

        return PostMetrics(
            impressions=npm.get("impression_count") or pm.get("impression_count"),
            likes=pm.get("like_count"),
            comments=pm.get("reply_count"),
            shares=(pm.get("retweet_count") or 0) + (pm.get("quote_count") or 0),
            views=pm.get("impression_count"),  # alias when impressions absent
            raw={
                "retweets": pm.get("retweet_count"),
                "quotes": pm.get("quote_count"),
                "bookmarks": pm.get("bookmark_count"),
                "url_link_clicks": npm.get("url_link_clicks"),
                "user_profile_clicks": npm.get("user_profile_clicks"),
            },
        )


register(TwitterProvider())
