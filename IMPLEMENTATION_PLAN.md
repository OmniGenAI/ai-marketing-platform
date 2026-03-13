# AI Marketing Platform - Implementation Plan

## 🚨 IMMEDIATE FIX (To Get Signup Working)

### Current Issue
- Database exists but has no tables → Migrations haven't run
- Signup API returns 500 error

### Fix Steps (5 minutes)

1. **Create Database User in DBeaver**
   ```sql
   -- Execute this in DBeaver SQL Editor:
   DO $$
   BEGIN
       IF NOT EXISTS (SELECT FROM pg_user WHERE usename = 'ai_marketing') THEN
           CREATE USER ai_marketing WITH PASSWORD 'ai_marketing_pass';
       ELSE
           ALTER USER ai_marketing WITH PASSWORD 'ai_marketing_pass';
       END IF;
   END $$;

   GRANT ALL PRIVILEGES ON DATABASE ai_marketing TO ai_marketing;
   GRANT ALL ON SCHEMA public TO ai_marketing;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ai_marketing;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ai_marketing;
   ```

2. **Run Migrations**
   ```bash
   cd /Users/mac/Desktop/omnigenai/ai-marketing-platform/backend
   source venv/bin/activate
   alembic upgrade head
   ```

3. **Verify in DBeaver**
   - Right-click database → Refresh
   - You should now see 8 tables: users, wallets, plans, subscriptions, business_configs, posts, social_accounts, usage_logs

4. **Test Signup**
   - Go to http://localhost:8000/docs
   - Try POST /api/auth/register
   - Should now return 201 with user data

---

## 📊 CURRENT STATUS

### ✅ IMPLEMENTED (65-70% Complete)
- ✓ User Authentication (register, login, JWT)
- ✓ Credit Wallet System (balance, usage logs)
- ✓ AI Content Generation (Google Gemini)
- ✓ Business Configuration
- ✓ Post Management (CRUD)
- ✓ Stripe Checkout (partial)
- ✓ Database Schema (all tables)

### ❌ MISSING (Critical for MVP)
- ✗ Social Media Publishing (Facebook, Instagram)
- ✗ Stripe Webhook Handlers (subscription activation)
- ✗ OAuth for Social Accounts
- ✗ Website Content Ingestion
- ✗ Post Scheduling System

---

## 🎯 PHASE 1 - MVP Features (From Project Doc)

### EPIC 1: Authentication & Subscription ✅ (70% Done)

**✓ Completed:**
- Email/Password login
- JWT authentication
- Session management
- Logout (frontend handles token removal)
- Subscription checkout flow

**❌ TODO:**
1. **Stripe Webhook Completion** (2-3 hours)
   - File: `/app/routers/webhooks.py` (lines 27-35)
   - Implement:
     - `checkout.session.completed` → Create subscription, add credits
     - `customer.subscription.updated` → Update subscription
     - `customer.subscription.deleted` → Cancel subscription

### EPIC 2: Business Configuration ✅ (100% Done)

**✓ Completed:**
- Business profile setup
- All fields implemented: name, industry (niche), target audience, brand tone, products, website URL
- Database storage complete
- API endpoints working

### EPIC 3: Website Content Ingestion ❌ (0% Done)

**❌ TODO:** (4-6 hours)
1. **Create Web Scraper Service**
   - New file: `/app/services/scraper.py`
   - Function: `crawl_website(url) → dict`
   - Extract: meta description, headings, about section, services

2. **AI Summarization**
   - Use Google Gemini to summarize scraped content
   - Generate brand context summary
   - Store in `business_configs.brand_voice`

3. **API Endpoint**
   - New endpoint: `POST /api/business-config/ingest`
   - Input: website URL
   - Output: AI-generated brand summary

**Implementation:**
```python
# /app/services/scraper.py
async def crawl_website(url: str) -> dict:
    # Use httpx or playwright to scrape
    # Extract key sections
    # Return structured data

async def summarize_brand(scraped_data: dict) -> str:
    # Use Gemini to create brand summary
    # Return concise brand context
```

### EPIC 4: AI Post Creation ✅ (90% Done)

**✓ Completed:**
- Platform selection (Facebook, Instagram)
- Tone override
- Hashtags (auto-generated)
- AI output with multiple variants (handled by frontend)
- Editable posts

