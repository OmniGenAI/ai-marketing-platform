import json
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models.business_config import BusinessConfig
from app.models.poster import Poster
from app.models.user import User
from app.models.wallet import UsageLog, Wallet
from app.schemas.poster import (
    PosterGenerateRequest,
    PosterGenerateResponse,
    PosterResponse,
    PosterUpdate,
)
from app.services.ai import generate_poster_background, generate_poster_copy

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/posters", tags=["posters"])

UNLIMITED_BALANCE = -1


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _get_owned_poster(db: Session, poster_id: str, user_id: str) -> Poster:
    """Fetch a poster owned by the current user or raise 404."""
    poster = (
        db.query(Poster)
        .filter(Poster.id == poster_id, Poster.user_id == user_id)
        .first()
    )
    if not poster:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Poster not found",
        )
    return poster


def _resolve_brand_kit(
    config: BusinessConfig,
    *,
    primary_override: str | None,
    secondary_override: str | None,
    show_logo: bool,
) -> tuple[str | None, str | None, str | None]:
    """Pull primary/secondary color + logo URL from BusinessConfig.website_context.

    Per-poster overrides win. Returns (primary_color, secondary_color, logo_url).
    `logo_url` is None when the user opted out via show_logo=False.
    """
    primary_color = primary_override
    secondary_color = secondary_override
    logo_url: str | None = None

    if config.website_context:
        try:
            ctx = json.loads(config.website_context)
            primary_color = primary_color or ctx.get("primary_color") or None
            secondary_color = secondary_color or ctx.get("secondary_color") or None
            if show_logo:
                logo_url = ctx.get("logo_url") or ctx.get("favicon_url") or None
        except (json.JSONDecodeError, TypeError):
            pass

    return primary_color, secondary_color, logo_url


def _domain_from_url(url: str | None) -> str | None:
    """Extract bare domain from a website URL — "https://www.foo.com/bar" → "foo.com"."""
    if not url:
        return None
    s = url.strip()
    for prefix in ("https://", "http://"):
        if s.lower().startswith(prefix):
            s = s[len(prefix):]
            break
    if s.lower().startswith("www."):
        s = s[4:]
    s = s.split("/", 1)[0].split("?", 1)[0].strip()
    return s or None


def _first_handle(social_links: dict | None) -> str | None:
    """Pull the first social handle from a `social_links` dict (instagram preferred).

    Returns "@handle" or None. Tries to extract the path component after the
    last "/" — works for instagram.com/foo, twitter.com/foo, x.com/foo.
    """
    if not social_links or not isinstance(social_links, dict):
        return None
    preference = ("instagram", "twitter", "x", "linkedin", "facebook")
    for net in preference:
        url = social_links.get(net)
        if not url or not isinstance(url, str):
            continue
        path = url.rstrip("/").split("/")[-1].strip()
        path = path.split("?", 1)[0].lstrip("@")
        if path:
            return f"@{path}"
    return None


def _build_brand_label(config: BusinessConfig) -> str | None:
    """Compose "BusinessName · site.com · @handle" from BusinessConfig.

    Returns None if no parts could be derived.
    """
    parts: list[str] = []
    if config.business_name:
        parts.append(config.business_name.strip())

    domain = _domain_from_url(config.website)
    if domain:
        parts.append(domain)

    handle: str | None = None
    if config.website_context:
        try:
            ctx = json.loads(config.website_context)
            handle = _first_handle(ctx.get("social_links"))
        except (json.JSONDecodeError, TypeError):
            pass
    if handle:
        parts.append(handle)

    return " · ".join(parts) or None


def _charge_credits(
    db: Session,
    wallet: Wallet,
    cost: int,
    description: str,
) -> None:
    """Deduct `cost` credits and write a usage log. Caller must commit."""
    if wallet.balance != UNLIMITED_BALANCE:
        wallet.balance -= cost
    wallet.total_credits_used += cost

    db.add(
        UsageLog(
            wallet_id=wallet.id,
            action="generate_poster",
            credits_used=cost,
            description=description,
        )
    )


