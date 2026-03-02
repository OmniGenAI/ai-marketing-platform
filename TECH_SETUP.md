# AI Marketing Platform - Technical Setup Document

## Project Vision

An AI-powered social media marketing platform for small businesses. Users subscribe to a plan, configure their business profile once, and use AI to generate, review, and publish social media posts directly to platforms like Facebook and Instagram.

**Core Flow:** Register → Subscribe → Configure Business → Generate Posts → Review/Edit → Publish

---

## Tech Stack

| Layer | Technology | Version | Justification |
|-------|-----------|---------|---------------|
| Frontend | Next.js (App Router) | 15.x | SSR, file-based routing, React ecosystem, great DX |
| Language (FE) | TypeScript | 5.x | Type safety, better developer experience |
| UI Framework | Tailwind CSS | 4.x | Utility-first CSS, rapid styling |
| UI Components | shadcn/ui | latest | Accessible, customizable, copy-paste components |
| Backend | Python FastAPI | 0.115.x | Async, auto OpenAPI docs, fast, great for AI workloads |
| ORM | SQLAlchemy | 2.x | Mature Python ORM, async support, robust ecosystem |
| Migrations | Alembic | 1.x | Reliable schema migrations for SQLAlchemy |
| Database | PostgreSQL | 16.x | Relational data, ACID compliance, JSON support |
| Auth | JWT (via python-jose) | - | Stateless auth, FastAPI issues tokens, frontend stores them |
| AI | Google Gemini API | free tier | 15 RPM, 1M tokens/min free, high quality generation |
| Payments | Stripe | latest | Industry standard subscriptions, webhooks, test mode |
| Package Manager | npm (frontend) / pip (backend) | - | Standard tooling for each ecosystem |

---

## Architecture

```
┌─────────────────┐         ┌─────────────────┐         ┌──────────────┐
│   Next.js App   │  HTTP   │  FastAPI Server  │   SQL   │  PostgreSQL  │
│   (Port 3000)   │ ──────> │   (Port 8080)    │ ──────> │   Database   │
│                 │  JSON   │                  │         │              │
│  - Pages/UI     │ <────── │  - API Routes    │ <────── │  - Users     │
│  - Components   │   JWT   │  - Auth (JWT)    │         │  - Plans     │
│  - Auth State   │         │  - AI Service    │         │  - Posts     │
│                 │         │  - Stripe        │         │  - Wallet    │
└─────────────────┘         └─────────────────┘         └──────────────┘
                                    │
                        ┌───────────┼───────────┐
                        ▼           ▼           ▼
                   ┌─────────┐ ┌─────────┐ ┌─────────┐
                   │ Google  │ │ Stripe  │ │Facebook │
                   │ Gemini  │ │   API   │ │Instagram│
                   │  (AI)   │ │(Payment)│ │  APIs   │
                   └─────────┘ └─────────┘ └─────────┘
```

---

## Monorepo Folder Structure

