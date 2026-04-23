import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Show INFO-level logs from our app (Gemini, Serper, Playwright, etc.)
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logging.getLogger("app").setLevel(logging.INFO)

from app.config import settings
from app.database import SessionLocal
from app.models.plan import Plan
from app.routers import auth, plans, subscription, wallet, business_config, generate, posts, webhooks, social_accounts, social_accounts_dev, business_images, upload, reels, seo, blog


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


def ensure_tables_exist():
    """Ensure all tables exist in the database."""
    from sqlalchemy import text

    if not SessionLocal:
        print("⚠️ Database not configured, skipping table check")
        return

    db = SessionLocal()
    try:
        # Check if reels table exists
        result = db.execute(text("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'reels')"))
        exists = result.scalar()

        if not exists:
            print("📦 Creating reels table...")
            db.execute(text("""
                CREATE TABLE IF NOT EXISTS reels (
                    id VARCHAR(36) PRIMARY KEY,
                    user_id VARCHAR(36) NOT NULL REFERENCES users(id),
                    topic VARCHAR(500) NOT NULL,
                    tone VARCHAR(50) NOT NULL DEFAULT 'professional',
                    voice VARCHAR(100) NOT NULL DEFAULT 'en-US-JennyNeural',
                    duration_target INTEGER NOT NULL DEFAULT 30,
                    script TEXT,
                    hashtags TEXT,
                    audio_url TEXT,
                    video_url TEXT,
                    thumbnail_url TEXT,
                    status VARCHAR(50) NOT NULL DEFAULT 'pending',
                    error_message TEXT,
                    platform VARCHAR(50) NOT NULL DEFAULT 'instagram',
                    published_at TIMESTAMP WITH TIME ZONE,
                    instagram_media_id VARCHAR(255),
                    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
                )
            """))
            db.execute(text("CREATE INDEX IF NOT EXISTS ix_reels_user_id ON reels(user_id)"))
            db.execute(text("CREATE INDEX IF NOT EXISTS ix_reels_status ON reels(status)"))
            db.commit()
            print("✅ Reels table created successfully")
        else:
            print("✅ Reels table already exists")

        # seo_saves table
        result2 = db.execute(text("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'seo_saves')"))
        if not result2.scalar():
            print("📦 Creating seo_saves table...")
            db.execute(text("""
                CREATE TABLE IF NOT EXISTS seo_saves (
                    id VARCHAR(36) PRIMARY KEY,
                    user_id VARCHAR(36) NOT NULL REFERENCES users(id),
                    type VARCHAR(20) NOT NULL DEFAULT 'brief',
                    title VARCHAR(500) NOT NULL DEFAULT '',
                    data TEXT NOT NULL DEFAULT '{}',
                    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
                )
            """))
            db.execute(text("CREATE INDEX IF NOT EXISTS ix_seo_saves_user_id ON seo_saves(user_id)"))
            db.commit()
            print("✅ seo_saves table created successfully")
        else:
            print("✅ seo_saves table already exists")
    except Exception as e:
        print(f"❌ Error checking/creating tables: {e}")
        db.rollback()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    ensure_tables_exist()
    seed_default_plans()
    yield
    # Shutdown (nothing to do)

app = FastAPI(
    title="AI Marketing Platform API",
    description="Backend API for AI-powered social media marketing platform",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS configuration - use regex to allow all Vercel deployments
print("[CORS] Allowing localhost and all *.vercel.app domains")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_origin_regex=r"https://.*\.vercel\.app",
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
app.include_router(reels.router)
app.include_router(seo.router)
app.include_router(blog.router)


@app.get("/")
def root():
    return {"message": "AI Marketing Platform API", "version": "0.1.0"}


@app.get("/health")
def health_check():
    return {"status": "healthy"}
