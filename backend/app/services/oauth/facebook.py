"""
Facebook + Instagram OAuth provider.

Both platforms share the same OAuth flow because Instagram Business accounts
are linked to a Facebook Page. The user logs in once with Facebook and we get
both targets. Two separate `OAuthProvider` instances are still registered
(`facebook`, `instagram`) so the UI can show distinct connect cards and the
analytics fetcher can select the right Graph endpoint per platform.
"""
from __future__ import annotations

import json
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

GRAPH_API_VERSION = "v19.0"
GRAPH_BASE = f"https://graph.facebook.com/{GRAPH_API_VERSION}"
FB_OAUTH_DIALOG = f"https://www.facebook.com/{GRAPH_API_VERSION}/dialog/oauth"

# Scopes required to publish + read engagement on pages and IG business accounts.
# `public_profile` is implicit but listing it documents intent.
_FB_SCOPES = ",".join([
    "pages_show_list",
    "pages_read_engagement",
    "pages_manage_posts",
    "pages_manage_metadata",
    "instagram_basic",
    "instagram_content_publish",
    "instagram_manage_insights",
    "read_insights",
    "public_profile",
])


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------
async def _exchange_code_for_user_token(
    *, code: str, redirect_uri: str
) -> dict[str, Any]:
    """Trade auth code for a short-lived user token, then immediately exchange
    it for a long-lived (~60d) one. Single network round-trip pair."""
    async with httpx.AsyncClient(timeout=20.0) as client:
        # Step 1 — short-lived user token
        r = await client.get(
            f"{GRAPH_BASE}/oauth/access_token",
            params={
                "client_id": settings.FACEBOOK_APP_ID,
                "client_secret": settings.FACEBOOK_APP_SECRET,
                "redirect_uri": redirect_uri,
                "code": code,
            },
        )
        r.raise_for_status()
        short = r.json()

        # Step 2 — exchange for long-lived (60-day) token
        r2 = await client.get(
            f"{GRAPH_BASE}/oauth/access_token",
            params={
                "grant_type": "fb_exchange_token",
                "client_id": settings.FACEBOOK_APP_ID,
                "client_secret": settings.FACEBOOK_APP_SECRET,
                "fb_exchange_token": short["access_token"],
            },
        )
        r2.raise_for_status()
        long_lived = r2.json()
        return long_lived


async def _fetch_pages(user_token: str) -> list[dict[str, Any]]:
    """List FB pages the user manages. Each page entry includes its own
    `access_token` which is the page-scoped token we use for publishing."""
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.get(
            f"{GRAPH_BASE}/me/accounts",
            params={
                "access_token": user_token,
                "fields": "id,name,access_token,category,instagram_business_account{id,username}",
            },
        )
        r.raise_for_status()
        return r.json().get("data", []) or []