**❌ TODO:**
1. **Add Image Support** (2 hours)
   - Add `image_url` field to Post model
   - Alembic migration: `alembic revision --autogenerate -m "add_image_url_to_posts"`
   - Update POST /api/posts endpoint
   - Update AI generation to suggest image prompts

### EPIC 5: Review & Publish ❌ (Critical - 4-6 hours)

**✓ Completed:**
- Preview (frontend)
- Edit option (PATCH /api/posts/{id})
- Save as draft (POST /api/posts)

**❌ TODO - CRITICAL:**
1. **Social Media Publishing Service**
   - File: `/app/services/social.py` (currently has stubs)
   - Implement Facebook Graph API integration
   - Implement Instagram Graph API integration

**Implementation:**
```python
# /app/services/social.py

async def publish_to_facebook(
    page_id: str,
    access_token: str,
    content: str
) -> dict:
    """Publish post to Facebook page"""
    url = f"https://graph.facebook.com/v18.0/{page_id}/feed"
    payload = {
        "message": content,
        "access_token": access_token
    }
    async with httpx.AsyncClient() as client:
        response = await client.post(url, json=payload)
        response.raise_for_status()
        return response.json()

async def publish_to_instagram(
    page_id: str,
    access_token: str,
    content: str,
    image_url: str
) -> dict:
    """Publish post to Instagram (requires image)"""
    # Step 1: Create media container
    container_url = f"https://graph.facebook.com/v18.0/{page_id}/media"
    container_payload = {
        "image_url": image_url,
        "caption": content,
        "access_token": access_token
    }

    async with httpx.AsyncClient() as client:
        # Create container
        container_response = await client.post(container_url, json=container_payload)
        container_response.raise_for_status()
        creation_id = container_response.json()["id"]

        # Publish container
        publish_url = f"https://graph.facebook.com/v18.0/{page_id}/media_publish"
        publish_payload = {
            "creation_id": creation_id,
            "access_token": access_token
        }
        publish_response = await client.post(publish_url, json=publish_payload)
        publish_response.raise_for_status()
        return publish_response.json()
```

2. **OAuth Flow for Social Accounts** (3-4 hours)
   - New router: `/app/routers/social_accounts.py`
   - Endpoints:
     - `GET /api/social/facebook/auth` → Redirect to Facebook OAuth
     - `GET /api/social/facebook/callback` → Handle OAuth callback
     - `GET /api/social/instagram/auth` → Redirect to Instagram OAuth
     - `GET /api/social/instagram/callback` → Handle OAuth callback
     - `GET /api/social/accounts` → List connected accounts
     - `DELETE /api/social/accounts/{id}` → Disconnect account

3. **Update Publish Endpoint**
   - New endpoint: `POST /api/posts/{id}/publish`
   - Logic:
     1. Get post from database
     2. Get user's social account for selected platform
     3. Call publishing service
     4. Update post status to "published"
     5. Set published_at timestamp
     6. Return success/error

---

## 📅 PHASE 2 - Advanced Features

### Content Calendar ❌ (Future)
- Calendar view endpoint
- Scheduled posts listing
- Edit scheduled content

### Scheduling System ❌ (Critical - 6-8 hours)
**TODO:**
1. **Background Scheduler**
   - Add library: `pip install apscheduler`
   - Create `/app/services/scheduler.py`
   - Schedule posts at specified times
   - Run in background with APScheduler

2. **Database Updates**
   - Add `scheduled_for` field to Post model
   - Add `last_scheduled_run` field
   - Migration needed

3. **Endpoints**
   - `POST /api/posts/{id}/schedule` → Schedule post for future
   - `GET /api/posts/scheduled` → List scheduled posts
   - `DELETE /api/posts/{id}/schedule` → Cancel schedule

**Implementation:**
```python
# /app/services/scheduler.py
from apscheduler.schedulers.asyncio import AsyncIOScheduler

scheduler = AsyncIOScheduler()

def schedule_post(post_id: str, scheduled_for: datetime):
    scheduler.add_job(
        publish_scheduled_post,
        'date',
        run_date=scheduled_for,
        args=[post_id]
    )

async def publish_scheduled_post(post_id: str):
    # Get post from database
    # Publish via social service
    # Update status
```

