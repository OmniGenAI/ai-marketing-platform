# 🚨 IMMEDIATE SETUP STEPS

## YOU ARE HERE: Database user doesn't exist

### Step 1: Create Database User in DBeaver (DO THIS FIRST!)

1. Open DBeaver (you already have it open)
2. In left panel, find `ai_marketing` database
3. Right-click on `ai_marketing`
4. Select: **SQL Editor** → **New SQL Script**
5. Paste this SQL:

```sql
CREATE USER ai_marketing WITH PASSWORD 'ai_marketing_pass';
GRANT ALL PRIVILEGES ON DATABASE ai_marketing TO ai_marketing;
GRANT ALL ON SCHEMA public TO ai_marketing;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ai_marketing;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ai_marketing;
SELECT usename FROM pg_user WHERE usename = 'ai_marketing';
```

6. Click Execute button (orange play button) or Ctrl+Enter
7. You should see: `ai_marketing` in the results

---

### Step 2: Run Migrations (After Step 1 succeeds)

```bash
cd /Users/mac/Desktop/omnigenai/ai-marketing-platform/backend
source venv/bin/activate
alembic upgrade head
```

Expected output:
```
INFO  [alembic.runtime.migration] Running upgrade  -> 51f6e397c108, initial_schema
```

---

### Step 3: Verify Tables Created

In DBeaver:
1. Right-click on `ai_marketing` database
2. Click **Refresh**
3. Expand **Schemas** → **public** → **Tables**
4. You should see 8 tables:
   - users
   - wallets
   - plans
   - subscriptions
   - business_configs
   - posts
   - social_accounts
   - usage_logs

---

### Step 4: Restart Backend Server

```bash
# Stop current server (Ctrl+C in the terminal where it's running)
# Then restart:
uvicorn app.main:app --reload
```

---

### Step 5: Test Signup

1. Go to http://localhost:8000/docs
2. Click on **POST /api/auth/register**
3. Click "Try it out"
4. Use this test data:
```json
{
  "name": "Test User",
  "email": "test@example.com",
  "password": "test123"
}
```
5. Click Execute
6. Should return **201** with user data ✅

---

## Common Issues:

### "User already exists" error in DBeaver
- That's OK! It means the user was created previously
- Skip to Step 2 (migrations)

### Migrations still fail
- Make sure you executed the SQL in DBeaver successfully
- Check that you see "ai_marketing" in the user list query result
- Try restarting the backend server

### Still getting 500 error
- Check .env file exists in backend folder
- Verify DATABASE_URL is: `postgresql://ai_marketing:ai_marketing_pass@localhost:5432/ai_marketing`
- Make sure port is 5432 (not 5433)