def _pick_primary_page(pages: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Pick the first page with a valid access_token. The user can switch
    pages later from the settings UI (future feature)."""
    for p in pages:
        if p.get("id") and p.get("access_token"):
            return p
    return None


# ---------------------------------------------------------------------------
# Facebook provider
# ---------------------------------------------------------------------------
class FacebookProvider(OAuthProvider):
    platform = "facebook"

    def is_configured(self) -> bool:
        return bool(settings.FACEBOOK_APP_ID and settings.FACEBOOK_APP_SECRET)

    def auth_url(self, *, redirect_uri: str, state: str) -> str:
        params = {
            "client_id": settings.FACEBOOK_APP_ID,
            "redirect_uri": redirect_uri,
            "scope": _FB_SCOPES,
            "state": state,
            "response_type": "code",
        }
        return f"{FB_OAUTH_DIALOG}?{urlencode(params)}"

    async def exchange_code(
        self, *, code: str, redirect_uri: str, state: str | None = None,
    ) -> TokenBundle:
        del state  # not used
        long_lived = await _exchange_code_for_user_token(
            code=code, redirect_uri=redirect_uri
        )
        # User token; the page token will be picked up in fetch_profile().
        return TokenBundle(
            access_token=long_lived["access_token"],
            expires_in=long_lived.get("expires_in"),  # ~5184000s = 60 days
            scope=_FB_SCOPES,
            extra={"is_user_token": True},
        )

    async def fetch_profile(self, token: TokenBundle) -> AccountProfile:
        pages = await _fetch_pages(token.access_token)
        page = _pick_primary_page(pages)
        if not page:
            raise ValueError(
                "No Facebook Pages found on this account. Create or get admin "
                "access to a Page first, then reconnect."
            )

        # Swap user token → page token (the one we'll actually publish with).
        token.access_token = page["access_token"]
        token.extra["is_user_token"] = False
        token.extra["all_pages"] = [
            {"id": p["id"], "name": p.get("name")} for p in pages
        ]

        # Pull the user's FB id for `provider_user_id`.
        async with httpx.AsyncClient(timeout=10.0) as client:
            me = await client.get(
                f"{GRAPH_BASE}/me",
                params={"access_token": page["access_token"], "fields": "id"},
            )
            provider_user_id = me.json().get("id", "") if me.status_code == 200 else ""

        return AccountProfile(
            provider_user_id=provider_user_id,
            page_id=page["id"],
            page_name=page.get("name") or "Facebook Page",
            extra={
                "category": page.get("category"),
                "instagram_business_account": page.get("instagram_business_account"),
            },
        )

    async def fetch_post_analytics(
        self, account: SocialAccount, external_post_id: str
    ) -> PostMetrics:
        # Bare photo IDs (old format before the post_id fix) look like a single
        # numeric string with no underscore — insights require the full
        # "{page_id}_{post_id}" format.  Reconstruct it from the stored page_id.
        post_id = external_post_id
        if "_" not in post_id and post_id.isdigit() and account.page_id:
            post_id = f"{account.page_id}_{post_id}"

        async with httpx.AsyncClient(timeout=15.0) as client:
            # `post_impressions` and `post_engaged_users` are deprecated in
            # Graph API v19+.  Fetch the still-supported insight metrics and
            # supplement with post object fields for likes/comments/shares.
            insights_r = await client.get(
                f"{GRAPH_BASE}/{post_id}/insights",
                params={
                    "access_token": account.access_token,
                    "metric": (
                        "post_impressions_unique,"
                        "post_clicks,"
                        "post_reactions_by_type_total"
                    ),
                },
            )
            # Fetch likes, comments, shares from the post object directly.
            fields_r = await client.get(
                f"{GRAPH_BASE}/{post_id}",
                params={
                    "access_token": account.access_token,
                    "fields": "likes.summary(true),comments.summary(true),shares,reactions.summary(true)",
                },
            )

        metrics: dict[str, Any] = {}
        if insights_r.status_code == 200:
            for entry in (insights_r.json().get("data") or []):
                name = entry.get("name")
                values = entry.get("values") or []
                metrics[name] = values[0].get("value") if values else None
        else:
            logger.warning("[FB analytics] insights %s: %s", insights_r.status_code, insights_r.text[:200])

        total_likes: int | None = None
        total_comments: int | None = None
        total_shares: int | None = None
        if fields_r.status_code == 200:
            fdata = fields_r.json()
            reactions = fdata.get("reactions", {}).get("summary", {})
            total_likes = reactions.get("total_count")
            total_comments = fdata.get("comments", {}).get("summary", {}).get("total_count")
            shares_obj = fdata.get("shares")
            total_shares = shares_obj.get("count") if isinstance(shares_obj, dict) else None

        # Reactions insight as fallback for likes if fields call failed
        if total_likes is None:
            reactions_raw = metrics.get("post_reactions_by_type_total") or {}
            total_likes = sum(reactions_raw.values()) if isinstance(reactions_raw, dict) else None

        return PostMetrics(
            impressions=metrics.get("post_impressions_unique"),
            reach=metrics.get("post_impressions_unique"),
            likes=total_likes,
            comments=total_comments,
            shares=total_shares,
            clicks=metrics.get("post_clicks"),
            raw={**metrics, "likes": total_likes, "comments": total_comments, "shares": total_shares},
        )


# ---------------------------------------------------------------------------
# Instagram provider — piggy-backs on FB OAuth
# ---------------------------------------------------------------------------
class InstagramProvider(OAuthProvider):
    platform = "instagram"

    def is_configured(self) -> bool:
        # Instagram needs the same Facebook app credentials.
        return bool(settings.FACEBOOK_APP_ID and settings.FACEBOOK_APP_SECRET)

    def auth_url(self, *, redirect_uri: str, state: str) -> str:
        # Same Facebook OAuth dialog — IG scopes are bundled into _FB_SCOPES.
        params = {
            "client_id": settings.FACEBOOK_APP_ID,
            "redirect_uri": redirect_uri,
            "scope": _FB_SCOPES,
            "state": state,
            "response_type": "code",
        }
        return f"{FB_OAUTH_DIALOG}?{urlencode(params)}"

    async def exchange_code(
        self, *, code: str, redirect_uri: str, state: str | None = None,
    ) -> TokenBundle:
        del state  # not used
        long_lived = await _exchange_code_for_user_token(
            code=code, redirect_uri=redirect_uri
        )
        return TokenBundle(
            access_token=long_lived["access_token"],
            expires_in=long_lived.get("expires_in"),
            scope=_FB_SCOPES,
            extra={"is_user_token": True},
        )

    async def fetch_profile(self, token: TokenBundle) -> AccountProfile:
        pages = await _fetch_pages(token.access_token)
        # Find the first page that has a linked IG business account.
        ig_page = next(
            (p for p in pages if p.get("instagram_business_account", {}).get("id")),
            None,
        )
        if not ig_page:
            raise ValueError(
                "No Instagram Business account linked to your Facebook Pages. "
                "Convert your Instagram to a Business/Creator account and link "
                "it to a Facebook Page first."
            )

        ig = ig_page["instagram_business_account"]
        # Use the Page token — IG content publishing uses the linked Page's token.
        token.access_token = ig_page["access_token"]
        token.extra["is_user_token"] = False
        token.extra["facebook_page_id"] = ig_page["id"]

        return AccountProfile(
            provider_user_id=ig["id"],
            page_id=ig["id"],
            page_name=ig.get("username") or "Instagram",
            extra={
                "facebook_page_id": ig_page["id"],
                "facebook_page_name": ig_page.get("name"),
            },
        )

    async def fetch_post_analytics(
        self, account: SocialAccount, external_post_id: str
    ) -> PostMetrics:
        # IG insights endpoint differs from FB. `external_post_id` here is the
        # IG media id returned at publish time.
        #
        # Reels use different metrics than image posts:
        #   - `plays` instead of `impressions`
        #   - `ig_reels_aggregated_all_plays_count` for total plays
        # We first detect the media type, then request the appropriate metrics.
        async with httpx.AsyncClient(timeout=15.0) as client:
            # Fetch media object: type detection + like_count + comments_count.
            # Instagram Insights API does NOT return likes/comments for Reels —
            # those must be read from the media object fields directly.
            media_r = await client.get(
                f"{GRAPH_BASE}/{external_post_id}",
                params={
                    "access_token": account.access_token,
                    "fields": "media_type,like_count,comments_count",
                },
            )
            is_reel = False
            like_count: int | None = None
            comments_count: int | None = None
            if media_r.status_code == 200:
                media_data = media_r.json()
                media_type = media_data.get("media_type", "")
                is_reel = media_type == "VIDEO"  # Reels are returned as VIDEO
                like_count = media_data.get("like_count")
                comments_count = media_data.get("comments_count")

            if is_reel:
                # `plays` and `ig_reels_aggregated_all_plays_count` are
                # deprecated in Graph API v22+ — using reach/shares/saved only.
                metric_str = "reach,shares,saved,total_interactions"
            else:
                metric_str = "impressions,reach,saved,shares"

            r = await client.get(
                f"{GRAPH_BASE}/{external_post_id}/insights",
                params={
                    "access_token": account.access_token,
                    "metric": metric_str,
                },
            )
            if r.status_code != 200:
                logger.warning(
                    "[IG analytics] %s: %s", r.status_code, r.text[:200]
                )
                # Still return like/comment counts fetched from media object
                return PostMetrics(likes=like_count, comments=comments_count)
            data = r.json().get("data", []) or []

        m: dict[str, Any] = {}
        for entry in data:
            values = entry.get("values") or []
            m[entry.get("name", "")] = values[0].get("value") if values else None

        return PostMetrics(
            impressions=m.get("reach") if is_reel else m.get("impressions"),
            reach=m.get("reach"),
            # likes and comments come from the media object, not insights
            likes=like_count,
            comments=comments_count,
            shares=m.get("shares"),
            raw={**m, "like_count": like_count, "comments_count": comments_count},
        )


# Register on import.
register(FacebookProvider())
register(InstagramProvider())
