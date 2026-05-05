"""
Multi-platform OAuth provider abstraction.

Every supported platform implements the `OAuthProvider` interface so the
unified router doesn't have to know provider-specific details. Providers
return normalized dicts; persistence + frontend redirects live in the router.

Supported platforms:
    facebook   — OAuth 2.0, page tokens, 60-day expiry, no refresh
    instagram  — Re-uses Facebook token (Instagram Business linked to FB Page)
    linkedin   — OAuth 2.0, member token, 60-day expiry, no refresh
    youtube    — Google OAuth 2.0, refresh tokens supported
    reddit     — OAuth 2.0, refresh tokens supported, requires custom User-Agent
    devto      — NOT OAuth — API key flow handled separately in the router

The `Medium` platform is intentionally omitted: no public OAuth/publishing API.
"""
from __future__ import annotations

import json
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.models.social_account import SocialAccount

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------
@dataclass
class TokenBundle:
    """Normalized OAuth token response. All providers map their native shape
    onto this so persistence + refresh stay provider-agnostic."""

    access_token: str
    refresh_token: str | None = None
    expires_in: int | None = None  # seconds
    scope: str | None = None
    # Anything provider-specific (granted page list, channel id, ...) goes here
    # so the router doesn't have to inspect raw API responses.
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class AccountProfile:
    """The bare minimum we need to display a connected account in the UI."""

    provider_user_id: str
    page_id: str
    page_name: str
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class PostMetrics:
    """Normalized analytics for a single published post. Fields the platform
    doesn't report stay None — the frontend should render `—` for those."""

    impressions: int | None = None
    reach: int | None = None
    likes: int | None = None
    comments: int | None = None
    shares: int | None = None
    clicks: int | None = None
    views: int | None = None
    raw: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Provider interface
# ---------------------------------------------------------------------------
class OAuthProvider(ABC):
    """Each platform subclasses this. Methods return normalized data; the
    router handles HTTP + persistence."""

    #: Used in URL paths and DB rows: facebook, instagram, linkedin, ...
    platform: str

    @abstractmethod
    def is_configured(self) -> bool:
        """True if app-level credentials are present (env vars set)."""

    @abstractmethod
    def auth_url(self, *, redirect_uri: str, state: str) -> str:
        """Return the platform's OAuth authorization URL."""

    @abstractmethod
    async def exchange_code(
        self, *, code: str, redirect_uri: str
    ) -> TokenBundle:
        """Trade an authorization code for an access token bundle."""

    @abstractmethod
    async def fetch_profile(self, token: TokenBundle) -> AccountProfile:
        """Fetch the connected user/page profile so we can display + persist it."""

    async def refresh(self, account: SocialAccount) -> TokenBundle | None:
        """Refresh an expiring token. Default: no refresh available — caller
        should prompt user to re-auth. Override in subclasses that support it."""
        return None

    async def fetch_post_analytics(
        self, account: SocialAccount, external_post_id: str
    ) -> PostMetrics:
        """Fetch analytics for one previously-published post. Default returns
        an empty-but-valid PostMetrics so providers without analytics support
        don't break the UI."""
        return PostMetrics()


# ---------------------------------------------------------------------------
# Persistence helpers
# ---------------------------------------------------------------------------
def _expires_at(expires_in: int | None) -> datetime | None:
    if not expires_in or expires_in <= 0:
        return None
    return datetime.now(timezone.utc) + timedelta(seconds=expires_in)


def upsert_account(
    db: Session,
    *,
    user_id: str,
    platform: str,
    token: TokenBundle,
    profile: AccountProfile,
) -> SocialAccount:
    """Insert or update the user's social account for a platform. Uniqueness
    is (user_id, platform, page_id) — re-connecting the same page replaces the
    token in place rather than creating duplicates."""
    existing = (
        db.query(SocialAccount)
        .filter(
            SocialAccount.user_id == user_id,
            SocialAccount.platform == platform,
            SocialAccount.page_id == profile.page_id,
        )
        .first()
    )

    metadata_json = json.dumps(
        {**profile.extra, **token.extra}, ensure_ascii=False
    ) if (profile.extra or token.extra) else None

    if existing:
        existing.access_token = token.access_token
        if token.refresh_token:
            existing.refresh_token = token.refresh_token
        existing.token_expires_at = _expires_at(token.expires_in)
        existing.scope = token.scope
        existing.provider_user_id = profile.provider_user_id
        existing.page_name = profile.page_name
        existing.extra_metadata = metadata_json
        db.commit()
        db.refresh(existing)
        return existing

    account = SocialAccount(
        user_id=user_id,
        platform=platform,
        access_token=token.access_token,
        refresh_token=token.refresh_token,
        token_expires_at=_expires_at(token.expires_in),
        scope=token.scope,
        provider_user_id=profile.provider_user_id,
        page_id=profile.page_id,
        page_name=profile.page_name,
        extra_metadata=metadata_json,
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    return account


async def get_valid_token(
    db: Session, account: SocialAccount, provider: OAuthProvider
) -> str:
    """Return a usable access token, refreshing if expired. Raises ValueError
    if the token is dead and the platform doesn't support refresh — caller
    should surface "please reconnect" to the user."""
    expires = account.token_expires_at
    # Refresh 60s before actual expiry so a token doesn't die mid-request.
    needs_refresh = (
        expires is not None
        and expires <= datetime.now(timezone.utc) + timedelta(seconds=60)
    )
    if not needs_refresh:
        return account.access_token

    refreshed = await provider.refresh(account)
    if refreshed is None:
        raise ValueError(
            f"{account.platform} token expired and platform does not "
            "support refresh — user must reconnect."
        )

    account.access_token = refreshed.access_token
    if refreshed.refresh_token:
        account.refresh_token = refreshed.refresh_token
    account.token_expires_at = _expires_at(refreshed.expires_in)
    if refreshed.scope:
        account.scope = refreshed.scope
    db.commit()
    return account.access_token


# ---------------------------------------------------------------------------
# Provider registry — populated by submodule imports below
# ---------------------------------------------------------------------------
_REGISTRY: dict[str, OAuthProvider] = {}


def register(provider: OAuthProvider) -> None:
    _REGISTRY[provider.platform] = provider


def get_provider(platform: str) -> OAuthProvider | None:
    return _REGISTRY.get(platform.lower())


def all_providers() -> dict[str, OAuthProvider]:
    return dict(_REGISTRY)


# Submodule imports MUST happen at the bottom — each module calls
# `register(...)` at import time. Importing earlier creates a circular import.
from app.services.oauth import (  # noqa: E402  (intentional bottom import)
    facebook as _facebook,
    linkedin as _linkedin,
    youtube as _youtube,
    devto as _devto,
    reddit as _reddit,
)

__all__ = [
    "AccountProfile",
    "OAuthProvider",
    "PostMetrics",
    "TokenBundle",
    "all_providers",
    "get_provider",
    "get_valid_token",
    "register",
    "upsert_account",
]