def _wallet_for_update(db: Session, user_id: str, cost: int) -> Wallet:
    """Lock the wallet row and verify the user can afford `cost` credits."""
    wallet = (
        db.query(Wallet)
        .filter(Wallet.user_id == user_id)
        .with_for_update()
        .first()
    )

    has_unlimited = wallet and wallet.balance == UNLIMITED_BALANCE
    has_enough = wallet and wallet.balance >= cost

    if not wallet or (not has_unlimited and not has_enough):
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Insufficient credits. Please upgrade your plan.",
        )

    return wallet


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.get("", response_model=list[PosterResponse])
def list_posters(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all posters owned by the current user, newest first."""
    return (
        db.query(Poster)
        .filter(Poster.user_id == current_user.id)
        .order_by(Poster.created_at.desc())
        .all()
    )


@router.get("/{poster_id}", response_model=PosterResponse)
def get_poster(
    poster_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _get_owned_poster(db, poster_id, current_user.id)


@router.post(
    "/generate",
    response_model=PosterGenerateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def generate_poster(
    data: PosterGenerateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generate a new poster: AI copy + text-free background image.

    Charges `settings.POSTER_CREDIT_COST` credits. Background image failures
    degrade gracefully — the poster row is still returned (with the AI copy)
    and the response carries `background_generation_failed=True` so the
    frontend can offer a "Regenerate Background" action.
    """
    cost = settings.POSTER_CREDIT_COST

    # 1. Lock wallet and verify credit balance.
    wallet = _wallet_for_update(db, current_user.id, cost)

    # 2. Require a configured Brand Kit (consistent with /api/generate).
    config = (
        db.query(BusinessConfig)
        .filter(BusinessConfig.user_id == current_user.id)
        .first()
    )
    if not config:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please configure your business profile first.",
        )

    primary_color, secondary_color, logo_url = _resolve_brand_kit(
        config,
        primary_override=data.primary_color,
        secondary_override=data.secondary_color,
        show_logo=data.show_logo,
    )

    # 3. Generate copy (cheap, fast). Failures here are fatal — without copy
    #    the poster is useless and we shouldn't charge the user.
    try:
        copy = await run_in_threadpool(
            generate_poster_copy,
            title=data.title,
            theme=data.theme,
            optional_text=data.optional_text,
            template_style=data.template_style,
            caption_tone=data.caption_tone,
            business_name=config.business_name,
            niche=config.niche,
            brand_voice=config.brand_voice,
            cta_verb_hint=data.cta_verb_hint,
        )
    except Exception as e:
        logger.error(
            f"[POSTER] copy generation failed for user {current_user.id}: {e}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to generate poster copy. Please try again.",
        )

    brand_label = _build_brand_label(config)

    # 4. Generate background (slow). Failures degrade gracefully.
    background_image_url: str | None = None
    background_generation_failed = False
    try:
        background_image_url = await run_in_threadpool(
            generate_poster_background,
            title=data.title,
            theme=data.theme,
            template_style=data.template_style,
            aspect_ratio=data.aspect_ratio,
            primary_color=primary_color,
            secondary_color=secondary_color,
            logo_url=logo_url,
            user_id=current_user.id,
        )
        if not background_image_url:
            background_generation_failed = True
    except Exception as e:
        logger.error(
            f"[POSTER] background generation failed for user {current_user.id}: {e}",
            exc_info=True,
        )
        background_generation_failed = True

    # 5. Persist the poster + charge credits atomically.
    poster = Poster(
        user_id=current_user.id,
        title=data.title,
        theme=data.theme,
        optional_text=data.optional_text,
        template_style=data.template_style,
        aspect_ratio=data.aspect_ratio,
        caption_tone=data.caption_tone,
        headline=copy["headline"],
        tagline=copy["tagline"],
        cta=copy["cta"],
        caption=copy["caption"],
        event_meta=copy.get("event_meta"),
        features=json.dumps(copy.get("features") or []),
        brand_label=brand_label,
        background_image_url=background_image_url,
        primary_color=primary_color,
        secondary_color=secondary_color,
        show_logo="true" if data.show_logo else "false",
        status="draft",
        error_message=("background_generation_failed"
                       if background_generation_failed else None),
    )

    try:
        db.add(poster)
        _charge_credits(
            db,
            wallet,
            cost,
            description=f"Generated poster: {data.title[:80]}",
        )
        db.commit()
        db.refresh(poster)
    except Exception as e:
        db.rollback()
        logger.error(
            f"[POSTER] persist/charge failed for user {current_user.id}: {e}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save poster. Please try again.",
        )

    credits_remaining = wallet.balance  # may be -1 (unlimited)

    return PosterGenerateResponse(
        poster=PosterResponse.model_validate(poster),
        credits_remaining=credits_remaining,
        background_generation_failed=background_generation_failed,
    )


