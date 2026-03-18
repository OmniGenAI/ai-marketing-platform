from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import SessionLocal
from app.models.plan import Plan
from app.routers import auth, plans, subscription, wallet, business_config, generate, posts, webhooks, social_accounts, social_accounts_dev, business_images


def seed_default_plans():
    """Seed default subscription plans if they don't exist"""
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

# CORS - allow both local and production URLs
cors_origins = [
    settings.FRONTEND_URL,
    "http://localhost:3000",
    "http://localhost:3001",
    # Vercel production URLs
    "https://frontend-seven-ruby-55.vercel.app",
    "https://ai-marketing-platform.vercel.app",
    "https://ai-marketing-platform-nine.vercel.app",
]
# Add any additional origins from environment variable
if settings.ADDITIONAL_CORS_ORIGINS:
    cors_origins.extend(settings.ADDITIONAL_CORS_ORIGINS.split(","))
# Remove duplicates and empty strings
cors_origins = list(set(origin.strip() for origin in cors_origins if origin and origin.strip()))

# Check if any Vercel preview URLs should be allowed
allow_all_origins = False
for origin in cors_origins:
    if ".vercel.app" in origin:
        # If we have Vercel URLs, we may need to allow preview deployments too
        pass

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=r"https://.*\.vercel\.app",  # Allow all Vercel preview deployments
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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


@app.get("/")
def root():
    return {"message": "AI Marketing Platform API", "version": "0.1.0"}


@app.get("/health")
def health_check():
    return {"status": "healthy"}
