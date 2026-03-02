from datetime import datetime

from pydantic import BaseModel

from app.schemas.plan import PlanResponse


class SubscriptionResponse(BaseModel):
    id: str
    user_id: str
    plan_id: str
    plan: PlanResponse
    stripe_subscription_id: str | None
    status: str
    current_period_start: datetime | None
    current_period_end: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class CheckoutRequest(BaseModel):
    plan_id: str