```
ai-marketing-platform/
├── frontend/                       # Next.js application
│   ├── public/
│   ├── src/
│   │   ├── app/
│   │   │   ├── (auth)/             # Auth route group (no sidebar)
│   │   │   │   ├── login/
│   │   │   │   │   └── page.tsx
│   │   │   │   └── register/
│   │   │   │       └── page.tsx
│   │   │   ├── (dashboard)/        # Dashboard route group (with sidebar)
│   │   │   │   ├── layout.tsx
│   │   │   │   ├── dashboard/
│   │   │   │   │   └── page.tsx
│   │   │   │   ├── business-config/
│   │   │   │   │   └── page.tsx
│   │   │   │   ├── generate/
│   │   │   │   │   └── page.tsx
│   │   │   │   ├── posts/
│   │   │   │   │   └── page.tsx
│   │   │   │   ├── subscription/
│   │   │   │   │   └── page.tsx
│   │   │   │   └── settings/
│   │   │   │       └── page.tsx
│   │   │   ├── layout.tsx          # Root layout (providers, fonts)
│   │   │   └── page.tsx            # Landing page
│   │   ├── components/
│   │   │   ├── ui/                 # shadcn/ui components
│   │   │   ├── layout/             # Navbar, Sidebar, Footer
│   │   │   └── features/           # Feature-specific components
│   │   ├── lib/
│   │   │   ├── api.ts              # Axios instance with JWT interceptor
│   │   │   └── utils.ts            # Utility helpers (cn, etc.)
│   │   ├── hooks/
│   │   │   └── use-auth.ts         # Auth context and hooks
│   │   ├── types/
│   │   │   └── index.ts            # Shared TypeScript types
│   │   └── middleware.ts           # Route protection middleware
│   ├── .env.example
│   ├── package.json
│   ├── tsconfig.json
│   ├── next.config.ts
│   └── tailwind.config.ts
│
├── backend/                        # FastAPI application
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                 # FastAPI app entry point, CORS, routers
│   │   ├── config.py               # Settings from environment variables
│   │   ├── database.py             # SQLAlchemy engine & session maker
│   │   ├── dependencies.py         # Dependency injection (get_db, get_current_user)
│   │   ├── models/                 # SQLAlchemy ORM models
│   │   │   ├── __init__.py
│   │   │   ├── user.py
│   │   │   ├── plan.py
│   │   │   ├── subscription.py
│   │   │   ├── wallet.py
│   │   │   ├── business_config.py
│   │   │   ├── post.py
│   │   │   └── social_account.py
│   │   ├── schemas/                # Pydantic request/response schemas
│   │   │   ├── __init__.py
│   │   │   ├── user.py
│   │   │   ├── plan.py
│   │   │   ├── subscription.py
│   │   │   ├── wallet.py
│   │   │   ├── business_config.py
│   │   │   └── post.py
│   │   ├── routers/                # API route handlers
│   │   │   ├── __init__.py
│   │   │   ├── auth.py
│   │   │   ├── plans.py
│   │   │   ├── subscription.py
│   │   │   ├── wallet.py
│   │   │   ├── business_config.py
│   │   │   ├── generate.py
│   │   │   ├── posts.py
│   │   │   └── webhooks.py
│   │   └── services/               # Business logic layer
│   │       ├── __init__.py
│   │       ├── auth.py
│   │       ├── ai.py
│   │       ├── stripe_service.py
│   │       └── social.py
│   ├── alembic/                    # Database migrations
│   ├── alembic.ini
│   ├── requirements.txt
│   ├── .env.example
│   └── Dockerfile
│
├── TECH_SETUP.md                   # This document
├── .gitignore
└── README.md
```

---

## Database Schema

### Users
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| name | VARCHAR(255) | |
| email | VARCHAR(255) | Unique |
| hashed_password | VARCHAR(255) | bcrypt hashed |
| is_active | BOOLEAN | Default true |
| role | VARCHAR(50) | "user" or "admin" |
| created_at | TIMESTAMP | Auto |
| updated_at | TIMESTAMP | Auto |

### Plans
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| name | VARCHAR(100) | e.g., "Free", "Starter", "Pro" |
| slug | VARCHAR(100) | Unique, URL-friendly |
| description | TEXT | |
| price | DECIMAL(10,2) | Monthly price |
| credits | INTEGER | Credits per month |
| features | JSON | Feature flags |
| is_active | BOOLEAN | Default true |
| created_at | TIMESTAMP | Auto |

### Subscriptions
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| user_id | UUID | FK → Users |
| plan_id | UUID | FK → Plans |
| stripe_subscription_id | VARCHAR(255) | Nullable |
| status | VARCHAR(50) | active/canceled/past_due/trialing |
| current_period_start | TIMESTAMP | |
| current_period_end | TIMESTAMP | |
| created_at | TIMESTAMP | Auto |

### Wallets
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| user_id | UUID | FK → Users, Unique |
| balance | INTEGER | Current credits |
| total_credits_used | INTEGER | Lifetime usage |

### Usage Logs
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| wallet_id | UUID | FK → Wallets |
| action | VARCHAR(100) | e.g., "generate_post", "regenerate" |
| credits_used | INTEGER | |
| description | TEXT | |
| created_at | TIMESTAMP | Auto |

### Business Configs
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| user_id | UUID | FK → Users, Unique |
| business_name | VARCHAR(255) | |
| niche | VARCHAR(255) | |
| tone | VARCHAR(100) | formal/friendly/witty/professional |
| products | TEXT | Products or services description |
| brand_voice | TEXT | How the brand speaks |
| hashtags | TEXT | Preferred hashtags |
| target_audience | TEXT | |
| platform_preference | VARCHAR(100) | facebook/instagram/both |
| created_at | TIMESTAMP | Auto |
| updated_at | TIMESTAMP | Auto |

