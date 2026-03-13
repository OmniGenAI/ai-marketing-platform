# Complete API Testing Guide

**Last Updated:** March 5, 2026
**Purpose:** Test all backend endpoints and features

---

## 🚀 Quick Test Commands

### Step 1: Start Backend (if not running)

```bash
cd /Users/mac/Desktop/omnigenai/ai-marketing-platform/backend
source venv/bin/activate
uvicorn app.main:app --reload
```

**Expected Output:**
```
INFO:     Uvicorn running on http://127.0.0.1:8000
INFO:     Application startup complete.
```

---

## 📋 Testing Checklist

### ✅ Step 1: Health Check

```bash
curl http://localhost:8000/health
```

**Expected Response:**
```json
{"status":"healthy"}
```

**If fails:** Backend is not running

---

### ✅ Step 2: Test User Registration

```bash
curl -X POST http://localhost:8000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test123456",
    "full_name": "Test User"
  }'
```

**Expected Response:**
```json
{
  "access_token": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "token_type": "bearer",
  "user": {
    "id": "...",
    "email": "test@example.com",
    "full_name": "Test User"
  }
}
```

**Save the `access_token` for next tests!**

---

### ✅ Step 3: Test Login

```bash
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test123456"
  }'
```

**Expected Response:**
```json
{
  "access_token": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "token_type": "bearer"
}
```

---

### ✅ Step 4: Test Authentication (Get Current User)

```bash
# Replace YOUR_TOKEN with the access_token from Step 2 or 3
curl http://localhost:8000/api/auth/me \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Expected Response:**
```json
{
  "id": "...",
  "email": "test@example.com",
  "full_name": "Test User",
  "created_at": "2026-03-05T..."
}
```

---

### ✅ Step 5: Test Wallet (Credit System)

```bash
curl http://localhost:8000/api/wallet \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Expected Response:**
```json
{
  "balance": 10,
  "lifetime_usage": 0,
  "user_id": "..."
}
```

**Note:** New users get 10 free credits

---

### ✅ Step 6: Test Business Configuration

#### Save Business Config

```bash
curl -X POST http://localhost:8000/api/business-config \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "business_name": "My Test Business",
    "industry": "Technology",
    "target_audience": "Small businesses",
    "brand_tone": "professional",
    "products_services": "AI Marketing Tools"
  }'
```

**Expected Response:**
```json
{
  "id": "...",
  "business_name": "My Test Business",
  "industry": "Technology",
  "target_audience": "Small businesses",
  "brand_tone": "professional",
  "products_services": "AI Marketing Tools"
}
```

#### Get Business Config

```bash
curl http://localhost:8000/api/business-config \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### ✅ Step 7: Test AI Post Generation

```bash
curl -X POST http://localhost:8000/api/generate \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "facebook",
    "topic": "Spring sale - 20% off all products",
    "tone": "friendly"
  }'
```

**Expected Response:**
```json
{
  "content": "🌸 Spring into savings! ...",
  "hashtags": ["#SpringSale", "#Discount", "#Shopping"],
  "platform": "facebook",
  "tone": "friendly",
  "credits_used": 1
}
```

**What's Being Tested:**
- ✅ Google Gemini API integration
- ✅ AI text generation
- ✅ Credit deduction (balance should decrease by 1)
- ✅ Business context integration

**If fails:**
- Check `GOOGLE_GEMINI_API_KEY` in .env
- Check backend logs for API errors

---

### ✅ Step 8: Test Post Creation (Save as Draft)

```bash
curl -X POST http://localhost:8000/api/posts \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "facebook",
    "content": "Test post content",
    "hashtags": ["#test", "#demo"],
    "status": "draft"
  }'
```

**Expected Response:**
```json
{
  "id": "...",
  "platform": "facebook",
  "content": "Test post content",
  "hashtags": ["#test", "#demo"],
  "status": "draft",
  "created_at": "..."
}
```

**Save the post `id` for next tests!**

---

### ✅ Step 9: Test Get All Posts

```bash
curl http://localhost:8000/api/posts \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Expected Response:**
```json
[
  {
    "id": "...",
    "platform": "facebook",
    "content": "Test post content",
    "status": "draft",
    ...
  }
]
```

---

### ✅ Step 10: Test Update Post

