import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler

# Show INFO-level logs from our app (Gemini, Serper, Playwright, etc.)
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logging.getLogger("app").setLevel(logging.INFO)

from app.config import settings
from app.database import SessionLocal
from app.models.plan import Plan
from app.routers import auth, plans, subscription, wallet, business_config, generate, posts, webhooks, social_accounts, social_accounts_dev, business_images, upload, reels, seo, blog, repurpose, poster, analytics, social_oauth, post_analytics, calendar as calendar_router


def seed_default_plans():
    """Upsert subscription plans on every startup so price/credit/feature
    edits in this list propagate without requiring a DB reset.
    Plans are matched by slug: existing rows are updated in place,
    missing rows are inserted. Plans not in this list are left alone."""
    if not SessionLocal:
        print("⚠️ Database not configured, skipping plan seeding")
        return

    default_plans = [
        {
            "name": "Free",
            "slug": "free",
            "description": "Try the platform — drafts only, no publishing",
            "price": 0,
            "credits": 10,
            "features": {
                "basic_tones": True,
                "draft_saving": True,
                "all_tones": False,
                "facebook_publishing": False,
                "instagram_publishing": False,
                "linkedin_publishing": False,
                "multi_brand": False,
                "seo_panel": False,
                "image_generation": False,
                "reel_generation": False,
                "priority_queue": False,
                "priority_support": False,
                "api_access": False,
                "white_label": False,
                "brand_count": 1,
            },
            "is_active": True,
        },
        {
            "name": "Starter",
            "slug": "starter",
            "description": "For solo creators and small businesses publishing weekly",
            "price": 49,
            "credits": 100,
            "features": {
                "basic_tones": True,
                "draft_saving": True,
                "all_tones": True,
                "facebook_publishing": True,
                "instagram_publishing": True,
                "linkedin_publishing": False,
                "multi_brand": False,
                "seo_panel": True,
                "image_generation": True,
                "reel_generation": True,
                "priority_queue": False,
                "priority_support": False,
                "api_access": False,
                "white_label": False,
                "brand_count": 1,
            },
            "is_active": True,
        },
        {
            "name": "Growth",
            "slug": "growth",
            "description": "For growing brands publishing daily across multiple networks",
            "price": 299,
            "credits": 400,
            "features": {
                "basic_tones": True,
                "draft_saving": True,
                "all_tones": True,
                "facebook_publishing": True,
                "instagram_publishing": True,
                "linkedin_publishing": True,
                "multi_brand": True,
                "seo_panel": True,
                "image_generation": True,
                "reel_generation": True,
                "priority_queue": False,
                "priority_support": True,
                "api_access": False,
                "white_label": False,
                "brand_count": 3,
            },
            "is_active": True,
        },
        {
            "name": "Agency",
            "slug": "agency",
            "description": "For agencies and teams managing many brands",
            "price": 499,
            "credits": -1,  # Unlimited
            "features": {
                "basic_tones": True,
                "draft_saving": True,
                "all_tones": True,
                "facebook_publishing": True,
                "instagram_publishing": True,
                "linkedin_publishing": True,
                "multi_brand": True,
                "seo_panel": True,
                "image_generation": True,
                "reel_generation": True,
                "priority_queue": True,
                "priority_support": True,
                "api_access": True,
                "white_label": True,
                "brand_count": 10,
            },
            "is_active": True,
        },
    ]

    db = SessionLocal()
    try:
        # Retire the legacy "Pro" slug from the previous price tiers so the
        # subscription page doesn't show stale plans alongside the new ones.
        legacy_pro = db.query(Plan).filter(Plan.slug == "pro").first()
        if legacy_pro:
            legacy_pro.is_active = False

        inserted = 0
        updated = 0
        for spec in default_plans:
            existing = db.query(Plan).filter(Plan.slug == spec["slug"]).first()
            if existing:
                existing.name = spec["name"]
                existing.description = spec["description"]
                existing.price = spec["price"]
                existing.credits = spec["credits"]
                existing.features = spec["features"]
                existing.is_active = spec["is_active"]
                updated += 1
            else:
                db.add(Plan(**spec))
                inserted += 1

        db.commit()
        print(f"✅ Plans synced: {inserted} inserted, {updated} updated")
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

        # posters table
        result3 = db.execute(text("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'posters')"))
        if not result3.scalar():
            print("📦 Creating posters table...")
            db.execute(text("""
                CREATE TABLE IF NOT EXISTS posters (
                    id VARCHAR(36) PRIMARY KEY,
                    user_id VARCHAR(36) NOT NULL REFERENCES users(id),
                    title VARCHAR(500) NOT NULL,
                    theme VARCHAR(255) NOT NULL DEFAULT '',
                    optional_text TEXT,
                    template_style VARCHAR(50) NOT NULL DEFAULT 'minimal',
                    aspect_ratio VARCHAR(20) NOT NULL DEFAULT '1:1',
                    caption_tone VARCHAR(50) NOT NULL DEFAULT 'professional',
                    headline TEXT,
                    tagline TEXT,
                    cta VARCHAR(255),
                    caption TEXT,
                    event_meta VARCHAR(255),
                    features TEXT,
                    brand_label VARCHAR(255),
                    background_image_url TEXT,
                    primary_color VARCHAR(20),
                    secondary_color VARCHAR(20),
                    show_logo VARCHAR(10) NOT NULL DEFAULT 'true',
                    status VARCHAR(50) NOT NULL DEFAULT 'draft',
                    error_message TEXT,
                    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
                )
            """))
            db.execute(text("CREATE INDEX IF NOT EXISTS ix_posters_user_id ON posters(user_id)"))
            db.execute(text("CREATE INDEX IF NOT EXISTS ix_posters_status ON posters(status)"))
            db.commit()
            print("✅ posters table created successfully")
        else:
            print("✅ posters table already exists")

        # Idempotent column adds for posters depth fields (event_meta / features /
        # brand_label) — safe to run on every startup even after the table exists.
        db.execute(text("ALTER TABLE posters ADD COLUMN IF NOT EXISTS event_meta VARCHAR(255)"))
        db.execute(text("ALTER TABLE posters ADD COLUMN IF NOT EXISTS features TEXT"))
        db.execute(text("ALTER TABLE posters ADD COLUMN IF NOT EXISTS brand_label VARCHAR(255)"))
        db.commit()

        # tracking_sites + tracking_events (analytics module)
        result4 = db.execute(text("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'tracking_sites')"))
        if not result4.scalar():
            print("📦 Creating tracking_sites table...")
            db.execute(text("""
                CREATE TABLE IF NOT EXISTS tracking_sites (
                    id VARCHAR(36) PRIMARY KEY,
                    user_id VARCHAR(36) NOT NULL REFERENCES users(id),
                    domain VARCHAR(255) NOT NULL,
                    name VARCHAR(255),
                    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
                )
            """))
            db.execute(text("CREATE INDEX IF NOT EXISTS ix_tracking_sites_user_id ON tracking_sites(user_id)"))
            db.commit()
            print("✅ tracking_sites table created successfully")

        result5 = db.execute(text("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'tracking_events')"))
        if not result5.scalar():
            print("📦 Creating tracking_events table...")
            db.execute(text("""
                CREATE TABLE IF NOT EXISTS tracking_events (
                    id VARCHAR(36) PRIMARY KEY,
                    site_id VARCHAR(36) NOT NULL REFERENCES tracking_sites(id),
                    type VARCHAR(20) NOT NULL DEFAULT 'pageview',
                    path VARCHAR(500) NOT NULL DEFAULT '/',
                    referrer VARCHAR(500),
                    country VARCHAR(8),
                    device VARCHAR(20),
                    browser VARCHAR(40),
                    visitor_hash VARCHAR(64) NOT NULL,
                    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
                )
            """))
            db.execute(text("CREATE INDEX IF NOT EXISTS ix_tracking_events_site_id ON tracking_events(site_id)"))
            db.execute(text("CREATE INDEX IF NOT EXISTS ix_tracking_events_created_at ON tracking_events(created_at)"))
            db.execute(text("CREATE INDEX IF NOT EXISTS ix_tracking_events_visitor_hash ON tracking_events(visitor_hash)"))
            db.execute(text("CREATE INDEX IF NOT EXISTS ix_tracking_events_site_created ON tracking_events(site_id, created_at)"))
            db.commit()
            print("✅ tracking_events table created successfully")
    except Exception as e:
        print(f"❌ Error checking/creating tables: {e}")
        db.rollback()
    finally:
        db.close()


