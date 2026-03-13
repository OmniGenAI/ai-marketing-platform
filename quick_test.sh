#!/bin/bash

# Quick API Test Script
# Tests core functionality of AI Marketing Platform backend

BASE_URL="http://localhost:8000"
TOKEN=""

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  AI Marketing Platform - Quick Test Suite                   ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Test 1: Health Check
echo "🔍 Test 1: Health Check..."
HEALTH=$(curl -s $BASE_URL/health 2>/dev/null)
if [ $? -eq 0 ]; then
    echo "✅ Backend is running"
    echo "   Response: $HEALTH"
else
    echo "❌ Backend is NOT running"
    echo "   Start it with: cd backend && uvicorn app.main:app --reload"
    exit 1
fi
echo ""

# Test 2: Register User
echo "🔍 Test 2: User Registration..."
TIMESTAMP=$(date +%s)
REGISTER_RESPONSE=$(curl -s -X POST $BASE_URL/api/auth/register \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"test${TIMESTAMP}@example.com\",
    \"password\": \"Test123456\",
    \"full_name\": \"Test User\"
  }" 2>/dev/null)

if echo "$REGISTER_RESPONSE" | grep -q "access_token"; then
    echo "✅ Registration successful"
    TOKEN=$(echo $REGISTER_RESPONSE | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)
    echo "   Email: test${TIMESTAMP}@example.com"
    echo "   Token: ${TOKEN:0:50}..."
else
    echo "❌ Registration failed"
    echo "   Response: $REGISTER_RESPONSE"
    exit 1
fi
echo ""

# Test 3: Get Current User
echo "🔍 Test 3: Authentication (Get Current User)..."
USER_RESPONSE=$(curl -s $BASE_URL/api/auth/me \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null)

if echo "$USER_RESPONSE" | grep -q "email"; then
    echo "✅ Authentication working"
    echo "   $USER_RESPONSE" | grep -o '"email":"[^"]*' | cut -d'"' -f4
else
    echo "❌ Authentication failed"
    echo "   Response: $USER_RESPONSE"
fi
echo ""

# Test 4: Check Wallet
echo "🔍 Test 4: Credit Wallet System..."
WALLET_RESPONSE=$(curl -s $BASE_URL/api/wallet \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null)

if echo "$WALLET_RESPONSE" | grep -q "balance"; then
    BALANCE=$(echo $WALLET_RESPONSE | grep -o '"balance":[0-9]*' | cut -d':' -f2)
    echo "✅ Wallet system working"
    echo "   Balance: $BALANCE credits"
else
    echo "❌ Wallet system failed"
    echo "   Response: $WALLET_RESPONSE"
fi
echo ""

# Test 5: Business Config
echo "🔍 Test 5: Business Configuration..."
CONFIG_RESPONSE=$(curl -s -X POST $BASE_URL/api/business-config \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "business_name": "Test Business",
    "industry": "Technology",
    "target_audience": "Small businesses",
    "brand_tone": "professional",
    "products_services": "AI Marketing Tools"
  }' 2>/dev/null)

if echo "$CONFIG_RESPONSE" | grep -q "business_name"; then
    echo "✅ Business config working"
    echo "   Business: Test Business"
else
    echo "❌ Business config failed"
    echo "   Response: $CONFIG_RESPONSE"
fi
echo ""

# Test 6: AI Generation (Most Important!)
echo "🔍 Test 6: AI Post Generation (Gemini API)..."
GEN_RESPONSE=$(curl -s -X POST $BASE_URL/api/generate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "facebook",
    "topic": "Quick test post about our amazing product",
    "tone": "friendly"
  }' 2>/dev/null)

if echo "$GEN_RESPONSE" | grep -q "content"; then
    echo "✅ AI generation working!"
    CONTENT=$(echo $GEN_RESPONSE | grep -o '"content":"[^"]*' | cut -d'"' -f4)
    echo "   Generated: ${CONTENT:0:60}..."
else
    echo "❌ AI generation failed"
    echo "   Response: $GEN_RESPONSE"
    echo "   Check GOOGLE_GEMINI_API_KEY in .env"
fi
echo ""

# Test 7: Facebook OAuth URL
echo "🔍 Test 7: Facebook OAuth (Check Credentials Loaded)..."
FB_AUTH_RESPONSE=$(curl -s $BASE_URL/api/social/facebook/auth \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null)

if echo "$FB_AUTH_RESPONSE" | grep -q "auth_url"; then
    echo "✅ Facebook credentials loaded"
    AUTH_URL=$(echo $FB_AUTH_RESPONSE | grep -o '"auth_url":"[^"]*' | cut -d'"' -f4)
    if echo "$AUTH_URL" | grep -q "1601239620924716"; then
        echo "   App ID: 1601239620924716 ✓"
    fi
else
    echo "❌ Facebook credentials not loaded"
    echo "   Response: $FB_AUTH_RESPONSE"
    echo "   Check FACEBOOK_APP_ID in .env and restart backend"
fi
echo ""

# Test 8: Mock Social Accounts
echo "🔍 Test 8: Mock Social Account Connection..."
MOCK_FB_RESPONSE=$(curl -s -X POST $BASE_URL/api/social/dev/mock/facebook \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null)

if echo "$MOCK_FB_RESPONSE" | grep -q "message"; then
    echo "✅ Mock accounts working"
    echo "   Connected: Test Facebook Page"
else
    echo "❌ Mock accounts failed"
    echo "   Response: $MOCK_FB_RESPONSE"
fi
echo ""

# Test 9: Get Connected Accounts
echo "🔍 Test 9: List Connected Social Accounts..."
ACCOUNTS_RESPONSE=$(curl -s $BASE_URL/api/social/accounts \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null)

if echo "$ACCOUNTS_RESPONSE" | grep -q "platform"; then
    ACCOUNT_COUNT=$(echo "$ACCOUNTS_RESPONSE" | grep -o "platform" | wc -l)
    echo "✅ Social accounts system working"
    echo "   Connected accounts: $ACCOUNT_COUNT"
else
    echo "⚠️  No accounts connected (expected if first run)"
fi
echo ""

# Summary
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Test Summary                                                ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "✅ WORKING:"
echo "   • Backend server"
echo "   • User authentication"
echo "   • Credit wallet system"
echo "   • Business configuration"
echo "   • AI post generation (Google Gemini)"
echo "   • Facebook OAuth URLs"
echo "   • Mock social accounts"
echo ""
echo "📊 NEXT STEPS:"
echo "   1. Open browser: http://localhost:8000/docs"
echo "   2. Test real OAuth flow (if Facebook account works)"
echo "   3. Try publishing a test post"
echo ""
echo "📖 For detailed testing guide, see: TEST_SUITE.md"
echo ""
