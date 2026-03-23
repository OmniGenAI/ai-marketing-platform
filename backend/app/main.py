from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import SessionLocal
from app.models.plan import Plan
from app.routers import auth, plans, subscription, wallet, business_config, generate, posts, webhooks, social_accounts, social_accounts_dev, business_images, upload


def seed_default_plans():
    """Seed default subscription plans if they don't exist"""
    if not SessionLocal:
        print("⚠️ Database not configured, skipping plan seeding")
        return

    db = SessionLocal()
    try:
        # Check if plans already exist
        existing = db.query(Plan).first()
        if existing:
            return

        default_plans = [
            Plan(
                name="Free",
                slug="free",
                description="Get started with basic features",
                price=0,
                credits=10,
                features={
                    "basic_tones": True,
                    "draft_saving": True,
                    "all_tones": False,
                    "facebook_publishing": False,
                    "instagram_publishing": False,
                    "priority_support": False,
                },
                is_active=True,
            ),
            Plan(
                name="Starter",
                slug="starter",
                description="Perfect for small businesses",
                price=9,
                credits=100,
                features={
                    "basic_tones": True,
                    "draft_saving": True,
                    "all_tones": True,
                    "facebook_publishing": True,
                    "instagram_publishing": False,
                    "priority_support": False,
                },
                is_active=True,
            ),
            Plan(
                name="Pro",
                slug="pro",
                description="For growing businesses",
                price=29,
                credits=-1,  # Unlimited
                features={
                    "basic_tones": True,
                    "draft_saving": True,
                    "all_tones": True,
                    "facebook_publishing": True,
                    "instagram_publishing": True,
                    "priority_support": True,
                },
                is_active=True,
            ),
        ]

        for plan in default_plans:
            db.add(plan)

        db.commit()
        print("✅ Default plans seeded successfully")
    except Exception as e:
        print(f"❌ Error seeding plans: {e}")
        db.rollback()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    seed_default_plans()
    yield
    # Shutdown (nothing to do)

app = FastAPI(
    title="AI Marketing Platform API",
    description="Backend API for AI-powered social media marketing platform",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS configuration
cors_origins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "https://frontend-seven-ruby-55.vercel.app",
    "https://ai-marketing-platform.vercel.app",
    "https://ai-marketing-platform-nine.vercel.app",
]

# Add FRONTEND_URL from settings
if settings.FRONTEND_URL and settings.FRONTEND_URL not in cors_origins:
    cors_origins.append(settings.FRONTEND_URL)

# Add any additional origins from environment
if settings.ADDITIONAL_CORS_ORIGINS:
    for origin in settings.ADDITIONAL_CORS_ORIGINS.split(","):
        origin = origin.strip()
        if origin and origin not in cors_origins:
            cors_origins.append(origin)

print(f"[CORS] Allowed origins: {cors_origins}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH", "HEAD"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=600,
)

# Routers
app.include_router(auth.router)
app.include_router(plans.router)
app.include_router(subscription.router)
app.include_router(wallet.router)
app.include_router(business_config.router)
app.include_router(generate.router)
app.include_router(posts.router)
app.include_router(webhooks.router)
app.include_router(social_accounts.router)
app.include_router(social_accounts_dev.router)  # Development only - remove in production
app.include_router(business_images.router)
app.include_router(upload.router)


@app.get("/")
def root():
    return {"message": "AI Marketing Platform API", "version": "0.1.0"}


@app.get("/health")
def health_check():
    return {"status": "healthy"}
