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

# OpenID + posting scopes for the "Share on LinkedIn" product.
# That product also exposes /rest/reactions?q=entity (FINDER) under
# `w_member_social`, which we use for analytics.
# Reading impressions/comments/shares requires the Community Management API
# or Marketing Developer Platform partnership — out of scope here.
_LI_SCOPES = " ".join([
    "openid",
    "profile",
    "email",
    "w_member_social",   # publish + read own reactions
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
        """Fetch reactions (likes) for a LinkedIn post.

        Uses /rest/reactions?q=entity&entity={urn} — the only read endpoint
        exposed by the "Share on LinkedIn" product under `w_member_social`.

        Comments / impressions / shares / clicks require additional LinkedIn
        products (Community Management API or Marketing Developer Platform)
        and are not available here — those fields remain None.

        Errors are *raised* (not swallowed) so the dashboard's per-row
        ``error`` field surfaces the real cause to the user.
        """
        urn = (external_post_id or "").strip()
        if not urn:
            raise ValueError("LinkedIn post has no URN stored.")
        if not urn.startswith("urn:li:"):
            raise ValueError(
                f"Unexpected LinkedIn URN format: {urn!r} — expected "
                "'urn:li:share:...' or 'urn:li:ugcPost:...'."
            )

        bearer = {"Authorization": f"Bearer {account.access_token}"}

        # `Share on LinkedIn` product exposes exactly one analytics endpoint
        # under `w_member_social`:
        #     GET /rest/reactions?q=entity&entity={urn}
        #
        # LinkedIn accepts the same numeric ID under three different URN
        # types depending on how the post was created/wrapped:
        #     urn:li:share:{id}      ← legacy share API
        #     urn:li:ugcPost:{id}    ← what /v2/ugcPosts returns today
        #     urn:li:activity:{id}   ← the activity that wraps it
        # The id we store comes from /v2/ugcPosts which returns share URNs,
        # but the reactions FINDER often resolves only the ugcPost / activity
        # variant. We try all three before giving up.
        #
        # Comments / impressions / shares are NOT exposed under this product.
        # They require the Community Management API or Marketing Developer
        # Platform partnership.

        # Build URN candidates from the stored URN's numeric id.
        urn_id = urn.rsplit(":", 1)[-1]
        candidates: list[str] = []
        for candidate in (urn, f"urn:li:ugcPost:{urn_id}", f"urn:li:activity:{urn_id}", f"urn:li:share:{urn_id}"):
            if candidate not in candidates:
                candidates.append(candidate)

        last_status: int = 0
        last_body: str = ""

        async with httpx.AsyncClient(timeout=15.0) as client:
            for candidate_urn in candidates:
                for version in ("202401", "202312", "202308"):
                    try:
                        r = await client.get(
                            f"{LI_REST}/reactions",
                            params={"q": "entity", "entity": candidate_urn},
                            headers={
                                **bearer,
                                "LinkedIn-Version": version,
                                "X-Restli-Protocol-Version": "2.0.0",
                            },
                        )
                        if r.status_code == 200:
                            rdata: dict[str, Any] = r.json()
                            paging = rdata.get("paging") or {}
                            elements = rdata.get("elements") or []
                            # Prefer paging.total if available, else element count.
                            likes = paging.get("total")
                            if likes is None:
                                likes = len(elements)
                            logger.info(
                                "[LinkedIn analytics OK] urn=%s v=%s likes=%s",
                                candidate_urn, version, likes,
                            )
                            return PostMetrics(likes=likes, raw=rdata)
                        last_status, last_body = r.status_code, r.text[:300]
                        logger.info(
                            "[LinkedIn rest/reactions urn=%s v=%s] %s: %s",
                            candidate_urn, version, last_status, last_body,
                        )
                        # 426 → retry with another version on same URN.
                        # 404 → try next URN candidate.
                        # Anything else (401/403/5xx) → bail out immediately.
                        if last_status == 426:
                            continue
                        break
                    except Exception as exc:
                        last_status, last_body = 0, str(exc)[:300]
                        logger.info(
                            "[LinkedIn rest/reactions urn=%s] exception: %s",
                            candidate_urn, exc,
                        )
                        break

                # If we got a non-404, non-426 hard failure, stop trying more URNs.
                if last_status and last_status not in (404, 426):
                    break

        if last_status in (401, 403):
            raise PermissionError(
                "LinkedIn rejected analytics access. The connected token "
                "lacks the scope to read reactions on this post. Reconnect "
                "LinkedIn in Settings, then try again."
            )
        # All URN variants returned 404 → the post has zero reactions yet.
        # (LinkedIn returns 404 for an empty result set instead of an empty
        # paged list.)
        if last_status == 404:
            return PostMetrics(likes=0, raw={"note": "no reactions yet"})
        raise RuntimeError(
            f"LinkedIn analytics API error ({last_status or 'network'}): "
            f"{last_body or 'unknown'}"
        )


register(LinkedInProvider())