```bash
# Replace POST_ID with the id from Step 8
curl -X PATCH http://localhost:8000/api/posts/POST_ID \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Updated content"
  }'
```

**Expected Response:**
```json
{
  "id": "...",
  "content": "Updated content",
  ...
}
```

---

### ✅ Step 11: Test Facebook OAuth URL

```bash
curl http://localhost:8000/api/social/facebook/auth \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Expected Response:**
```json
{
  "auth_url": "https://www.facebook.com/v18.0/dialog/oauth?client_id=1601239620924716&redirect_uri=http://localhost:8000/api/social/facebook/callback&scope=..."
}
```

**What's Being Tested:**
- ✅ Facebook App ID is loaded
- ✅ OAuth URL is generated correctly

**If fails:**
- Check `FACEBOOK_APP_ID` in .env
- Restart backend to load new env vars

---

### ✅ Step 12: Test Instagram OAuth URL

```bash
curl http://localhost:8000/api/social/instagram/auth \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Expected Response:**
```json
{
  "auth_url": "https://www.facebook.com/v18.0/dialog/oauth?client_id=1601239620924716&redirect_uri=http://localhost:8000/api/social/instagram/callback&scope=..."
}
```

---

### ✅ Step 13: Test Mock Social Accounts (Development)

#### Mock Facebook Connection

```bash
curl -X POST http://localhost:8000/api/social/dev/mock/facebook \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Expected Response:**
```json
{
  "message": "Facebook account connected successfully (mock)",
  "account": {
    "id": "...",
    "platform": "facebook",
    "page_name": "Test Facebook Page"
  }
}
```

#### Mock Instagram Connection

```bash
curl -X POST http://localhost:8000/api/social/dev/mock/instagram \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### ✅ Step 14: Test Get Connected Accounts

```bash
curl http://localhost:8000/api/social/accounts \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Expected Response:**
```json
[
  {
    "id": "...",
    "platform": "facebook",
    "page_name": "Test Facebook Page",
    "connected_at": "..."
  },
  {
    "id": "...",
    "platform": "instagram",
    "page_name": "@test_instagram",
    "connected_at": "..."
  }
]
```

---

### ✅ Step 15: Test Publish (Mock Mode)

**First, create a post with image URL:**

```bash
curl -X POST http://localhost:8000/api/posts \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "instagram",
    "content": "Test Instagram post",
    "hashtags": ["#test"],
    "image_url": "https://picsum.photos/1080/1080",
    "status": "draft"
  }'
```

**Then try to publish (will fail with mock tokens):**

```bash
# Replace POST_ID with the id from above
curl -X POST http://localhost:8000/api/posts/POST_ID/publish \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Expected Response (will fail because mock tokens aren't real):**
```json
{
  "detail": "Failed to publish: ..."
}
```

**This is EXPECTED with mock accounts. To actually publish, you need real OAuth.**

---

### ✅ Step 16: Test Subscription Plans

```bash
curl http://localhost:8000/api/plans
```

**Expected Response:**
```json
[
  {
    "id": "...",
    "name": "Free Trial",
    "credits": 10,
    "price": 0
  },
  {
    "id": "...",
    "name": "Starter",
    "credits": 100,
    "price": 9.99
  }
]
```

---

### ✅ Step 17: Test OpenAPI Docs

**Open in browser:**
```
http://localhost:8000/docs
```

**You should see:**
- Interactive Swagger UI
- All 26+ endpoints documented
- Ability to test directly from browser

---

## 🎯 Automated Test Script

Save this as `test_api.sh` and run it:

