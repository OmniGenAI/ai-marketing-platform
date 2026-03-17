from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = "postgresql://postgres:ai-marketing-platform@db.xwcnsjrgtsvstewuymlq.supabase.co:5432/postgres"

    # Supabase
    SUPABASE_URL: str = "https://xwcnsjrgtsvstewuymlq.supabase.co"
    SUPABASE_ANON_KEY: str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3Y25zanJndHN2c3Rld3V5bWxxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3MjY2MjEsImV4cCI6MjA4OTMwMjYyMX0.Czg1SJz_H0EvctKEKG2-_ITplbSbkcDyh-5Xqv63CbI"
    SUPABASE_SERVICE_ROLE_KEY: str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3Y25zanJndHN2c3Rld3V5bWxxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzcyNjYyMSwiZXhwIjoyMDg5MzAyNjIxfQ.4HNLb7M7LWRkzGFh2zP0Td8IG8xi-INK8WIVQWgohMo"
    SUPABASE_JWT_SECRET: str = "sJOEL8qYZ//MOmlNXj8K0fTOMU7upx/6daVuzqlUVoB8+FCpmID/BDpk5y6eA3VhQf+he2NBk2eYBzbTgtdXQw=="

    # JWT (legacy - for backwards compatibility)
    JWT_SECRET: str = "change-this-to-a-random-secret-key"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRATION_MINUTES: int = 1440  # 24 hours

    # Google Gemini AI
    GOOGLE_GEMINI_API_KEY: str = ""

    # Stripe
    STRIPE_SECRET_KEY: str = ""
    STRIPE_WEBHOOK_SECRET: str = ""

    # Facebook OAuth
    FACEBOOK_APP_ID: str = ""
    FACEBOOK_APP_SECRET: str = ""

    # CORS
    FRONTEND_URL: str = "http://localhost:3000"

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
