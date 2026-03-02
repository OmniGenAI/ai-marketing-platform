from fastapi import APIRouter, Request, HTTPException, status

from app.services.stripe_service import construct_webhook_event

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])


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

    # Handle subscription events
    if event["type"] == "checkout.session.completed":
        # TODO: Activate subscription, credit wallet
        pass
    elif event["type"] == "customer.subscription.updated":
        # TODO: Update subscription status
        pass
    elif event["type"] == "customer.subscription.deleted":
        # TODO: Cancel subscription
        pass

    return {"status": "ok"}