### Posts
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| user_id | UUID | FK → Users |
| content | TEXT | Post content |
| hashtags | TEXT | Generated hashtags |
| platform | VARCHAR(50) | facebook/instagram |
| tone | VARCHAR(50) | Tone used for generation |
| status | VARCHAR(50) | draft/published/failed |
| published_at | TIMESTAMP | Nullable |
| created_at | TIMESTAMP | Auto |
| updated_at | TIMESTAMP | Auto |

### Social Accounts
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| user_id | UUID | FK → Users |
| platform | VARCHAR(50) | facebook/instagram |
| access_token | TEXT | Encrypted |
| refresh_token | TEXT | Encrypted, nullable |
| page_id | VARCHAR(255) | Platform page ID |
| page_name | VARCHAR(255) | |
| created_at | TIMESTAMP | Auto |

---

## API Endpoints

### Authentication
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/auth/register` | Register new user | No |
| POST | `/api/auth/login` | Login, returns JWT | No |
| GET | `/api/auth/me` | Get current user profile | Yes |

### Plans
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/plans` | List all active plans | No |

### Subscription
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/subscription/checkout` | Create Stripe checkout session | Yes |
| GET | `/api/subscription/status` | Get current subscription | Yes |

### Wallet
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/wallet` | Get wallet balance | Yes |
| GET | `/api/wallet/usage` | Get usage history | Yes |

### Business Config
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/business-config` | Create or update config | Yes |
| GET | `/api/business-config` | Get current config | Yes |

### AI Generation
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/generate` | Generate AI post (deducts credit) | Yes |

### Posts
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/posts` | List user's posts | Yes |
| PATCH | `/api/posts/{id}` | Update post content/status | Yes |
| DELETE | `/api/posts/{id}` | Delete a post | Yes |

### Webhooks
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/webhooks/stripe` | Stripe webhook handler | Stripe signature |

---

## Authentication Flow

```
1. User registers → POST /api/auth/register
   - Backend hashes password (bcrypt)
   - Creates User + Wallet (0 balance)
   - Returns success

2. User logs in → POST /api/auth/login
   - Backend verifies credentials
   - Issues JWT token (expires in 24h)
   - Returns { access_token, token_type }

3. Frontend stores JWT in cookie (httpOnly if possible, or js-cookie)

4. All authenticated requests include:
   Authorization: Bearer <token>

5. Backend middleware decodes JWT → gets user_id → loads user from DB
```

---

## Environment Variables

### Backend (`backend/.env.example`)
```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5433/ai_marketing

# JWT
JWT_SECRET=your-super-secret-key-change-this
JWT_ALGORITHM=HS256
JWT_EXPIRATION_MINUTES=1440

# Google Gemini AI
GOOGLE_GEMINI_API_KEY=your-gemini-api-key

# Stripe
STRIPE_SECRET_KEY=sk_test_your-stripe-secret
STRIPE_WEBHOOK_SECRET=whsec_your-webhook-secret

# CORS
FRONTEND_URL=http://localhost:3000
```

### Frontend (`frontend/.env.example`)
```env
# API
NEXT_PUBLIC_API_URL=http://localhost:8080

# Stripe (publishable key - safe for client)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_your-stripe-publishable
```

---

## Deployment Strategy

| Service | Platform | Tier |
|---------|----------|------|
| Frontend (Next.js) | Vercel | Free / Pro |
| Backend (FastAPI) | Render or Railway | Free / Starter |
| Database (PostgreSQL) | Render / Supabase / Railway | Free tier available |

**Monorepo deployment:**
- Vercel auto-detects `frontend/` as root directory
- Render/Railway auto-detects `backend/` with Dockerfile or start command
- Both services communicate via HTTPS API URLs (env variables)

---

## Development Workflow

### Prerequisites
- Node.js 18+ and npm
- Python 3.11+
- PostgreSQL 16 (local or Docker)
- Git

### Getting Started

```bash
# Clone the repo
git clone https://github.com/OmniGenAI/ai-marketing-platform.git
cd ai-marketing-platform

# --- Backend ---
cd backend
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env              # Edit with your values
alembic upgrade head              # Run migrations
uvicorn app.main:app --port 8080 --reload     # Starts on http://localhost:8080

# --- Frontend ---
cd ../frontend
npm install
cp .env.example .env.local        # Edit with your values
npm run dev                        # Starts on http://localhost:3000
```

### API Documentation
Once backend is running, visit:
- Swagger UI: `http://localhost:8080/docs`
- ReDoc: `http://localhost:8080/redoc`