```bash
#!/bin/bash

BASE_URL="http://localhost:8000"
TOKEN=""

echo "=== AI Marketing Platform - API Test Suite ==="
echo ""

# Test 1: Health Check
echo "✓ Testing Health Check..."
curl -s $BASE_URL/health | jq .

# Test 2: Register User
echo ""
echo "✓ Testing Registration..."
REGISTER_RESPONSE=$(curl -s -X POST $BASE_URL/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test'$(date +%s)'@example.com",
    "password": "Test123456",
    "full_name": "Test User"
  }')
echo $REGISTER_RESPONSE | jq .

# Extract token
TOKEN=$(echo $REGISTER_RESPONSE | jq -r '.access_token')
echo "Token: $TOKEN"

# Test 3: Get Current User
echo ""
echo "✓ Testing Get Current User..."
curl -s $BASE_URL/api/auth/me \
  -H "Authorization: Bearer $TOKEN" | jq .

# Test 4: Get Wallet
echo ""
echo "✓ Testing Wallet..."
curl -s $BASE_URL/api/wallet \
  -H "Authorization: Bearer $TOKEN" | jq .

# Test 5: Business Config
echo ""
echo "✓ Testing Business Config..."
curl -s -X POST $BASE_URL/api/business-config \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "business_name": "Test Business",
    "industry": "Technology",
    "target_audience": "Developers",
    "brand_tone": "professional",
    "products_services": "AI Tools"
  }' | jq .

# Test 6: AI Generation
echo ""
echo "✓ Testing AI Generation..."
curl -s -X POST $BASE_URL/api/generate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "facebook",
    "topic": "Product launch",
    "tone": "friendly"
  }' | jq .

# Test 7: Facebook OAuth URL
echo ""
echo "✓ Testing Facebook OAuth URL..."
curl -s $BASE_URL/api/social/facebook/auth \
  -H "Authorization: Bearer $TOKEN" | jq .

# Test 8: Mock Facebook
echo ""
echo "✓ Testing Mock Facebook Connection..."
curl -s -X POST $BASE_URL/api/social/dev/mock/facebook \
  -H "Authorization: Bearer $TOKEN" | jq .

# Test 9: Get Connected Accounts
echo ""
echo "✓ Testing Get Connected Accounts..."
curl -s $BASE_URL/api/social/accounts \
  -H "Authorization: Bearer $TOKEN" | jq .

echo ""
echo "=== Test Suite Complete ==="
```

**Run it:**

```bash
chmod +x test_api.sh
./test_api.sh
```

---

## 📊 What Each Test Validates

| Test | What It Checks | Status Indicator |
|------|---------------|------------------|
| Health | Backend is running | `{"status":"healthy"}` |
| Register | Database connection, user creation | Returns `access_token` |
| Login | Authentication works | Returns `access_token` |
| Get User | JWT validation works | Returns user data |
| Wallet | Credit system works | Returns balance (10) |
| Business Config | Database CRUD works | Returns saved config |
| AI Generation | Gemini API works | Returns generated content |
| OAuth URLs | Facebook credentials loaded | Returns auth_url |
| Mock Accounts | Social account system works | Returns account data |
| Publish | Publishing logic (will fail on mock) | Expected to fail |

---

## 🐛 Common Issues & Fixes

### Issue 1: "Connection refused"
**Cause:** Backend not running
**Fix:**
```bash
cd backend
source venv/bin/activate
uvicorn app.main:app --reload
```

### Issue 2: "401 Unauthorized"
**Cause:** Invalid or missing token
**Fix:** Get new token from `/api/auth/login`

### Issue 3: "INVALID_ARGUMENT: API key not valid"
**Cause:** Invalid Gemini API key
**Fix:** Check `GOOGLE_GEMINI_API_KEY` in .env

### Issue 4: OAuth URL not showing Facebook App ID
**Cause:** Environment variables not loaded
**Fix:** Restart backend after updating .env

### Issue 5: "Failed to publish"
**Cause:** Using mock tokens (expected)
**Fix:** Complete real OAuth flow or ignore if testing

---

## ✅ Expected Results Summary

After running all tests, you should have:

✅ **Working:**
- Authentication & JWT
- User registration/login
- Credit wallet system
- Business configuration
- AI post generation
- Post CRUD operations
- OAuth URL generation
- Mock social accounts
- Database operations

⚠️ **Partial (Expected):**
- Real publishing (needs real OAuth)
- Stripe (needs real webhook setup)

❌ **Not Implemented Yet:**
- Website content ingestion
- Post scheduling
- Content calendar
- Analytics
- LinkedIn/Twitter integration

---

## 🚀 Next Steps

Once all tests pass:

1. ✅ Test OAuth flow in browser
2. ✅ Connect real Facebook/Instagram account
3. ✅ Try publishing a real post
4. ✅ Build frontend integration
5. ✅ Add missing features (scheduling, etc.)

---

**For detailed status of what's implemented vs pending, see:**
- `PROJECT_STATUS_VS_DOC.md`
- `USER_STORY_STATUS.md`
- `IMPLEMENTATION_STATUS.md`
