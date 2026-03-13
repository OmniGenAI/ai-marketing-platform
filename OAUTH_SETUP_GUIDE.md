# OAuth Setup Guide - Facebook & Instagram

## 📋 Overview

To allow users to publish posts to Facebook and Instagram, you need to create a Facebook App and configure OAuth.

---

## 🔧 Step 1: Create a Facebook App

### 1.1 Go to Facebook Developers
Visit: **https://developers.facebook.com/**

### 1.2 Create an App
1. Click **"My Apps"** → **"Create App"**
2. Select use case: **"Other"**
3. Select app type: **"Business"**
4. Fill in details:
   - **App Name:** AI Marketing Platform
   - **App Contact Email:** your-email@example.com
5. Click **"Create App"**

### 1.3 Add Facebook Login Product
1. In the left sidebar, click **"Add Product"**
2. Find **"Facebook Login"** and click **"Set Up"**
3. Select **"Web"** as platform
4. Enter Site URL: `http://localhost:3000`
5. Click **"Save"** then **"Continue"**

---

## 🔧 Step 2: Configure OAuth Settings

### 2.1 Facebook Login Settings
1. Go to **"Facebook Login"** → **"Settings"**
2. Add these **Valid OAuth Redirect URIs:**
   ```
   http://localhost:3000/auth/facebook/callback
   http://localhost:3000/auth/instagram/callback
   ```
3. Click **"Save Changes"**

### 2.2 Get App Credentials
1. Go to **"Settings"** → **"Basic"**
2. Copy:
   - **App ID**
   - **App Secret** (click "Show" to reveal)

---

## 🔧 Step 3: Add Permissions

### 3.1 Request Facebook Permissions
1. Go to **"App Review"** → **"Permissions and Features"**
2. Request these permissions:
   - `pages_show_list`
   - `pages_read_engagement`
   - `pages_manage_posts`
   - `instagram_basic`
   - `instagram_content_publish`

**Note:** Some permissions require app review for production. For development/testing, they work immediately.

---

## 🔧 Step 4: Update Backend Configuration

### 4.1 Update .env File

Open `/backend/.env` and add:

```bash
# Facebook OAuth
FACEBOOK_APP_ID=YOUR_APP_ID_HERE
FACEBOOK_APP_SECRET=YOUR_APP_SECRET_HERE
```

### 4.2 Update social_accounts.py

Open `/backend/app/routers/social_accounts.py` and update lines 14-15:

**Before:**
```python
FACEBOOK_APP_ID = "YOUR_FACEBOOK_APP_ID"  # TODO: Add to .env
FACEBOOK_APP_SECRET = "YOUR_FACEBOOK_APP_SECRET"  # TODO: Add to .env
```

**After:**
```python
FACEBOOK_APP_ID = settings.FACEBOOK_APP_ID
FACEBOOK_APP_SECRET = settings.FACEBOOK_APP_SECRET
```

### 4.3 Update config.py

Add Facebook credentials to `/backend/app/config.py`:

```python
class Settings(BaseSettings):
    # ... existing settings ...

    # Facebook OAuth (add these lines)
    FACEBOOK_APP_ID: str = ""
    FACEBOOK_APP_SECRET: str = ""
```

---

## 🔧 Step 5: Test OAuth Flow

### 5.1 Start Backend
```bash
cd backend
source venv/bin/activate
uvicorn app.main:app --reload
```

### 5.2 Test Facebook Connection
1. Go to: `http://localhost:3000/settings` (or wherever you have the connect button)
2. Click **"Connect Facebook"**
3. Should redirect to Facebook login
4. Authorize the app
5. Should redirect back with success message

### 5.3 Test Instagram Connection
1. **First, connect Instagram to a Facebook Page:**
   - Go to Facebook Page settings
   - Link your Instagram Business Account
2. Click **"Connect Instagram"** in your app
3. Authorize and select the page with Instagram

---

## 📝 Frontend Integration

### Required Frontend Pages

