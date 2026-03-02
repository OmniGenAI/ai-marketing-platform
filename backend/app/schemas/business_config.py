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
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
