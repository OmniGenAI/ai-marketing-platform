from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.models.subscription import Subscription
from app.models.plan import Plan
from app.schemas.subscription import SubscriptionResponse, CheckoutRequest
from app.dependencies import get_current_user
from app.services.stripe_service import create_checkout_session
from app.config import settings

router = APIRouter(prefix="/api/subscription", tags=["subscription"])


@router.get("/status", response_model=SubscriptionResponse | None)
def get_subscription_status(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sub = (
        db.query(Subscription)
        .filter(Subscription.user_id == current_user.id)
        .first()
    )
    return sub


@router.post("/checkout")
def create_checkout(
    data: CheckoutRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    plan = db.query(Plan).filter(Plan.id == data.plan_id).first()
    if not plan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Plan not found",
        )

    checkout_url = create_checkout_session(
        plan_name=plan.name,
        price_amount=int(plan.price * 100),
        user_email=current_user.email,
        success_url=f"{settings.FRONTEND_URL}/subscription?success=true",
        cancel_url=f"{settings.FRONTEND_URL}/subscription?canceled=true",
    )

    return {"checkout_url": checkout_url}
