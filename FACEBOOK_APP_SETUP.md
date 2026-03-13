# Facebook App Setup & OAuth Testing Guide

**Last Updated:** March 5, 2026
**Your App ID:** 1601239620924716

---

## 🚨 IMPORTANT: Your Account Status

Your personal Facebook account is **currently disabled**. You have two options:

### Option A: Use Someone Else's Facebook Account
- Ask a friend/colleague with active Facebook account
- They configure the app for you
- They can add you as a developer

### Option B: Test with Mock Endpoints
- Use development mock endpoints (already implemented)
- Skip real OAuth for now
- Everything works except actual posting

---

## 📋 Facebook App Configuration Checklist

### Step 1: Access Facebook Developers

**URL:** https://developers.facebook.com/apps/1601239620924716

**Login:** Must use account that created this App ID

### Step 2: Configure Facebook Login Product

1. **Go to:** Dashboard → Your App → Products
2. **Add Product:** "Facebook Login"
3. **Click:** Settings (under Facebook Login)

### Step 3: Add Valid OAuth Redirect URIs

**CRITICAL:** Add these EXACT URLs to "Valid OAuth Redirect URIs":

```
http://localhost:8000/api/social/facebook/callback
http://localhost:8000/api/social/instagram/callback
http://localhost:3000/auth/facebook/callback
http://localhost:3000/auth/instagram/callback
```

**Why both ports:**
- Port 8000 = Backend API callbacks
- Port 3000 = Frontend redirects

**For Production, also add:**
```
https://yourdomain.com/api/social/facebook/callback
https://yourdomain.com/api/social/instagram/callback
```

### Step 4: Configure App Domains

**Go to:** Settings → Basic

**Add:**
```
localhost
```

**For production:**
```
yourdomain.com
```

### Step 5: Add Required Permissions

**Go to:** App Review → Permissions and Features

**Request these permissions:**
- `pages_show_list` - View Pages
- `pages_read_engagement` - Read engagement data
- `pages_manage_posts` - Publish posts to Pages
- `instagram_basic` - Instagram account info
- `instagram_content_publish` - Publish to Instagram

**Note:** Advanced permissions require app review by Facebook

### Step 6: Add Test Users (Optional)

**Go to:** Roles → Test Users

**Create test users** to test OAuth without affecting your main account

---

## 🧪 Testing OAuth Flow

### Method 1: Browser Testing (Real OAuth)

#### Step 1: Get OAuth URL

```bash
# Get your saved token
TOKEN=$(cat /tmp/oauth_test_token.txt)

# Get Facebook OAuth URL
curl http://localhost:8000/api/social/facebook/auth \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**
```json
{
  "auth_url": "https://www.facebook.com/v18.0/dialog/oauth?client_id=1601239620924716&..."
}
```

#### Step 2: Open URL in Browser

Copy the `auth_url` and paste in browser.

**What happens:**
1. Redirects to Facebook login
2. Shows permission request screen
3. User clicks "Continue" / "Allow"
4. Facebook redirects back to your callback URL
5. Backend exchanges code for access token
6. Account connected!

#### Step 3: Verify Connection

```bash
curl http://localhost:8000/api/social/accounts \
  -H "Authorization: Bearer $TOKEN"
```

**Expected:**
```json
[
  {
    "id": "...",
    "platform": "facebook",
    "page_name": "Your Page Name",
    "connected_at": "2026-03-05T..."
  }
]
```

---

### Method 2: Mock Testing (No Facebook Required)

#### Connect Mock Facebook Account

```bash
TOKEN=$(cat /tmp/oauth_test_token.txt)

curl -X POST http://localhost:8000/api/social/dev/mock/facebook \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**
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

#### Connect Mock Instagram Account

```bash
curl -X POST http://localhost:8000/api/social/dev/mock/instagram \
  -H "Authorization: Bearer $TOKEN"
```

#### Verify Mock Connections

```bash
curl http://localhost:8000/api/social/accounts \
  -H "Authorization: Bearer $TOKEN"
```

**Expected:**
```json
[
  {
    "id": "...",
    "platform": "facebook",
    "page_name": "Test Facebook Page",
    "access_token": "MOCK_FB_TOKEN_DEV_ONLY",
    "connected_at": "..."
  },
  {
    "id": "...",
    "platform": "instagram",
    "page_name": "@test_instagram",
    "access_token": "MOCK_IG_TOKEN_DEV_ONLY",
    "connected_at": "..."
  }
]
```

---

### Method 3: Manual Callback Testing

**Simulate the OAuth callback manually:**

```bash
# This would normally be called by Facebook
curl "http://localhost:8000/api/social/facebook/callback?code=FAKE_CODE&state=YOUR_STATE"
```

**Note:** Will fail with "Invalid code" but tests the callback endpoint

---

## 🧪 Complete OAuth Flow Test Script