async def _retention_loop():
    """Run analytics retention cleanup once on boot, then every 24h."""
    import asyncio
    from app.routers.analytics import cleanup_old_events
    while True:
        if SessionLocal:
            db = SessionLocal()
            try:
                deleted = cleanup_old_events(db)
                if deleted:
                    print(f"🧹 Pruned {deleted} old tracking_events rows")
            except Exception as e:
                print(f"⚠️ retention cleanup failed: {e}")
            finally:
                db.close()
        await asyncio.sleep(24 * 60 * 60)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    import asyncio
    from app.services.scheduler import run_due_posts

    ensure_tables_exist()
    seed_default_plans()
    retention_task = asyncio.create_task(_retention_loop())

    # Post scheduler — checks for due scheduled posts every 60 seconds.
    # Uses AsyncIOScheduler so it runs on the same event loop as FastAPI/Uvicorn.
    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        run_due_posts,
        trigger="interval",
        seconds=60,
        id="post_scheduler",
        name="Publish scheduled posts",
        max_instances=1,          # prevent overlap if a run takes > 60s
        misfire_grace_time=30,    # fire late jobs up to 30s after their time
    )
    scheduler.start()
    print("✅ Post scheduler started — checking every 60s")

    yield

    # Shutdown
    scheduler.shutdown(wait=False)
    retention_task.cancel()

app = FastAPI(
    title="AI Marketing Platform API",
    description="Backend API for AI-powered social media marketing platform",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS configuration - allow localhost, *.vercel.app, *.ngrok-free.app,
# *.ngrok-free.dev, *.ngrok.io, *.trycloudflare.com (ngrok / Cloudflare
# tunnels are needed for FB Login for Business during local OAuth dev
# because Meta requires HTTPS redirect URIs).
print("[CORS] Allowing localhost, *.vercel.app, *.ngrok-free.app, *.ngrok-free.dev, *.ngrok.io, *.trycloudflare.com")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_origin_regex=r"https://.*\.(vercel\.app|ngrok-free\.app|ngrok-free\.dev|ngrok\.io|trycloudflare\.com)",
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
app.include_router(post_analytics.router)  # Must be before posts.router — /published-summary must not be matched by /{post_id}
app.include_router(posts.router)
app.include_router(webhooks.router)
app.include_router(social_accounts.router)
app.include_router(social_accounts_dev.router)  # Development only - remove in production
app.include_router(business_images.router)
app.include_router(upload.router)
app.include_router(reels.router)
app.include_router(seo.router)
app.include_router(blog.router)
app.include_router(repurpose.router)
app.include_router(poster.router)
app.include_router(analytics.router)
app.include_router(social_oauth.router)
app.include_router(calendar_router.router)


@app.get("/")
def root():
    return {"message": "AI Marketing Platform API", "version": "0.1.0"}


@app.get("/health")
def health_check():
    return {"status": "healthy"}
