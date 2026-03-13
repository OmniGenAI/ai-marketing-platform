from datetime import datetime, timezone
from fastapi import APIRouter, Request, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.subscription import Subscription
from app.models.wallet import Wallet
from app.models.plan import Plan
from app.services.stripe_service import construct_webhook_event

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])


def handle_checkout_completed(event: dict, db: Session):
    """
    Handle successful checkout - activate subscription and add credits.

    This is the PRIMARY handler for new subscriptions.
    Stripe sends this event when payment is successful.
    """
    session = event["data"]["object"]

    # Get metadata from checkout session
    metadata = session.get("metadata", {})
    user_id = metadata.get("user_id")
    plan_id = metadata.get("plan_id")

    if not user_id or not plan_id:
        print(f"[Webhook Error] Missing metadata: user_id={user_id}, plan_id={plan_id}")
        print(f"[Webhook Debug] Full session metadata: {metadata}")
        raise ValueError("Missing user_id or plan_id in session metadata")

    # Get customer and subscription IDs from Stripe
    stripe_customer_id = session.get("customer")
    stripe_subscription_id = session.get("subscription")

    # Get the plan to know how many credits to add
    plan = db.query(Plan).filter(Plan.id == plan_id).first()
    if not plan:
        raise ValueError(f"Plan {plan_id} not found")

    # Check for existing subscription to prevent duplicates (idempotency)
    subscription = db.query(Subscription).filter(
        Subscription.user_id == user_id
    ).first()

    # Get subscription details from Stripe for accurate period dates
    subscription_data = None
    if stripe_subscription_id:
        import stripe
        try:
            subscription_data = stripe.Subscription.retrieve(stripe_subscription_id)
        except Exception as e:
            print(f"[Webhook Warning] Could not fetch subscription details: {e}")

    # Determine period dates
    if subscription_data:
        period_start = datetime.fromtimestamp(
            subscription_data["current_period_start"], tz=timezone.utc
        )
        period_end = datetime.fromtimestamp(
            subscription_data["current_period_end"], tz=timezone.utc
        )
    else:
        from datetime import timedelta
        period_start = datetime.now(timezone.utc)
        period_end = period_start + timedelta(days=30)

    # Credits: -1 = unlimited, 0 = none, >0 = specific amount
    credits_to_add = plan.credits

    if subscription:
        # Check if this is a duplicate event (idempotency)
        if (subscription.stripe_subscription_id == stripe_subscription_id and
            subscription.status == "active"):
            print(f"[Webhook] Duplicate event ignored for subscription {stripe_subscription_id}")
            return

        # Track if this is an upgrade
        old_plan_id = subscription.plan_id
        is_upgrade = old_plan_id != plan_id

        # Update existing subscription
        subscription.plan_id = plan_id
        subscription.stripe_subscription_id = stripe_subscription_id
        subscription.stripe_customer_id = stripe_customer_id
        subscription.status = "active"
        subscription.current_period_start = period_start
        subscription.current_period_end = period_end

        # Only add credits on initial purchase or upgrade
        if is_upgrade and credits_to_add != 0:
            add_credits_to_wallet(db, user_id, credits_to_add)
            credits_display = "Unlimited" if credits_to_add == -1 else credits_to_add
            print(f"[Webhook] Upgraded: User {user_id}, Plan {plan.name}, Credits: {credits_display}")
    else:
        # Create new subscription
        subscription = Subscription(
            user_id=user_id,
            plan_id=plan_id,
            stripe_subscription_id=stripe_subscription_id,
            stripe_customer_id=stripe_customer_id,
            status="active",
            current_period_start=period_start,
            current_period_end=period_end,
        )
        db.add(subscription)

        # Add credits for new subscription
        add_credits_to_wallet(db, user_id, credits_to_add)
        print(f"[Webhook] New subscription: User {user_id}, Plan {plan.name}, Credits added: {credits_to_add}")


