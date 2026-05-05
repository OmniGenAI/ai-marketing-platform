"""
LinkedIn OAuth provider.

LinkedIn issues 60-day access tokens with NO refresh token (the user must
re-authorize when it expires). Analytics for personal posts are limited to
share-level reactions/comments via the `socialActions` endpoint; richer
post-impression analytics require a Marketing Developer Platform partnership
(out of scope here — we return whatever the standard API exposes).
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

LI_AUTHORIZE_URL = "https://www.linkedin.com/oauth/v2/authorization"
LI_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken"
LI_API = "https://api.linkedin.com/v2"
LI_REST = "https://api.linkedin.com/rest"

# OpenID + posting + member-level read scopes. `r_organization_social` is
# only useful for company pages and is conditionally included only if the
# operator wants it (uncomment in your LinkedIn app config first).
_LI_SCOPES = " ".join([
    "openid",
    "profile",
    "email",
    "w_member_social",  # publish on behalf of the member
])


class LinkedInProvider(OAuthProvider):
    platform = "linkedin"

    def is_configured(self) -> bool:
        return bool(settings.LINKEDIN_CLIENT_ID and settings.LINKEDIN_CLIENT_SECRET)

    def auth_url(self, *, redirect_uri: str, state: str) -> str:
        params = {
            "response_type": "code",
            "client_id": settings.LINKEDIN_CLIENT_ID,
            "redirect_uri": redirect_uri,
            "scope": _LI_SCOPES,
            "state": state,
        }
        return f"{LI_AUTHORIZE_URL}?{urlencode(params)}"

    async def exchange_code(
        self, *, code: str, redirect_uri: str
    ) -> TokenBundle:
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.post(
                LI_TOKEN_URL,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": redirect_uri,
                    "client_id": settings.LINKEDIN_CLIENT_ID,
                    "client_secret": settings.LINKEDIN_CLIENT_SECRET,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            r.raise_for_status()
            data = r.json()

        return TokenBundle(
            access_token=data["access_token"],
            refresh_token=data.get("refresh_token"),
            expires_in=data.get("expires_in"),  # ~5184000s = 60 days
            scope=data.get("scope") or _LI_SCOPES,
        )

    async def fetch_profile(self, token: TokenBundle) -> AccountProfile:
        # The OpenID `userinfo` endpoint returns sub (LinkedIn ID), name, picture.
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(
                f"{LI_API}/userinfo",
                headers={"Authorization": f"Bearer {token.access_token}"},
            )
            r.raise_for_status()
            user = r.json()

        sub = user.get("sub", "")
        # LinkedIn's publish API needs the member URN: urn:li:person:{sub}.
        page_id = f"urn:li:person:{sub}" if sub else ""

        return AccountProfile(
            provider_user_id=sub,
            page_id=page_id,
            page_name=user.get("name") or user.get("email") or "LinkedIn member",
            extra={
                "email": user.get("email"),
                "picture": user.get("picture"),
            },
        )

    async def fetch_post_analytics(
        self, account: SocialAccount, external_post_id: str
    ) -> PostMetrics:
        """LinkedIn returns post-level reactions + comments via socialActions.
        Impressions/reach are NOT available without Marketing Developer
        Platform access — we leave those as None."""
        urn = external_post_id  # expected: "urn:li:share:..." or "urn:li:ugcPost:..."
        # socialActions wants the URN URL-encoded.
        from urllib.parse import quote
        encoded = quote(urn, safe="")
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(
                f"{LI_API}/socialActions/{encoded}",
                headers={
                    "Authorization": f"Bearer {account.access_token}",
                    "X-Restli-Protocol-Version": "2.0.0",
                },
            )
            if r.status_code != 200:
                logger.warning(
                    "[LinkedIn analytics] %s: %s", r.status_code, r.text[:200]
                )
                return PostMetrics()
            data: dict[str, Any] = r.json()

        likes = (data.get("likesSummary") or {}).get("totalLikes")
        comments = (data.get("commentsSummary") or {}).get("totalFirstLevelComments")

        return PostMetrics(
            likes=likes,
            comments=comments,
            raw=data,
        )


register(LinkedInProvider())
