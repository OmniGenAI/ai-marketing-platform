from datetime import datetime

from pydantic import BaseModel, field_validator


class PostCreate(BaseModel):
    content: str
    hashtags: str = ""
    image_url: str | None = None
    image_option: str = "none"
    platform: str = "facebook"
    tone: str = "professional"
    status: str = "draft"


class PostUpdate(BaseModel):
    content: str | None = None
    hashtags: str | None = None
    image_url: str | None = None
    image_option: str | None = None
    status: str | None = None


class PostResponse(BaseModel):
    id: str
    user_id: str
    content: str
    hashtags: str
    image_url: str | None
    image_option: str
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
    topic: str
    image_option: str = "none"  # none, business, ai, upload
    business_image_id: str | None = None
    uploaded_image_url: str | None = None  # For upload option
    seo_mode: bool = False
    seo_save_id: str | None = None  # brief to pull keywords from
    blog_url: str | None = None  # optional backlink appended to content

    @field_validator("topic")
    @classmethod
    def topic_must_not_be_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Topic is required")
        return v.strip()

    @field_validator("image_option")
    @classmethod
    def validate_image_option(cls, v: str) -> str:
        valid_options = ["none", "business", "ai", "upload"]
        if v not in valid_options:
            raise ValueError(f"image_option must be one of: {', '.join(valid_options)}")
        return v


class GenerateResponse(BaseModel):
    content: str
    hashtags: str
    image_url: str | None = None
    website_context_used: bool = False  # Indicates if website data was used for generation
    seo_keywords_used: list[str] = []
    primary_keyword: str | None = None
