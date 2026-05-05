"""
Unified OAuth router for all supported social platforms.

Endpoints
---------
GET  /api/social/providers
    List supported platforms + whether each is configured + currently connected.

GET  /api/social/{platform}/auth
    Returns `{auth_url}` — frontend opens this in a popup/new tab.

GET  /api/social/{platform}/callback
    OAuth redirect target. Persists the account, then redirects back to the
    frontend settings page with `?connected={platform}` or `?error=...`.

POST /api/social/devto/connect
    Special case: Dev.to has no OAuth, user pastes their personal API key.

The legacy `/api/social/accounts` (list/delete) lives in `social_accounts.py`
and continues to work for both old quick-connect rows and new OAuth rows.
"""
from __future__ import annotations

import json
import logging
import secrets
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.services.oauth import (
    all_providers,
    get_provider,
    upsert_account,
)
from app.services.oauth.devto import DevToProvider

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/social", tags=["social-oauth"])


# Each platform's redirect URI must be registered with the provider exactly.
# We use a single callback path per platform so app config is predictable.
def _redirect_uri(platform: str) -> str:
    return f"{settings.FRONTEND_URL}/auth/{platform}/callback"


# In-memory state store maps OAuth `state` → user_id. Survives the round-trip
# from auth start to callback. NOT shared across worker processes — fine for
# single-worker dev; for multi-worker production back this with Redis.
_STATE_STORE: dict[str, str] = {}


def _make_state(user_id: str) -> str:
    state = secrets.token_urlsafe(32)
    _STATE_STORE[state] = user_id
    return state


def _consume_state(state: str | None) -> str | None:
    if not state:
        return None
    return _STATE_STORE.pop(state, None)


# ---------------------------------------------------------------------------
# List + status
# ---------------------------------------------------------------------------
class ProviderStatus(BaseModel):
    platform: str
    configured: bool
    auth_method: str  # "oauth" | "api_key"
    connected: bool
    page_name: str | None = None


@router.get("/providers", response_model=list[ProviderStatus])
def list_providers(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all supported platforms, whether each is configured app-side, and
    whether the current user has connected an account."""
    from app.models.social_account import SocialAccount

    connected = {
        a.platform: a
        for a in db.query(SocialAccount)
        .filter(SocialAccount.user_id == current_user.id)
        .all()
    }

    out: list[ProviderStatus] = []
    for platform, provider in all_providers().items():
        acct = connected.get(platform)
        out.append(
            ProviderStatus(
                platform=platform,
                configured=provider.is_configured(),
                auth_method="api_key" if platform == "devto" else "oauth",
                connected=acct is not None,
                page_name=acct.page_name if acct else None,
            )
        )
    return out


# ---------------------------------------------------------------------------
# OAuth start
# ---------------------------------------------------------------------------
@router.get("/{platform}/auth")
def start_oauth(
    platform: str,
    current_user: User = Depends(get_current_user),
):
    """Return the platform's OAuth URL for the frontend to open."""
    provider = get_provider(platform)
    if provider is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown platform: {platform}",
        )
    if platform == "devto":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Dev.to uses an API key — POST /api/social/devto/connect instead.",
        )
    if not provider.is_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                f"{platform} OAuth is not configured. Set the relevant client "
                f"id/secret in environment variables and restart."
            ),
        )

    state = _make_state(current_user.id)
    auth_url = provider.auth_url(
        redirect_uri=_redirect_uri(platform), state=state
    )
    return {"auth_url": auth_url, "state": state}


# ---------------------------------------------------------------------------
# OAuth callback (per-platform redirect target)
# ---------------------------------------------------------------------------
def _settings_redirect(*, platform: str, error: str | None = None) -> RedirectResponse:
    params: dict[str, str] = {}
    if error:
        params["error"] = f"{platform}_failed"
        params["message"] = error[:200]
    else:
        params["connected"] = platform
    return RedirectResponse(
        url=f"{settings.FRONTEND_URL}/settings?{urlencode(params)}",
        status_code=302,
    )


@router.get("/{platform}/callback")
async def oauth_callback(
    platform: str,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
    db: Session = Depends(get_db),
):
    """OAuth redirect target. Persists the account, redirects to the frontend
    settings page with success/error query params."""
    if error:
        return _settings_redirect(
            platform=platform, error=error_description or error
        )

    provider = get_provider(platform)
    if provider is None or platform == "devto":
        return _settings_redirect(
            platform=platform, error=f"Unknown OAuth platform: {platform}"
        )
    if not code:
        return _settings_redirect(
            platform=platform, error="No authorization code returned."
        )

    user_id = _consume_state(state)
    if not user_id:
        return _settings_redirect(
            platform=platform,
            error="OAuth state mismatch — please retry the connection.",
        )

    try:
        token = await provider.exchange_code(
            code=code, redirect_uri=_redirect_uri(platform)
        )
        profile = await provider.fetch_profile(token)
        upsert_account(
            db,
            user_id=user_id,
            platform=platform,
            token=token,
            profile=profile,
        )
    except Exception as exc:
        logger.exception("[OAuth %s] callback failed", platform)
        return _settings_redirect(platform=platform, error=str(exc))

    return _settings_redirect(platform=platform)


# ---------------------------------------------------------------------------
# Dev.to: API-key flow
# ---------------------------------------------------------------------------
class DevToConnectRequest(BaseModel):
    api_key: str


@router.post("/devto/connect")
async def devto_connect(
    payload: DevToConnectRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not settings.DEVTO_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Dev.to integration is disabled.",
        )

    provider = get_provider("devto")
    if not isinstance(provider, DevToProvider):  # safety check
        raise HTTPException(
            status_code=500,
            detail="Dev.to provider is not registered correctly.",
        )

    api_key = (payload.api_key or "").strip()
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="api_key is required.",
        )

    try:
        token, profile = await provider.connect_with_api_key(api_key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("[Dev.to] connect failed")
        raise HTTPException(status_code=502, detail=f"Dev.to API error: {exc}")

    account = upsert_account(
        db,
        user_id=current_user.id,
        platform="devto",
        token=token,
        profile=profile,
    )
    return {
        "message": "Dev.to connected successfully",
        "page_name": account.page_name,
        "page_id": account.page_id,
    }
