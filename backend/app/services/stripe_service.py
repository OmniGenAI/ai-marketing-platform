import stripe

from app.config import settings

stripe.api_key = settings.STRIPE_SECRET_KEY


def create_checkout_session(
    plan_name: str,
    price_amount: int,
    user_email: str,
    success_url: str,
    cancel_url: str,
) -> str:
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
    )
    return session.url or ""


def construct_webhook_event(payload: bytes, sig_header: str) -> stripe.Event:
    return stripe.Webhook.construct_event(
        payload, sig_header, settings.STRIPE_WEBHOOK_SECRET
    )
