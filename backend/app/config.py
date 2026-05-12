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
    # OpenAI Sora video generation (primary video provider for reels).
    # sora-2 supports 720x1280 / 1280x720; durations of 4, 8, or 12 seconds.
    OPENAI_VIDEO_MODEL: str = "sora-2"
    OPENAI_VIDEO_SIZE: str = "720x1280"  # 9:16 portrait for reels

    # -------------------------------------------------------------------
    # AI feature credit costs — overridable per deployment via env vars.
    # Change these to retune billing without touching code or restarting
    # a deploy that pre-shipped them. The frontend reads them from
    # GET /api/credits/costs so the UI always matches the backend.
    #
    # Pricing rationale:
    #   - SOCIAL_POST: 1 LLM text + 1 image gen, cheap
    #   - POSTER:      1 LLM copy + 1 image gen, similar to social post
    #   - REEL_SCRIPT: text only, free as a teaser
    #   - REEL_VIDEO:  Sora-2 video — expensive, biggest cost
    #   - BLOG:        long-form LLM call (~1500 words)
    #   - SEO_BRIEF:   SERP fetch + multi-step LLM (~3 calls + scraping)
    #   - SEO_KEYWORDS / TIPS: single LLM call
    #   - SEO_APPLY_TIPS: full HTML rewrite LLM call
    #   - REPURPOSE:   one big LLM call producing many platform formats
    # -------------------------------------------------------------------
    POSTER_CREDIT_COST: int = 1
    SOCIAL_POST_CREDIT_COST: int = 1
    REEL_VIDEO_CREDIT_COST: int = 4
    # Cost the user pays to cancel an in-flight reel generation. The
    # outstanding REEL_VIDEO_CREDIT_COST charge is refunded minus this
    # cancel fee — it covers what we've already spent on the half-finished
    # render (TTS, partial Sora call, etc.).
    REEL_CANCEL_CREDIT_COST: int = 1
    BLOG_CREDIT_COST: int = 3
    SEO_BRIEF_CREDIT_COST: int = 2
    SEO_KEYWORDS_CREDIT_COST: int = 1
    SEO_TIPS_CREDIT_COST: int = 1
    SEO_APPLY_TIPS_CREDIT_COST: int = 2
    REPURPOSE_CREDIT_COST: int = 1
    # Phase-B: free rerolls before charging on the repurpose detail page.
    REPURPOSE_FREE_REROLLS_PER_DAY: int = 3
    REPURPOSE_REROLL_CREDIT_COST: int = 1

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

    # Twitter / X — https://developer.x.com/en/portal/dashboard
    # OAuth 2.0 with PKCE. Scopes: tweet.read, tweet.write, users.read,
    # offline.access (for refresh tokens).
    TWITTER_CLIENT_ID: str = ""
    TWITTER_CLIENT_SECRET: str = ""

    # Threads — https://developers.facebook.com/docs/threads
    # Uses Meta's Threads Graph API. Scopes: threads_basic, threads_content_publish,
    # threads_manage_insights. Requires a separate Threads app (NOT the same
    # as Facebook/Instagram app credentials).
    THREADS_CLIENT_ID: str = ""
    THREADS_CLIENT_SECRET: str = ""

    # Dev.to has no OAuth — users paste a personal API key from
    # https://dev.to/settings/extensions. No global config needed; this flag
    # lets us hide the connect card if we want to disable the feature.
    DEVTO_ENABLED: bool = True

    # AI video generation toggle (OpenAI Sora-2). Set to false to skip the
    # AI provider and go straight to Pexels stock + Edge TTS — saves credits
    # + minutes per reel when the OpenAI video quota is exhausted.
    USE_AI_VIDEO: bool = True

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
