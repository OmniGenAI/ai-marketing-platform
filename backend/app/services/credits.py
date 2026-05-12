"""
Wallet credit helpers — shared across all AI-spend routers.

Every router that calls an LLM should:
  1. Call `require_credits(db, user_id, cost)` BEFORE the LLM request.
     Raises 402 if the wallet can't afford it.
  2. After the LLM succeeds, call `charge_credits(db, wallet, action, cost, description)`.

Centralising this means new AI endpoints don't silently bypass billing — the
helper enforces the deduct + UsageLog write in one place.

The actual cost VALUES live in app.config.Settings so they're env-tunable
per deployment without redeploying code. This module re-exports them as
COST_* constants for ergonomics and gives the frontend a single endpoint
to fetch the live pricing table from.
"""
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.config import settings
from app.models.wallet import UsageLog, Wallet


# Sentinel for unlimited-balance accounts (admin/dev wallets).
UNLIMITED_BALANCE = -1


# ---------------------------------------------------------------------------
# Per-action credit costs — read from env-tunable settings.
# Re-exported as COST_* constants so existing imports keep working.
# Bump the values in .env (or Settings defaults) to retune billing.
# ---------------------------------------------------------------------------
COST_SOCIAL_POST = settings.SOCIAL_POST_CREDIT_COST
COST_POSTER = settings.POSTER_CREDIT_COST
COST_REEL_VIDEO = settings.REEL_VIDEO_CREDIT_COST
COST_REEL_CANCEL = settings.REEL_CANCEL_CREDIT_COST
COST_BLOG_GENERATE = settings.BLOG_CREDIT_COST
COST_SEO_BRIEF = settings.SEO_BRIEF_CREDIT_COST
COST_SEO_KEYWORDS = settings.SEO_KEYWORDS_CREDIT_COST
COST_SEO_TIPS = settings.SEO_TIPS_CREDIT_COST
COST_SEO_APPLY_TIPS = settings.SEO_APPLY_TIPS_CREDIT_COST
COST_REPURPOSE = settings.REPURPOSE_CREDIT_COST
COST_REPURPOSE_REROLL = settings.REPURPOSE_REROLL_CREDIT_COST
REPURPOSE_FREE_REROLLS_PER_DAY = settings.REPURPOSE_FREE_REROLLS_PER_DAY


def get_cost_table() -> dict[str, int]:
    """Return all AI-feature credit costs as a single dict.

    Used by the /api/credits/costs endpoint so the frontend can display
    accurate prices without hardcoding any value. Keys mirror the
    user-facing feature names; add a new entry when adding a new
    chargeable AI endpoint.
    """
    return {
        "social_post": settings.SOCIAL_POST_CREDIT_COST,
        "poster": settings.POSTER_CREDIT_COST,
        "reel_video": settings.REEL_VIDEO_CREDIT_COST,
        "reel_cancel": settings.REEL_CANCEL_CREDIT_COST,
        "blog": settings.BLOG_CREDIT_COST,
        "seo_brief": settings.SEO_BRIEF_CREDIT_COST,
        "seo_keywords": settings.SEO_KEYWORDS_CREDIT_COST,
        "seo_tips": settings.SEO_TIPS_CREDIT_COST,
        "seo_apply_tips": settings.SEO_APPLY_TIPS_CREDIT_COST,
        "repurpose": settings.REPURPOSE_CREDIT_COST,
        "repurpose_reroll": settings.REPURPOSE_REROLL_CREDIT_COST,
        "repurpose_free_rerolls_per_day": settings.REPURPOSE_FREE_REROLLS_PER_DAY,
    }


def require_credits(db: Session, user_id: str, cost: int) -> Wallet:
    """Verify the user can afford `cost` credits. Returns the wallet on
    success, raises 402 otherwise.

    Does NOT lock the row — keep DB transactions short while LLM calls
    are in flight. The actual deduct happens later in `charge_credits()`.
    """
    wallet = db.query(Wallet).filter(Wallet.user_id == user_id).first()
    has_unlimited = bool(wallet and wallet.balance == UNLIMITED_BALANCE)
    has_enough = bool(wallet and wallet.balance >= cost)
    if not wallet or (not has_unlimited and not has_enough):
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=f"Insufficient credits. This action costs {cost} credit{'s' if cost != 1 else ''}.",
        )
    return wallet


def charge_credits(
    db: Session,
    wallet: Wallet,
    *,
    action: str,
    cost: int,
    description: str = "",
    commit: bool = True,
) -> None:
    """Deduct `cost` credits, write a UsageLog row, optionally commit.

    No-op for unlimited wallets (still writes the log so admins can audit
    usage even on -1 balance accounts).
    """
    if wallet.balance != UNLIMITED_BALANCE:
        wallet.balance = max(0, wallet.balance - cost)
    wallet.total_credits_used = (wallet.total_credits_used or 0) + cost

    db.add(
        UsageLog(
            wallet_id=wallet.id,
            action=action,
            credits_used=cost,
            description=description[:500] if description else action,
        )
    )
    if commit:
        try:
            db.commit()
        except Exception:
            db.rollback()
            raise


def refund_credits(
    db: Session,
    wallet: Wallet,
    *,
    action: str,
    cost: int,
    reason: str = "",
    commit: bool = True,
) -> None:
    """Reverse a previous deduction after a downstream failure.

    Writes a negative-amount UsageLog so the audit trail shows the refund.
    Caller decides when to refund (typically inside background tasks that
    failed after credits were charged).
    """
    if wallet.balance != UNLIMITED_BALANCE:
        wallet.balance += cost
    wallet.total_credits_used = max(0, (wallet.total_credits_used or 0) - cost)

    db.add(
        UsageLog(
            wallet_id=wallet.id,
            action=f"refund_{action}",
            credits_used=-cost,
            description=(f"Refund: {reason}" if reason else f"Refund: {action}")[:500],
        )
    )
    if commit:
        try:
            db.commit()
        except Exception:
            db.rollback()
            raise
