# AI Marketing Platform - Setup Instructions

## Current Status
- ✓ .env file created
- ✓ PostgreSQL is running on port 5432
- ✗ Database user and database need to be created
- ✗ Database migrations need to be run

## Step 1: Create Database User and Database

### Option A: Using psql command line
```bash
# Connect to PostgreSQL (you'll be prompted for postgres password)
psql -U postgres

# Then run these SQL commands:
CREATE USER ai_marketing WITH PASSWORD 'ai_marketing_pass';
CREATE DATABASE ai_marketing OWNER ai_marketing;
GRANT ALL PRIVILEGES ON DATABASE ai_marketing TO ai_marketing;
\q
```

### Option B: Using pgAdmin
1. Open pgAdmin
2. Right-click on "Login/Group Roles" → Create → Login/Group Role
   - Name: `ai_marketing`
   - Password: `ai_marketing_pass`
   - Privileges: Can login
3. Right-click on "Databases" → Create → Database
   - Database: `ai_marketing`
   - Owner: `ai_marketing`

## Step 2: Run Database Migrations

After creating the database, run:
```bash
cd /Users/mac/Desktop/omnigenai/ai-marketing-platform/backend
source venv/bin/activate
alembic upgrade head
```

## Step 3: Restart the Backend Server

If the server is running, restart it:
```bash
# Stop the current server (Ctrl+C)
# Then start it again:
uvicorn app.main:app --reload
```

## Step 4: Test the API

Try the register endpoint again at:
`http://localhost:8000/api/auth/register`

## Verification

Run this to verify everything is set up correctly:
```bash
python test_db.py
```

## Environment Variables (.env)

Your current configuration:
```
DATABASE_URL=postgresql://ai_marketing:ai_marketing_pass@localhost:5432/ai_marketing
JWT_SECRET=your-super-secret-key-change-this-in-production-12345
FRONTEND_URL=http://localhost:3000
```

⚠️ **Note:** Remember to add your API keys for:
- `GOOGLE_GEMINI_API_KEY` - for AI content generation
- `STRIPE_SECRET_KEY` - for payments (if using Stripe)
