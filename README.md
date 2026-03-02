# AI Marketing Platform

AI-powered social media marketing platform for small businesses. Configure your brand once, generate engaging posts with AI, and publish directly to Facebook & Instagram.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, TypeScript, Tailwind CSS, shadcn/ui |
| Backend | Python FastAPI, SQLAlchemy, Alembic |
| Database | PostgreSQL 16 |
| AI | Google Gemini 2.0 Flash (free tier) |
| Payments | Stripe |
| Auth | JWT (issued by FastAPI) |

## Project Structure

```
ai-marketing-platform/
├── frontend/          # Next.js application (port 3000)
├── backend/           # FastAPI application (port 8080)
├── docker-compose.yml # PostgreSQL database (port 5433)
└── TECH_SETUP.md      # Detailed architecture docs
```

## Prerequisites

- Node.js 18+
- Python 3.11+
- Docker

## Getting Started

### 1. Start the database

```bash
docker compose up -d
```

### 2. Start the backend

```bash
cd backend
python -m venv venv

# Windows
venv\Scripts\activate

# macOS/Linux
source venv/bin/activate

pip install -r requirements.txt
cp .env.example .env     # Edit with your API keys
alembic upgrade head     # Run database migrations
uvicorn app.main:app --port 8080 --reload
```

Backend runs at http://localhost:8080
Swagger docs at http://localhost:8080/docs

### 3. Start the frontend

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

Frontend runs at http://localhost:3000

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/register | Register a new user |
| POST | /api/auth/login | Login, returns JWT |
| GET | /api/auth/me | Get current user |
| GET | /api/plans | List subscription plans |
| POST | /api/subscription/checkout | Create Stripe checkout |
| GET | /api/subscription/status | Get subscription status |
| GET | /api/wallet | Get credit balance |
| GET | /api/wallet/usage | Get usage history |
| POST | /api/business-config | Create/update business config |
| GET | /api/business-config | Get business config |
| POST | /api/generate | Generate AI post (costs 1 credit) |
| GET | /api/posts | List posts |
| PATCH | /api/posts/{id} | Update a post |
| DELETE | /api/posts/{id} | Delete a post |
| POST | /api/webhooks/stripe | Stripe webhook |

## Environment Variables

### Backend (`backend/.env`)

```env
DATABASE_URL=postgresql://ai_marketing:ai_marketing_pass@localhost:5433/ai_marketing
JWT_SECRET=your-secret-key
GOOGLE_GEMINI_API_KEY=your-gemini-key
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
FRONTEND_URL=http://localhost:3000
```

### Frontend (`frontend/.env.local`)

```env
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

## Features

- **Auth** - Register, login, JWT-based session management
- **Business Config** - One-time brand setup (name, niche, tone, products, audience)
- **AI Generation** - Generate social media posts using Google Gemini
- **Credit System** - Wallet-based credits, 10 free on signup
- **Post Management** - Save drafts, edit, delete generated posts
- **Subscription Plans** - Free / Starter / Pro tiers via Stripe
- **Dashboard** - Overview of credits, posts, and quick actions

## License

Private - OmniGenAI
