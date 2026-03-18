from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models.user import User
from app.models.subscription import Subscription
from app.models.plan import Plan
from app.models.wallet import Wallet
from app.schemas.subscription import SubscriptionResponse, CheckoutRequest
from app.dependencies import get_current_user
from app.services.stripe_service import (
    create_checkout_session,
    retrieve_checkout_session,
    cancel_subscription as stripe_cancel_subscription,
    create_customer_portal_session,
)
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
        result = create_checkout_session(
            plan_name=plan.name,
            price_amount=int(plan.price * 100),
            user_id=str(current_user.id),
            plan_id=str(plan.id),
            user_email=current_user.email,
            # Include session_id in success URL for verification
            success_url=f"{settings.FRONTEND_URL}/subscription?success=true&session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{settings.FRONTEND_URL}/subscription?canceled=true",
        )

        return {
            "checkout_url": result["url"],
            "session_id": result["session_id"],
        }
    except Exception as e:
        print(f"[Stripe Error] {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Stripe error: {str(e)}",
        )


class VerifyRequest(BaseModel):
    session_id: str


@router.post("/verify")
def verify_checkout_session(
    data: VerifyRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Verify a Stripe checkout session and activate the subscription.

    This is a fallback for when webhooks are not configured or fail.
    Called by the frontend after successful payment redirect.
    """
    session_data = retrieve_checkout_session(data.session_id)

    if not session_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Checkout session not found",
        )

    # Verify payment was successful
    if session_data["payment_status"] != "paid":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Payment not completed. Status: {session_data['payment_status']}",
        )

    # Get user_id and plan_id from metadata
    metadata = session_data.get("metadata", {})
    session_user_id = metadata.get("user_id")
    plan_id = metadata.get("plan_id")

    # Security: Verify the session belongs to this user
    if session_user_id != str(current_user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This checkout session does not belong to you",
        )

    if not plan_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid session: missing plan information",
        )

    # Get plan
    plan = db.query(Plan).filter(Plan.id == plan_id).first()
    if not plan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Plan not found",
        )

    # Check for existing subscription
    from sqlalchemy.orm import joinedload
    existing_sub = (
        db.query(Subscription)
        .options(joinedload(Subscription.plan))
        .filter(Subscription.user_id == current_user.id)
        .first()
    )

    stripe_subscription_id = session_data.get("subscription")
    stripe_customer_id = session_data.get("customer")

    # Calculate period dates
    if session_data.get("current_period_start") and session_data.get("current_period_end"):
        period_start = datetime.fromtimestamp(session_data["current_period_start"], tz=timezone.utc)
        period_end = datetime.fromtimestamp(session_data["current_period_end"], tz=timezone.utc)
    else:
        period_start = datetime.now(timezone.utc)
        period_end = period_start + timedelta(days=30)

    credits_added = 0
    old_plan_name = None

    if existing_sub:
        # Check if already activated with this session (idempotency)
        if existing_sub.stripe_subscription_id == stripe_subscription_id and existing_sub.status == "active":
            return {
                "message": f"Already subscribed to {plan.name} plan",
                "plan": plan.name,
                "status": "already_active",
            }

        old_plan_name = existing_sub.plan.name if existing_sub.plan else None
        old_plan_credits = existing_sub.plan.credits if existing_sub.plan else 0

        # Update existing subscription
        existing_sub.plan_id = plan_id
        existing_sub.stripe_subscription_id = stripe_subscription_id
        existing_sub.stripe_customer_id = stripe_customer_id
        existing_sub.status = "active"
        existing_sub.current_period_start = period_start
        existing_sub.current_period_end = period_end

        # Add credits for upgrade (including unlimited = -1)
        if plan.credits != 0 and plan.credits != old_plan_credits:
            credits_added = add_credits_to_wallet(db, str(current_user.id), plan.credits)
    else:
        # Create new subscription
        subscription = Subscription(
            user_id=current_user.id,
            plan_id=plan_id,
            stripe_subscription_id=stripe_subscription_id,
            stripe_customer_id=stripe_customer_id,
            status="active",
            current_period_start=period_start,
            current_period_end=period_end,
        )
        db.add(subscription)

        # Add credits for new subscription (including unlimited = -1)
        if plan.credits != 0:
            credits_added = add_credits_to_wallet(db, str(current_user.id), plan.credits)

    db.commit()

    message = f"Successfully subscribed to {plan.name} plan!"
    if old_plan_name:
        message = f"Upgraded from {old_plan_name} to {plan.name} plan!"

    return {
        "message": message,
        "plan": plan.name,
        "credits_added": credits_added,
        "valid_until": period_end.isoformat(),
        "status": "activated",
    }


def add_credits_to_wallet(db: Session, user_id: str, credits: int) -> int:
    """Add credits to user's wallet. Credits of -1 = unlimited. Returns credits added."""
    # Skip if 0 credits
    if credits == 0:
        return 0

    wallet = db.query(Wallet).filter(Wallet.user_id == user_id).first()

    # For unlimited plans (-1), set balance to -1
    if credits == -1:
        if wallet:
            wallet.balance = -1
        else:
            wallet = Wallet(user_id=user_id, balance=-1)
            db.add(wallet)
        return -1  # Unlimited

    # Regular credits (positive number)
    if wallet:
        # If wallet was unlimited, replace with new credits
        if wallet.balance == -1:
            wallet.balance = credits
        else:
            wallet.balance += credits
    else:
        wallet = Wallet(user_id=user_id, balance=credits)
        db.add(wallet)

    return credits


@router.post("/dev/activate/{plan_slug}")
def dev_activate_subscription(
    plan_slug: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Development only: Manually activate a subscription.
    Use this for testing without going through Stripe checkout.
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

        # Update existing subscription
        existing_sub.plan_id = plan.id
        existing_sub.status = "active"
        existing_sub.current_period_start = now
        existing_sub.current_period_end = period_end

        # Add credits
        if plan.credits != 0:
            credits_added = add_credits_to_wallet(db, str(current_user.id), plan.credits)
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

        # Add credits
        if plan.credits != 0:
            credits_added = add_credits_to_wallet(db, str(current_user.id), plan.credits)

    db.commit()

    message = f"Activated {plan.name} plan"
    if old_plan_name:
        message = f"Changed from {old_plan_name} to {plan.name} plan"

    return {
        "message": message,
        "plan": plan.name,
        "credits_added": credits_added,
        "valid_until": period_end.isoformat(),
    }


@router.post("/cancel")
def cancel_subscription(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Cancel the user's subscription at the end of the billing period.
    """
    subscription = db.query(Subscription).filter(
        Subscription.user_id == current_user.id
    ).first()

    if not subscription:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active subscription found",
        )

    if subscription.status == "cancelled":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Subscription is already cancelled",
        )

    # Cancel on Stripe if we have a real subscription ID
    if subscription.stripe_subscription_id and not subscription.stripe_subscription_id.startswith("dev_"):
        try:
            stripe_cancel_subscription(subscription.stripe_subscription_id, at_period_end=True)
        except Exception as e:
            print(f"[Stripe Error] Failed to cancel subscription: {e}")
            # Continue anyway - mark as cancelled locally

    subscription.status = "cancelled"
    db.commit()

    return {
        "message": "Subscription cancelled. You will have access until the end of your billing period.",
        "active_until": subscription.current_period_end.isoformat() if subscription.current_period_end else None,
    }


@router.get("/billing-portal")
def get_billing_portal(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get a URL to the Stripe Customer Portal for managing billing."""
    subscription = db.query(Subscription).filter(
        Subscription.user_id == current_user.id
    ).first()

    if not subscription or not subscription.stripe_customer_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No billing information found. Please subscribe to a plan first.",
        )

    # Check for dev subscriptions
    if subscription.stripe_customer_id.startswith("dev_") or subscription.stripe_subscription_id.startswith("dev_"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Billing portal is not available for development subscriptions. Please use a real Stripe subscription.",
        )

    try:
        portal_url = create_customer_portal_session(
            subscription.stripe_customer_id,
            return_url=f"{settings.FRONTEND_URL}/subscription",
        )

        if not portal_url:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Stripe returned an empty portal URL. Please configure the Customer Portal in your Stripe Dashboard.",
            )

        return {"portal_url": portal_url}
    except HTTPException:
        raise
    except Exception as e:
        error_msg = str(e)
        print(f"[Stripe Error] Failed to create portal session: {error_msg}")

        # Check for common issues
        if "No such customer" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Customer not found in Stripe. The subscription may have been created in a different Stripe account.",
            )
        if "portal configuration" in error_msg.lower():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Please configure the Customer Portal in your Stripe Dashboard: https://dashboard.stripe.com/test/settings/billing/portal",
            )

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create billing portal: {error_msg}",
        )
