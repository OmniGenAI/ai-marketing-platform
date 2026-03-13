# Stripe Subscription Setup Guide

This document explains how to set up Stripe webhooks for the AI Marketing Platform.

## Overview

The subscription flow works as follows:

```
User clicks Upgrade
       ↓
Frontend calls /api/subscription/checkout
       ↓
Backend creates Stripe Checkout Session (with user_id and plan_id in metadata)
       ↓
User redirected to Stripe Checkout
       ↓
User completes payment
       ↓
Stripe sends webhook to /api/webhooks/stripe
       ↓
Backend updates subscriptions table
       ↓
Frontend fetches updated subscription status
```

## Environment Variables

Add these to your `.env` file:

```env
STRIPE_SECRET_KEY=sk_live_...        # or sk_test_... for testing
STRIPE_WEBHOOK_SECRET=whsec_...      # From Stripe webhook settings
```

## Webhook Setup

### Local Development

1. Install Stripe CLI:
   ```bash
   brew install stripe/stripe-cli/stripe
   ```

2. Login to Stripe:
   ```bash
   stripe login
   ```

3. Forward webhooks to your local server:
   ```bash
   stripe listen --forward-to localhost:8000/api/webhooks/stripe
   ```

4. Copy the webhook signing secret (starts with `whsec_`) and add it to `.env`

### Production

1. Go to [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks)

2. Click "Add endpoint"

3. Enter your endpoint URL:
   ```
   https://your-domain.com/api/webhooks/stripe
   ```

4. Select these events:
   - `checkout.session.completed` (Primary - new subscriptions)
   - `invoice.paid` (Monthly renewals)
   - `customer.subscription.created` (Backup handler)
   - `customer.subscription.updated` (Plan changes, status updates)
   - `customer.subscription.deleted` (Cancellations)
   - `invoice.payment_failed` (Failed payments)

5. Copy the signing secret and add it to your production environment

## Database Migration

Run the migration to add `stripe_customer_id`:

```bash
cd backend
alembic upgrade head
```

Or manually:
```sql
ALTER TABLE subscriptions ADD COLUMN stripe_customer_id VARCHAR(255);
```

## Testing the Flow

### 1. Test Checkout

1. Start the backend: `cd backend && uvicorn app.main:app --reload`
2. Start the frontend: `cd frontend && npm run dev`
3. Start Stripe CLI: `stripe listen --forward-to localhost:8000/api/webhooks/stripe`
4. Go to `/subscription` and click "Upgrade" on a paid plan
5. Use test card: `4242 4242 4242 4242`, any future date, any CVC
6. Complete checkout
7. Verify the subscription is activated in the database

### 2. Test Webhook Manually

```bash
stripe trigger checkout.session.completed
```

### 3. Test Cancellation

1. Go to `/subscription`
2. Click "Cancel Plan"
3. Verify status changes to "cancelled" in the database

## Troubleshooting

### Subscription not updating after payment

1. Check Stripe CLI output for webhook errors
2. Check backend logs for `[Webhook]` messages
3. Verify webhook secret matches

### "Missing user_id or plan_id in metadata" error

This means the checkout session was created without proper metadata. The fix has been applied - ensure you're using the updated code that passes `user_id` and `plan_id` to `create_checkout_session()`.

### Duplicate credits being added

The webhook handler now includes idempotency checks. If you still see duplicates, verify:
1. Only one instance of the backend is running
2. Webhook is only configured once in Stripe Dashboard

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/subscription/status` | GET | Get current subscription |
| `/api/subscription/checkout` | POST | Create Stripe checkout session |
| `/api/subscription/cancel` | POST | Cancel subscription |
| `/api/subscription/billing-portal` | GET | Get Stripe billing portal URL |
| `/api/webhooks/stripe` | POST | Stripe webhook endpoint |

## Webhook Events Handled

| Event | Action |
|-------|--------|
| `checkout.session.completed` | Create/update subscription, add credits |
| `invoice.paid` | Add renewal credits, update period |
| `customer.subscription.created` | Backup subscription creation |
| `customer.subscription.updated` | Sync status, period, plan changes |
| `customer.subscription.deleted` | Mark as cancelled |
| `invoice.payment_failed` | Mark as past_due |

## Feature Gating

Credits are tracked per plan:
- Free: 10 posts/month
- Starter: 100 posts/month
- Pro: Unlimited (-1 in database)

The `/api/generate` endpoint checks credits before generating and deducts 1 credit per post.
