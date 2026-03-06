from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.models.subscription import Subscription
from app.models.plan import Plan
from app.models.wallet import Wallet
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
    from sqlalchemy.orm import joinedload
    sub = (
        db.query(Subscription)
        .options(joinedload(Subscription.plan))
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
    # Check if Stripe is configured
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Stripe is not configured. Please add STRIPE_SECRET_KEY to your .env file.",
        )

    plan = db.query(Plan).filter(Plan.id == data.plan_id).first()
    if not plan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Plan not found",
        )

    # Don't allow checkout for free plan
    if plan.price == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot checkout for free plan",
        )

    try:
        checkout_url = create_checkout_session(
            plan_name=plan.name,
            price_amount=int(plan.price * 100),
            user_email=current_user.email,
            success_url=f"{settings.FRONTEND_URL}/subscription?success=true",
            cancel_url=f"{settings.FRONTEND_URL}/subscription?canceled=true",
        )

        return {"checkout_url": checkout_url}
    except Exception as e:
        print(f"[Stripe Error] {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Stripe error: {str(e)}",
        )


@router.post("/dev/activate/{plan_slug}")
def dev_activate_subscription(
    plan_slug: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Development only: Manually activate a subscription after test payment.
    Use this when webhooks are not configured.

    Usage: After completing Stripe checkout, call this endpoint with the plan slug
    (free, starter, or pro) to activate the subscription.
    """
    from sqlalchemy.orm import joinedload

    # Find the plan
    plan = db.query(Plan).filter(Plan.slug == plan_slug).first()
    if not plan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Plan '{plan_slug}' not found",
        )

    # Check for existing subscription
    existing_sub = (
        db.query(Subscription)
        .options(joinedload(Subscription.plan))
        .filter(Subscription.user_id == current_user.id)
        .first()
    )

    now = datetime.now(timezone.utc)
    period_end = now + timedelta(days=30)

    credits_added = 0
    old_plan_name = None

    if existing_sub:
        old_plan_name = existing_sub.plan.name if existing_sub.plan else None
        old_plan_price = existing_sub.plan.price if existing_sub.plan else 0

        # Only add credits if upgrading to a higher plan
        if plan.price > old_plan_price and plan.credits > 0:
            wallet = db.query(Wallet).filter(Wallet.user_id == current_user.id).first()
            if wallet:
                wallet.balance += plan.credits
                credits_added = plan.credits
                print(f"✅ Upgraded: Added {plan.credits} credits to wallet")

        # Update existing subscription
        existing_sub.plan_id = plan.id
        existing_sub.status = "active"
        existing_sub.current_period_start = now
        existing_sub.current_period_end = period_end
    else:
        # Create new subscription
        subscription = Subscription(
            user_id=current_user.id,
            plan_id=plan.id,
            status="active",
            current_period_start=now,
            current_period_end=period_end,
            stripe_subscription_id=f"dev_sub_{current_user.id}",
        )
        db.add(subscription)

        # Add credits for new subscription
        if plan.credits > 0:
            wallet = db.query(Wallet).filter(Wallet.user_id == current_user.id).first()
            if wallet:
                wallet.balance += plan.credits
                credits_added = plan.credits
                print(f"✅ New subscription: Added {plan.credits} credits to wallet")

    db.commit()

    message = f"Switched to {plan.name} plan"
    if old_plan_name:
        message = f"Changed from {old_plan_name} to {plan.name} plan"

    return {
        "message": message,
        "plan": plan.name,
        "credits_added": credits_added if credits_added > 0 else 0,
        "valid_until": period_end.isoformat(),
    }