def handle_invoice_paid(event: dict, db: Session):
    """
    Handle successful invoice payment - used for subscription renewals.

    This event fires for:
    - Initial subscription payment (also triggers checkout.session.completed)
    - Monthly/yearly renewal payments
    """
    invoice = event["data"]["object"]

    # Skip if this is not a subscription invoice
    if invoice.get("billing_reason") not in ["subscription_cycle", "subscription_create"]:
        return

    stripe_subscription_id = invoice.get("subscription")
    stripe_customer_id = invoice.get("customer")

    if not stripe_subscription_id:
        return

    # Find subscription by Stripe ID
    subscription = db.query(Subscription).filter(
        Subscription.stripe_subscription_id == stripe_subscription_id
    ).first()

    if not subscription:
        # Try to find by customer ID as fallback
        subscription = db.query(Subscription).filter(
            Subscription.stripe_customer_id == stripe_customer_id
        ).first()

        if not subscription:
            print(f"[Webhook Warning] Subscription not found for invoice: {stripe_subscription_id}")
            return

    # For renewal payments, add credits
    if invoice.get("billing_reason") == "subscription_cycle":
        plan = db.query(Plan).filter(Plan.id == subscription.plan_id).first()
        if plan and plan.credits != 0:
            add_credits_to_wallet(db, subscription.user_id, plan.credits)
            credits_display = "Unlimited" if plan.credits == -1 else plan.credits
            print(f"[Webhook] Renewal: User {subscription.user_id}, Credits: {credits_display}")

    # Update period from the subscription
    import stripe
    try:
        sub_data = stripe.Subscription.retrieve(stripe_subscription_id)
        subscription.current_period_start = datetime.fromtimestamp(
            sub_data["current_period_start"], tz=timezone.utc
        )
        subscription.current_period_end = datetime.fromtimestamp(
            sub_data["current_period_end"], tz=timezone.utc
        )
        subscription.status = "active"
    except Exception as e:
        print(f"[Webhook Warning] Could not update period: {e}")


def handle_subscription_created(event: dict, db: Session):
    """
    Handle subscription creation event.

    This is a backup handler - checkout.session.completed is the primary.
    Only creates subscription if it doesn't already exist.
    """
    subscription_data = event["data"]["object"]
    stripe_subscription_id = subscription_data["id"]
    stripe_customer_id = subscription_data.get("customer")

    # Get metadata from subscription
    metadata = subscription_data.get("metadata", {})
    user_id = metadata.get("user_id")
    plan_id = metadata.get("plan_id")

    if not user_id or not plan_id:
        print(f"[Webhook] subscription.created missing metadata, skipping (handled by checkout)")
        return

    # Check if subscription already exists (created by checkout handler)
    existing = db.query(Subscription).filter(
        Subscription.stripe_subscription_id == stripe_subscription_id
    ).first()

    if existing:
        print(f"[Webhook] Subscription {stripe_subscription_id} already exists, skipping")
        return

    # Also check by user_id
    existing_user_sub = db.query(Subscription).filter(
        Subscription.user_id == user_id
    ).first()

    if existing_user_sub:
        # Update with Stripe IDs if missing
        if not existing_user_sub.stripe_subscription_id:
            existing_user_sub.stripe_subscription_id = stripe_subscription_id
            existing_user_sub.stripe_customer_id = stripe_customer_id
        return

    # Create subscription (fallback path)
    plan = db.query(Plan).filter(Plan.id == plan_id).first()
    if not plan:
        print(f"[Webhook Error] Plan {plan_id} not found")
        return

    subscription = Subscription(
        user_id=user_id,
        plan_id=plan_id,
        stripe_subscription_id=stripe_subscription_id,
        stripe_customer_id=stripe_customer_id,
        status=subscription_data.get("status", "active"),
        current_period_start=datetime.fromtimestamp(
            subscription_data["current_period_start"], tz=timezone.utc
        ),
        current_period_end=datetime.fromtimestamp(
            subscription_data["current_period_end"], tz=timezone.utc
        ),
    )
    db.add(subscription)

    # Add credits (including unlimited = -1)
    if plan.credits != 0:
        add_credits_to_wallet(db, user_id, plan.credits)

    print(f"[Webhook] Created subscription via fallback: {stripe_subscription_id}")


def handle_subscription_updated(event: dict, db: Session):
    """Handle subscription updates - sync status changes."""
    subscription_data = event["data"]["object"]
    stripe_subscription_id = subscription_data["id"]

    # Find subscription by Stripe ID
    subscription = db.query(Subscription).filter(
        Subscription.stripe_subscription_id == stripe_subscription_id
    ).first()

    if not subscription:
        # Try to find by metadata user_id
        metadata = subscription_data.get("metadata", {})
        user_id = metadata.get("user_id")
        if user_id:
            subscription = db.query(Subscription).filter(
                Subscription.user_id == user_id
            ).first()

    if not subscription:
        print(f"[Webhook Warning] Subscription {stripe_subscription_id} not found in database")
        return

    # Update subscription status and period
    old_status = subscription.status
    new_status = subscription_data["status"]

    subscription.status = new_status
    subscription.current_period_start = datetime.fromtimestamp(
        subscription_data["current_period_start"], tz=timezone.utc
    )
    subscription.current_period_end = datetime.fromtimestamp(
        subscription_data["current_period_end"], tz=timezone.utc
    )

    # Update plan if changed
    metadata = subscription_data.get("metadata", {})
    new_plan_id = metadata.get("plan_id")
    if new_plan_id and new_plan_id != str(subscription.plan_id):
        old_plan_id = subscription.plan_id
        subscription.plan_id = new_plan_id

        # Add credits for upgrade (including unlimited = -1)
        new_plan = db.query(Plan).filter(Plan.id == new_plan_id).first()
        if new_plan and new_plan.credits != 0:
            add_credits_to_wallet(db, subscription.user_id, new_plan.credits)
            credits_display = "Unlimited" if new_plan.credits == -1 else new_plan.credits
            print(f"[Webhook] Plan changed, credits: {credits_display}")

    print(f"[Webhook] Subscription updated: {stripe_subscription_id}, {old_status} -> {new_status}")