#### Settings Page (`/settings`)
```tsx
// Button to connect Facebook
<Button onClick={handleConnectFacebook}>
  Connect Facebook Account
</Button>

// Button to connect Instagram
<Button onClick={handleConnectInstagram}>
  Connect Instagram Account
</Button>

// List connected accounts
{accounts.map(account => (
  <div key={account.id}>
    {account.platform}: {account.page_name}
    <Button onClick={() => handleDisconnect(account.id)}>
      Disconnect
    </Button>
  </div>
))}
```

#### OAuth Handler Functions
```typescript
const handleConnectFacebook = async () => {
  const response = await api.get('/api/social/facebook/auth');
  window.location.href = response.data.auth_url;
};

const handleConnectInstagram = async () => {
  const response = await api.get('/api/social/instagram/auth');
  window.location.href = response.data.auth_url;
};

const handleDisconnect = async (accountId: string) => {
  await api.delete(`/api/social/accounts/${accountId}`);
  // Refresh account list
};
```

---

## 🚀 API Endpoints Available

### List Connected Accounts
```
GET /api/social/accounts
Authorization: Bearer {token}

Response:
[
  {
    "id": "uuid",
    "platform": "facebook",
    "page_name": "My Business Page",
    "page_id": "123456789",
    "connected_at": "2026-03-03T..."
  }
]
```

### Connect Facebook
```
GET /api/social/facebook/auth
Authorization: Bearer {token}

Response:
{
  "auth_url": "https://facebook.com/dialog/oauth?..."
}
```

### Connect Instagram
```
GET /api/social/instagram/auth
Authorization: Bearer {token}

Response:
{
  "auth_url": "https://facebook.com/dialog/oauth?..."
}
```

### Disconnect Account
```
DELETE /api/social/accounts/{account_id}
Authorization: Bearer {token}

Response:
{
  "message": "Facebook account disconnected successfully"
}
```

---

## ⚠️ Important Notes

### Development vs Production

**Development (localhost):**
- Works immediately with any Facebook account
- No app review needed
- Limited to developers/testers added to the app

**Production:**
- Requires App Review for advanced permissions
- Must submit for review with use case explanation
- Can take 3-7 days for approval

### Instagram Requirements

1. Must be an **Instagram Business Account**
2. Must be connected to a **Facebook Page**
3. Cannot use personal Instagram accounts

### Token Security

**Current Implementation:** Tokens are stored in plain text (not secure for production)

**For Production:** Encrypt tokens before storing:
```python
from cryptography.fernet import Fernet

# Generate key (store in .env)
ENCRYPTION_KEY = Fernet.generate_key()

# Encrypt before storing
cipher = Fernet(ENCRYPTION_KEY)
encrypted_token = cipher.encrypt(access_token.encode())

# Decrypt before using
decrypted_token = cipher.decrypt(encrypted_token).decode()
```

---

## 🐛 Troubleshooting

### "App Not Setup: This app is still in development mode"
- Add your Facebook account as a test user in App Roles

### "Redirect URI Mismatch"
- Check OAuth redirect URIs in Facebook Login settings
- Make sure URLs match exactly (including http/https)

### "No Instagram Account Found"
- Connect Instagram Business Account to Facebook Page first
- Use Instagram Business, not personal account

### "Invalid OAuth access token"
- Token might be expired (60 days by default)
- Implement token refresh logic for production

---

## ✅ Checklist

- [ ] Created Facebook App
- [ ] Added Facebook Login product
- [ ] Configured OAuth redirect URIs
- [ ] Requested permissions
- [ ] Added App ID & Secret to .env
- [ ] Updated config.py
- [ ] Updated social_accounts.py
- [ ] Restarted backend
- [ ] Created frontend Settings page
- [ ] Tested Facebook connection
- [ ] Tested Instagram connection
- [ ] Verified publishing works

---

## 🎯 Next Steps

After OAuth is working:
1. Test publishing to Facebook
2. Test publishing to Instagram
3. Implement token refresh logic
4. Add token encryption for production
5. Submit app for review (for production)

**Once this is complete, users can connect accounts and publish posts!** 🚀