@router.post(
    "/{poster_id}/regenerate-background",
    response_model=PosterGenerateResponse,
)
async def regenerate_background(
    poster_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Regenerate ONLY the background for an existing poster.

    Costs another `POSTER_CREDIT_COST` credit. Reuses every previously-saved
    field (title / theme / template_style / colors / logo opt-in). The user's
    edited text (headline / tagline / cta / caption) is preserved.
    """
    cost = settings.POSTER_CREDIT_COST

    wallet = _wallet_for_update(db, current_user.id, cost)
    poster = _get_owned_poster(db, poster_id, current_user.id)

    # Resolve logo URL again from the current Brand Kit (user may have updated it).
    config = (
        db.query(BusinessConfig)
        .filter(BusinessConfig.user_id == current_user.id)
        .first()
    )
    show_logo = poster.show_logo == "true"
    logo_url: str | None = None
    if config and config.website_context and show_logo:
        try:
            ctx = json.loads(config.website_context)
            logo_url = ctx.get("logo_url") or ctx.get("favicon_url") or None
        except (json.JSONDecodeError, TypeError):
            pass

    background_image_url: str | None = None
    background_generation_failed = False
    try:
        background_image_url = await run_in_threadpool(
            generate_poster_background,
            title=poster.title,
            theme=poster.theme,
            template_style=poster.template_style,
            aspect_ratio=poster.aspect_ratio,
            primary_color=poster.primary_color,
            secondary_color=poster.secondary_color,
            logo_url=logo_url,
            user_id=current_user.id,
        )
        if not background_image_url:
            background_generation_failed = True
    except Exception as e:
        logger.error(
            f"[POSTER] regenerate background failed for user {current_user.id}: {e}",
            exc_info=True,
        )
        background_generation_failed = True

    # Don't charge if the background totally failed — user gets nothing new.
    if background_generation_failed:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to regenerate background. Please try again.",
        )

    try:
        poster.background_image_url = background_image_url
        poster.error_message = None
        _charge_credits(
            db,
            wallet,
            cost,
            description=f"Regenerated poster background: {poster.title[:80]}",
        )
        db.commit()
        db.refresh(poster)
    except Exception as e:
        db.rollback()
        logger.error(
            f"[POSTER] persist regenerated bg failed for user {current_user.id}: {e}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save regenerated background.",
        )

    return PosterGenerateResponse(
        poster=PosterResponse.model_validate(poster),
        credits_remaining=wallet.balance,
        background_generation_failed=False,
    )


@router.patch("/{poster_id}", response_model=PosterResponse)
def update_poster(
    poster_id: str,
    data: PosterUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Partial update — used to save inline text edits and flip status to `exported`."""
    poster = _get_owned_poster(db, poster_id, current_user.id)

    update_data = data.model_dump(exclude_unset=True)
    # `features` arrives as list[str] from the client but is persisted as JSON.
    if "features" in update_data and update_data["features"] is not None:
        update_data["features"] = json.dumps(update_data["features"])
    for field, value in update_data.items():
        setattr(poster, field, value)

    db.commit()
    db.refresh(poster)
    return poster


@router.delete("/{poster_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_poster(
    poster_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    poster = _get_owned_poster(db, poster_id, current_user.id)
    db.delete(poster)
    db.commit()