def handle_subscription_deleted(event: dict, db: Session):
    """Handle subscription cancellation."""
    subscription_data = event["data"]["object"]
    stripe_subscription_id = subscription_data["id"]

    # Find subscription by Stripe ID
    subscription = db.query(Subscription).filter(
        Subscription.stripe_subscription_id == stripe_subscription_id
    ).first()

    if not subscription:
        print(f"[Webhook Warning] Subscription {stripe_subscription_id} not found in database")
        return

    # Update subscription status to cancelled
    subscription.status = "cancelled"

    print(f"[Webhook] Subscription cancelled: {stripe_subscription_id}")


def handle_invoice_payment_failed(event: dict, db: Session):
    """Handle failed invoice payment - update subscription status."""
    invoice = event["data"]["object"]
    stripe_subscription_id = invoice.get("subscription")

    if not stripe_subscription_id:
        return

    subscription = db.query(Subscription).filter(
        Subscription.stripe_subscription_id == stripe_subscription_id
    ).first()

    if subscription:
        subscription.status = "past_due"
        print(f"[Webhook] Payment failed, subscription {stripe_subscription_id} marked past_due")


def add_credits_to_wallet(db: Session, user_id: str, credits: int):
    """Helper to add credits to user's wallet. Credits of -1 means unlimited."""
    # Skip if 0 credits
    if credits == 0:
        return

    wallet = db.query(Wallet).filter(Wallet.user_id == user_id).first()

    if credits == -1:
        # Unlimited plan - set balance to -1
        if wallet:
            wallet.balance = -1
        else:
            wallet = Wallet(user_id=user_id, balance=-1)
            db.add(wallet)
    else:
        # Regular credits
        if wallet:
            # If wallet was unlimited, replace with new credits
            if wallet.balance == -1:
                wallet.balance = credits
            else:
                wallet.balance += credits
        else:
            wallet = Wallet(user_id=user_id, balance=credits)
            db.add(wallet)


@router.post("/stripe")
async def stripe_webhook(request: Request):
    """
    Stripe webhook endpoint.

    Handles all Stripe subscription events and updates the database accordingly.
    Must be configured in Stripe Dashboard to receive these events:
    - checkout.session.completed (PRIMARY for new subscriptions)
    - invoice.paid (for renewals)
    - customer.subscription.created
    - customer.subscription.updated
    - customer.subscription.deleted
    - invoice.payment_failed
    """
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    try:
        event = construct_webhook_event(payload, sig_header)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid payload",
        )
    except Exception as e:
        print(f"[Webhook Error] Signature verification failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid signature",
        )

    event_type = event["type"]
    print(f"[Webhook] Received event: {event_type}")

    # Get database session
    from app.database import SessionLocal
    db = SessionLocal()

    try:
        # Handle subscription events
        if event_type == "checkout.session.completed":
            handle_checkout_completed(event, db)
        elif event_type == "invoice.paid":
            handle_invoice_paid(event, db)
        elif event_type == "customer.subscription.created":
            handle_subscription_created(event, db)
        elif event_type == "customer.subscription.updated":
            handle_subscription_updated(event, db)
        elif event_type == "customer.subscription.deleted":
            handle_subscription_deleted(event, db)
        elif event_type == "invoice.payment_failed":
            handle_invoice_payment_failed(event, db)
        else:
            print(f"[Webhook] Unhandled event type: {event_type}")

        db.commit()
        print(f"[Webhook] Successfully processed: {event_type}")
    except Exception as e:
        db.rollback()
        print(f"[Webhook Error] Failed to process {event_type}: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Webhook processing failed: {str(e)}"
        )
    finally:
        db.close()

    return {"status": "ok"}
