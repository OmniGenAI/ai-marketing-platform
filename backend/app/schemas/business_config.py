from datetime import datetime

from pydantic import BaseModel


class BusinessConfigCreate(BaseModel):
    business_name: str
    niche: str
    tone: str = "professional"
    products: str = ""
    brand_voice: str = ""
    hashtags: str = ""
    target_audience: str = ""
    platform_preference: str = "both"
    email: str | None = None
    phone: str | None = None
    address: str | None = None
    website: str | None = None


class BusinessConfigResponse(BaseModel):
    id: str
    user_id: str
    business_name: str
    niche: str
    tone: str
    products: str
    brand_voice: str
    hashtags: str
    target_audience: str
    platform_preference: str
    email: str | None
    phone: str | None
    address: str | None
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