---

## 🧠 PHASE 3 - Autopilot Mode (Premium)

- Fully autonomous content creation
- Goal-based optimization
- Campaign planning
- Seasonal awareness
- Performance learning

**Status:** Not started (future roadmap)

---

## 🔧 CRITICAL FIXES NEEDED

### 1. Stripe Webhooks (BLOCKING)
**File:** `/app/routers/webhooks.py`
**Lines:** 27-35
**Priority:** HIGH
**Time:** 2-3 hours

```python
# Replace TODOs with:

if event_type == "checkout.session.completed":
    session = event.data.object
    user_id = session.metadata.get("user_id")
    plan_id = session.metadata.get("plan_id")

    # Create subscription
    subscription = Subscription(
        user_id=user_id,
        plan_id=plan_id,
        stripe_subscription_id=session.subscription,
        status="active",
        current_period_start=datetime.utcnow(),
        current_period_end=datetime.utcnow() + timedelta(days=30)
    )
    db.add(subscription)

    # Add credits to wallet
    plan = db.query(Plan).filter(Plan.id == plan_id).first()
    wallet = db.query(Wallet).filter(Wallet.user_id == user_id).first()
    wallet.balance += plan.credits

    db.commit()

elif event_type == "customer.subscription.updated":
    # Update subscription status and period dates

elif event_type == "customer.subscription.deleted":
    # Cancel subscription
```

### 2. Social Publishing (BLOCKING MVP)
**File:** `/app/services/social.py`
**Priority:** HIGH
**Time:** 4-6 hours

See implementation in EPIC 5 above.

### 3. Website Ingestion (MVP Feature)
**Priority:** MEDIUM
**Time:** 4-6 hours

See implementation in EPIC 3 above.

---

## 📋 IMPLEMENTATION CHECKLIST

### Immediate (This Week)
- [ ] Run database migrations (5 min)
- [ ] Test signup/login (5 min)
- [ ] Implement Stripe webhooks (2-3 hrs)
- [ ] Test full payment flow (30 min)

### Sprint 1 (Next Week)
- [ ] Implement website scraping (3 hrs)
- [ ] Implement AI summarization (2 hrs)
- [ ] Add image_url to posts (1 hr)
- [ ] Create social publishing service (4 hrs)
- [ ] Implement OAuth flow (4 hrs)
- [ ] Test full publish flow (1 hr)

### Sprint 2 (Week After)
- [ ] Implement post scheduling (6 hrs)
- [ ] Add calendar endpoints (2 hrs)
- [ ] Add error handling & logging (3 hrs)
- [ ] Write integration tests (4 hrs)

---

## 🚀 QUICK START AFTER MIGRATION FIX

Once migrations run successfully, your backend will have:

### Working Endpoints:
```
✓ POST /api/auth/register
✓ POST /api/auth/login
✓ GET  /api/auth/me
✓ POST /api/business-config
✓ GET  /api/business-config
✓ POST /api/generate (AI post generation)
✓ GET  /api/posts
✓ POST /api/posts
✓ GET  /api/wallet
✓ POST /api/subscription/checkout
```

### Missing Endpoints to Build:
```
✗ POST /api/business-config/ingest (website scraping)
✗ POST /api/posts/{id}/publish (social publishing)
✗ POST /api/posts/{id}/schedule (scheduling)
✗ GET  /api/social/accounts (OAuth)
✗ Stripe webhooks (subscription activation)
```

---

## 📦 DEPENDENCIES TO ADD

```bash
# For web scraping
pip install beautifulsoup4 playwright httpx

# For scheduling
pip install apscheduler

# For image processing (future)
pip install pillow

# Update requirements.txt
pip freeze > requirements.txt
```

---

## 🎯 SUCCESS METRICS

After completing Phase 1 MVP:
- ✅ Users can signup and login
- ✅ Users can subscribe and pay
- ✅ Users can configure business profile
- ✅ AI generates posts based on business
- ✅ Users can publish to Facebook/Instagram
- ✅ Users can schedule posts for future
- ✅ Wallet tracks credit usage

---

**Next Steps:**
1. Run migrations (see top of document)
2. Test signup flow
3. Start implementing Stripe webhooks
4. Build social publishing service
5. Add OAuth flow

Good luck! 🚀
