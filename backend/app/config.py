from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = ""

    # Supabase
    SUPABASE_URL: str = ""
    SUPABASE_ANON_KEY: str = ""
    SUPABASE_SERVICE_ROLE_KEY: str = ""
    SUPABASE_JWT_SECRET: str = ""

    # JWT (legacy - for backwards compatibility)
    JWT_SECRET: str = "change-this-to-a-random-secret-key"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRATION_MINUTES: int = 1440  # 24 hours

    # Google Gemini AI
    GOOGLE_GEMINI_API_KEY: str = ""

    # Serper.dev (Google Search API for competitor discovery)
    SERPER_API_KEY: str = ""

    # Grok AI (xAI)
    XAI_API_KEY: str = ""

    # Groq AI (super fast, free tier available)
    GROQ_API_KEY: str = ""

    # OpenAI
    OPENAI_API_KEY: str = ""
    OPENAI_TEXT_MODEL: str = "gpt-4.1-mini"
    OPENAI_IMAGE_MODEL: str = "gpt-image-1"
    OPENAI_IMAGE_SIZE: str = "1024x1024"

    # Poster generation — credit cost per AI poster (background + copy)
    POSTER_CREDIT_COST: int = 1

    # Pexels API (free stock videos - fallback)
    PEXELS_API_KEY: str = ""

    # Scrape.do (proxy fallback when Playwright fails / blocked)
    SCRAPEDO_TOKEN: str = ""

    # Stripe
    STRIPE_SECRET_KEY: str = ""
    STRIPE_WEBHOOK_SECRET: str = ""

    # Facebook OAuth
    FACEBOOK_APP_ID: str = ""
    FACEBOOK_APP_SECRET: str = ""

    # Pre-configured Facebook Page (Quick Connect)
    FACEBOOK_PAGE_ID: str = ""
    FACEBOOK_PAGE_NAME: str = ""
    FACEBOOK_PAGE_ACCESS_TOKEN: str = ""

    # Pre-configured Instagram Account (Quick Connect)
    INSTAGRAM_ACCOUNT_ID: str = ""
    INSTAGRAM_USERNAME: str = ""
    INSTAGRAM_ACCESS_TOKEN: str = ""

    # Social Media Posting - set to false to disable Facebook/Instagram posting
    SOCIAL_POSTING_ENABLED: bool = True

    # ---- Multi-platform OAuth ------------------------------------------------
    # Each platform's endpoints return 503 cleanly when its credentials are
    # missing — the user can still use the rest of the app.

    # LinkedIn — https://www.linkedin.com/developers/apps
    # Required scopes: w_member_social (publish), r_organization_social
    # (analytics for company pages — optional).
    LINKEDIN_CLIENT_ID: str = ""
    LINKEDIN_CLIENT_SECRET: str = ""

    # Google (used for YouTube) — https://console.cloud.google.com
    # YouTube Data API v3 must be enabled. Scopes: youtube.upload + youtube.readonly.
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""

    # Reddit — https://www.reddit.com/prefs/apps (type: web app)
    # Scopes: identity, submit, read, history.
    REDDIT_CLIENT_ID: str = ""
    REDDIT_CLIENT_SECRET: str = ""
    # Reddit's API requires a unique, descriptive User-Agent per their TOS.
    REDDIT_USER_AGENT: str = "ai-marketing-platform/1.0 (by /u/anonymous)"

    # Dev.to has no OAuth — users paste a personal API key from
    # https://dev.to/settings/extensions. No global config needed; this flag
    # lets us hide the connect card if we want to disable the feature.
    DEVTO_ENABLED: bool = True

    # AI video generation toggle (xAI grok-imagine-video). Set to false to use
    # Pexels stock + Edge TTS instead — saves credits + minutes per reel.
    USE_AI_VIDEO: bool = False

    # When true, /api/social/{facebook,instagram}/quick-connect is enabled.
    # That endpoint attaches the operator's shared FB Page / IG Business
    # Account (from FACEBOOK_PAGE_*, INSTAGRAM_*) to the calling user — only
    # safe for local dev. Real users must use the per-user OAuth flow
    # (/api/social/facebook/auth → /facebook/callback).
    ALLOW_QUICK_CONNECT: bool = False

    # CORS
    FRONTEND_URL: str = "http://localhost:3000"
    # Comma-separated list of additional allowed origins
    ADDITIONAL_CORS_ORIGINS: str = ""

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
