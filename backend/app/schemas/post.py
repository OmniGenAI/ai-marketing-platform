from datetime import datetime

from pydantic import BaseModel


class PostCreate(BaseModel):
    content: str
    hashtags: str = ""
    platform: str = "facebook"
    tone: str = "professional"
    status: str = "draft"


class PostUpdate(BaseModel):
    content: str | None = None
    hashtags: str | None = None
    status: str | None = None


class PostResponse(BaseModel):
    id: str
    user_id: str
    content: str
    hashtags: str
    platform: str
    tone: str
    status: str
    published_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class GenerateRequest(BaseModel):
    platform: str = "facebook"
    tone: str = "professional"
    topic: str = ""


class GenerateResponse(BaseModel):
    content: str
    hashtags: str
