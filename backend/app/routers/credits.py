"""
Credit cost catalog endpoint.

The frontend hits GET /api/credits/costs once per session to learn how many
credits each AI feature costs. Backend is the single source of truth — the
UI never hardcodes a price. Bump the value in env / Settings and every
client picks it up on next page load.

This endpoint is intentionally lightweight (no auth required) so it can
be cached at the CDN edge. Costs are not sensitive — they're displayed on
the pricing page and inside every "Generate" button anyway.
"""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.services.credits import get_cost_table

router = APIRouter(prefix="/api/credits", tags=["credits"])


class CreditCostsResponse(BaseModel):
    """All chargeable AI features and their credit prices.

    Keys mirror service categories — frontend reads them via the
    `useCreditCosts` hook. Add a new field here when adding a new
    chargeable endpoint so the UI can display the cost.
    """
    social_post: int
    poster: int
    reel_video: int
    reel_cancel: int
    blog: int
    seo_brief: int
    seo_keywords: int
    seo_tips: int
    seo_apply_tips: int
    repurpose: int
    repurpose_reroll: int
    repurpose_free_rerolls_per_day: int


@router.get("/costs", response_model=CreditCostsResponse)
def list_credit_costs() -> CreditCostsResponse:
    """Return the live credit-cost catalog.

    Public on purpose — no auth required so the marketing/pricing pages
    can render real numbers without an API key. Cached at the edge for
    a few minutes is fine; bumped costs need a page refresh to propagate.
    """
    return CreditCostsResponse(**get_cost_table())