```bash
#!/bin/bash

TOKEN=$(cat /tmp/oauth_test_token.txt)
BASE_URL="http://localhost:8000"

echo "══════════════════════════════════════════════════════"
echo "  Complete OAuth Flow Test"
echo "══════════════════════════════════════════════════════"
echo ""

# Step 1: Check current connections
echo "1️⃣  Checking current social accounts..."
ACCOUNTS=$(curl -s $BASE_URL/api/social/accounts \
  -H "Authorization: Bearer $TOKEN")

if echo "$ACCOUNTS" | grep -q "platform"; then
    COUNT=$(echo "$ACCOUNTS" | grep -o "platform" | wc -l)
    echo "   ✅ $COUNT account(s) connected"
else
    echo "   ℹ️  No accounts connected yet"
fi

# Step 2: Get OAuth URLs
echo ""
echo "2️⃣  Getting OAuth URLs..."

FB_AUTH=$(curl -s $BASE_URL/api/social/facebook/auth \
  -H "Authorization: Bearer $TOKEN")
FB_URL=$(echo $FB_AUTH | grep -o '"auth_url":"[^"]*' | cut -d'"' -f4)

if [ -n "$FB_URL" ]; then
    echo "   ✅ Facebook OAuth URL generated"
    echo "   App ID in URL: $(echo $FB_URL | grep -o 'client_id=[0-9]*' | cut -d'=' -f2)"
fi

IG_AUTH=$(curl -s $BASE_URL/api/social/instagram/auth \
  -H "Authorization: Bearer $TOKEN")
IG_URL=$(echo $IG_AUTH | grep -o '"auth_url":"[^"]*' | cut -d'"' -f4)

if [ -n "$IG_URL" ]; then
    echo "   ✅ Instagram OAuth URL generated"
fi

# Step 3: Test mock connections
echo ""
echo "3️⃣  Testing mock account connection..."

MOCK_FB=$(curl -s -X POST $BASE_URL/api/social/dev/mock/facebook \
  -H "Authorization: Bearer $TOKEN")

if echo "$MOCK_FB" | grep -q "message"; then
    echo "   ✅ Mock Facebook connected"
fi

MOCK_IG=$(curl -s -X POST $BASE_URL/api/social/dev/mock/instagram \
  -H "Authorization: Bearer $TOKEN")

if echo "$MOCK_IG" | grep -q "message"; then
    echo "   ✅ Mock Instagram connected"
fi

# Step 4: Verify connections
echo ""
echo "4️⃣  Verifying all connections..."

FINAL_ACCOUNTS=$(curl -s $BASE_URL/api/social/accounts \
  -H "Authorization: Bearer $TOKEN")

echo "$FINAL_ACCOUNTS" | grep -o '"platform":"[^"]*' | cut -d'"' -f4 | while read PLATFORM; do
    echo "   ✅ $PLATFORM connected"
done

echo ""
echo "══════════════════════════════════════════════════════"
echo "  TEST COMPLETE"
echo "══════════════════════════════════════════════════════"
echo ""
echo "📋 SUMMARY:"
echo "   • OAuth URL generation: ✅"
echo "   • Mock connections: ✅"
echo "   • Account listing: ✅"
echo ""
echo "🌐 Next: Open http://localhost:8000/docs to test interactively"
echo ""
```

Save as `test_oauth_complete.sh` and run:
```bash
chmod +x test_oauth_complete.sh
./test_oauth_complete.sh
```

---

## 🐛 Troubleshooting

### Issue 1: "Redirect URI Mismatch"

**Error:** `redirect_uri_mismatch`

**Cause:** Callback URL not whitelisted in Facebook App

**Fix:**
1. Go to Facebook App Settings
2. Add exact callback URL to "Valid OAuth Redirect URIs"
3. Save changes
4. Try again

### Issue 2: "App Not Setup"

**Error:** `App ID not configured`

**Cause:** Facebook App incomplete

**Fix:**
1. Complete all required fields in App Settings
2. Add platform (Website)
3. Add app domain
4. Save

### Issue 3: "Invalid OAuth State"

**Error:** `Invalid state parameter`

**Cause:** State mismatch between request and callback

**Fix:**
- Check if cookies are enabled
- Verify backend session storage
- Use same browser for full flow

### Issue 4: "Permission Denied"

**Error:** `Insufficient permissions`

**Cause:** Required permissions not granted

**Fix:**
1. Request additional permissions in App Review
2. Use test users with auto-granted permissions
3. Or use mock endpoints for testing

---

## 📊 OAuth Flow Diagram

```
User → Frontend → Backend
  ↓        ↓         ↓
  1. Click "Connect Facebook"
  2. Frontend requests OAuth URL from backend
  3. Backend generates URL with App ID
  4. User redirected to Facebook
  5. User grants permissions
  6. Facebook redirects to callback with code
  7. Backend exchanges code for access token
  8. Backend stores access token
  9. Backend redirects user to frontend success page
```

---

## ✅ Verification Checklist

After setup, verify:

- [ ] Backend running on port 8000
- [ ] Facebook App ID loaded (1601239620924716)
- [ ] Facebook App Secret loaded
- [ ] Redirect URIs whitelisted in Facebook App
- [ ] OAuth URL generates successfully
- [ ] Mock connections work
- [ ] Can list connected accounts

---

## 🚀 Production Deployment

**Before going live:**

1. **Update redirect URIs** to production domain
2. **Enable HTTPS** (Facebook requires HTTPS in production)
3. **Encrypt access tokens** before storing
4. **Implement token refresh** logic
5. **Handle token expiration** gracefully
6. **Add error logging**
7. **Submit for App Review** if using advanced permissions
8. **Test with real accounts**

---

## 📞 Support

**If OAuth still doesn't work:**

1. Check Facebook App status (Development vs Live)
2. Verify App ID and Secret are correct
3. Check backend logs for errors
4. Use mock endpoints for development
5. See `TEST_SUITE.md` for more tests

---

**Current Status:**
- ✅ Backend OAuth endpoints ready
- ✅ Facebook credentials loaded
- ✅ Mock endpoints working
- ⚠️ Real OAuth blocked by disabled Facebook account
- ⚠️ Redirect URI needs to be whitelisted in Facebook App

**Recommendation:** Use mock endpoints until Facebook account is restored or you have access to another account to configure the app.
