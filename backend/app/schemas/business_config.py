from datetime import datetime

from pydantic import BaseModel


class BusinessConfigCreate(BaseModel):
    business_name: str
    niche: str
    location: str | None = None
    tone: str = "professional"
    products: str = ""
    brand_voice: str = ""
    target_audience: str = ""
    hashtags: str = ""
    competitors: str | None = None
    website: str | None = None
    website_context: str | None = None


class BusinessConfigResponse(BaseModel):
    id: str
    user_id: str
    business_name: str
    niche: str
    location: str | None
    tone: str
    products: str
    brand_voice: str
    target_audience: str
    hashtags: str
    competitors: str | None
    website: str | None
    website_context: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ScrapeWebsiteRequest(BaseModel):
    url: str


class ScrapeWebsiteResponse(BaseModel):
    success: bool
    message: str
    context: dict | None = None
    summary: str | None = None
