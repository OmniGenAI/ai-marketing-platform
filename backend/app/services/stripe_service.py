import stripe
from typing import Optional, Dict, Any

from app.config import settings

stripe.api_key = settings.STRIPE_SECRET_KEY


def create_checkout_session(
    plan_name: str,
    price_amount: int,
    user_id: str,
    plan_id: str,
    user_email: str,
    success_url: str,
    cancel_url: str,
) -> Dict[str, str]:
    """
    Create a Stripe Checkout Session with metadata for webhook processing.

    Returns dict with 'url' and 'session_id'.
    """
    session = stripe.checkout.Session.create(
        payment_method_types=["card"],
        line_items=[
            {
                "price_data": {
                    "currency": "usd",
                    "product_data": {"name": f"{plan_name} Plan"},
                    "unit_amount": price_amount,
                    "recurring": {"interval": "month"},
                },
                "quantity": 1,
            }
        ],
        mode="subscription",
        customer_email=user_email,
        success_url=success_url,
        cancel_url=cancel_url,
        # CRITICAL: Pass user_id and plan_id for webhook/verification
        metadata={
            "user_id": user_id,
            "plan_id": plan_id,
            "plan_name": plan_name,
        },
        # Also set metadata on the subscription itself for future events
        subscription_data={
            "metadata": {
                "user_id": user_id,
                "plan_id": plan_id,
            }
        },
    )
    return {
        "url": session.url or "",
        "session_id": session.id,
    }


def retrieve_checkout_session(session_id: str) -> Optional[Dict[str, Any]]:
    """
    Retrieve a Stripe Checkout Session by ID.

    Returns session data if found and paid, None otherwise.
    """
    try:
        session = stripe.checkout.Session.retrieve(
            session_id,
            expand=["subscription"]
        )

        # Extract subscription data safely
        sub = session.subscription
        sub_id = None
        sub_status = None
        period_start = None
        period_end = None

        if sub:
            # subscription can be a string (ID) or expanded object
            if isinstance(sub, str):
                sub_id = sub
                # Fetch full subscription to get period data
                try:
                    full_sub = stripe.Subscription.retrieve(sub)
                    sub_status = full_sub.status
                    period_start = full_sub.current_period_start
                    period_end = full_sub.current_period_end
                except Exception:
                    pass
            else:
                # Expanded subscription object
                sub_id = sub.id
                sub_status = sub.status
                period_start = getattr(sub, 'current_period_start', None)
                period_end = getattr(sub, 'current_period_end', None)

        return {
            "id": session.id,
            "payment_status": session.payment_status,
            "status": session.status,
            "customer": session.customer,
            "subscription": sub_id,
            "subscription_status": sub_status,
            "metadata": dict(session.metadata) if session.metadata else {},
            "current_period_start": period_start,
            "current_period_end": period_end,
        }
    except stripe.error.StripeError as e:
        print(f"[Stripe Error] Failed to retrieve session: {e}")
        return None
    except Exception as e:
        print(f"[Stripe Error] Unexpected error retrieving session: {e}")
        return None


def get_subscription(subscription_id: str) -> stripe.Subscription:
    """Retrieve a Stripe subscription by ID."""
    return stripe.Subscription.retrieve(subscription_id)


def cancel_subscription(subscription_id: str, at_period_end: bool = True) -> stripe.Subscription:
    """
    Cancel a Stripe subscription.

    Args:
        subscription_id: The Stripe subscription ID
        at_period_end: If True, cancels at end of billing period. If False, cancels immediately.
    """
    return stripe.Subscription.modify(
        subscription_id,
        cancel_at_period_end=at_period_end,
    )


def create_customer_portal_session(customer_id: str, return_url: str) -> str:
    """Create a Stripe Customer Portal session for managing billing."""
    session = stripe.billing_portal.Session.create(
        customer=customer_id,
        return_url=return_url,
    )
    return session.url


def construct_webhook_event(payload: bytes, sig_header: str) -> stripe.Event:
    return stripe.Webhook.construct_event(
        payload, sig_header, settings.STRIPE_WEBHOOK_SECRET
    )
