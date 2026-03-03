from datetime import datetime, timedelta
from fastapi import APIRouter, Request, HTTPException, status, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.subscription import Subscription
from app.models.wallet import Wallet
from app.models.plan import Plan
from app.models.user import User
from app.services.stripe_service import construct_webhook_event

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])


def handle_checkout_completed(event: dict, db: Session):
    """Handle successful checkout - activate subscription and add credits"""
    session = event["data"]["object"]

    # Get metadata from checkout session
    user_id = session["metadata"].get("user_id")
    plan_id = session["metadata"].get("plan_id")

    if not user_id or not plan_id:
        raise ValueError("Missing user_id or plan_id in session metadata")

    # Get the plan to know how many credits to add
    plan = db.query(Plan).filter(Plan.id == plan_id).first()
    if not plan:
        raise ValueError(f"Plan {plan_id} not found")

    # Create or update subscription
    subscription = db.query(Subscription).filter(
        Subscription.user_id == user_id
    ).first()

    if subscription:
        # Update existing subscription
        subscription.plan_id = plan_id
        subscription.stripe_subscription_id = session.get("subscription")
        subscription.status = "active"
        subscription.current_period_start = datetime.utcnow()
        subscription.current_period_end = datetime.utcnow() + timedelta(days=30)
    else:
        # Create new subscription
        subscription = Subscription(
            user_id=user_id,
            plan_id=plan_id,
            stripe_subscription_id=session.get("subscription"),
            status="active",
            current_period_start=datetime.utcnow(),
            current_period_end=datetime.utcnow() + timedelta(days=30)
        )
        db.add(subscription)

    # Add credits to wallet
    wallet = db.query(Wallet).filter(Wallet.user_id == user_id).first()
    if wallet:
        wallet.balance += plan.credits
    else:
        # Create wallet if doesn't exist (shouldn't happen, but safeguard)
        wallet = Wallet(user_id=user_id, balance=plan.credits)
        db.add(wallet)

    print(f"✅ Checkout completed: User {user_id}, Plan {plan.name}, Credits added: {plan.credits}")


def handle_subscription_updated(event: dict, db: Session):
    """Handle subscription updates - sync status changes"""
    subscription_data = event["data"]["object"]
    stripe_subscription_id = subscription_data["id"]

    # Find subscription by Stripe ID
    subscription = db.query(Subscription).filter(
        Subscription.stripe_subscription_id == stripe_subscription_id
    ).first()

    if not subscription:
        print(f"⚠️ Subscription {stripe_subscription_id} not found in database")
        return

    # Update subscription status and period
    subscription.status = subscription_data["status"]
    subscription.current_period_start = datetime.fromtimestamp(
        subscription_data["current_period_start"]
    )
    subscription.current_period_end = datetime.fromtimestamp(
        subscription_data["current_period_end"]
    )

    print(f"✅ Subscription updated: {stripe_subscription_id}, Status: {subscription.status}")


def handle_subscription_deleted(event: dict, db: Session):
    """Handle subscription cancellation"""
    subscription_data = event["data"]["object"]
    stripe_subscription_id = subscription_data["id"]

    # Find subscription by Stripe ID
    subscription = db.query(Subscription).filter(
        Subscription.stripe_subscription_id == stripe_subscription_id
    ).first()

    if not subscription:
        print(f"⚠️ Subscription {stripe_subscription_id} not found in database")
        return

    # Update subscription status to cancelled
    subscription.status = "cancelled"

    print(f"✅ Subscription cancelled: {stripe_subscription_id}")


@router.post("/stripe")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    try:
        event = construct_webhook_event(payload, sig_header)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid payload",
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid signature",
        )

    # Get database session
    from app.database import SessionLocal
    db = SessionLocal()

    try:
        # Handle subscription events
        if event["type"] == "checkout.session.completed":
            handle_checkout_completed(event, db)
        elif event["type"] == "customer.subscription.updated":
            handle_subscription_updated(event, db)
        elif event["type"] == "customer.subscription.deleted":
            handle_subscription_deleted(event, db)

        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Webhook processing failed: {str(e)}"
        )
    finally:
        db.close()

    return {"status": "ok"}
