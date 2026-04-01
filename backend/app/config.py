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

    # Grok AI (xAI)
    XAI_API_KEY: str = ""

    # Pexels API (free stock videos)
    PEXELS_API_KEY: str = ""

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

    # CORS
    FRONTEND_URL: str = "http://localhost:3000"
    # Comma-separated list of additional allowed origins
    ADDITIONAL_CORS_ORIGINS: str = ""

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
