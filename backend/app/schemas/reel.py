from datetime import datetime
from typing import Literal

from pydantic import BaseModel, field_validator


class ReelGenerateRequest(BaseModel):
    topic: str
    description: str = ""            # optional extra context — what the reel is about, product details, angle, etc.
    tone: str = "professional"
    voice: str = "en-US-JennyNeural"
    duration_target: int = 30
    seo_save_id: str | None = None   # reuse an existing SEO brief for grounded keywords

    @field_validator("topic")
    @classmethod
    def topic_must_not_be_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Topic is required")
        return v.strip()

    @field_validator("duration_target")
    @classmethod
    def validate_duration(cls, v: int) -> int:
        if v not in [15, 30, 60]:
            raise ValueError("Duration must be 15, 30, or 60 seconds")
        return v


class ReelCreate(BaseModel):
    topic: str
    tone: str = "professional"
    voice: str = "en-US-JennyNeural"
    duration_target: int = 30
    script: str | None = None
    hashtags: str | None = None
    audio_url: str | None = None
    video_url: str | None = None
    thumbnail_url: str | None = None
    status: str = "pending"
    platform: str = "instagram"


class ReelUpdate(BaseModel):
    script: str | None = None
    hashtags: str | None = None
    audio_url: str | None = None
    video_url: str | None = None
    thumbnail_url: str | None = None
    status: str | None = None
    error_message: str | None = None
    instagram_media_id: str | None = None


class ReelResponse(BaseModel):
    id: str
    user_id: str
    topic: str
    tone: str
    voice: str
    duration_target: int
    script: str | None
    hashtags: str | None
    primary_keyword: str | None = None
    audio_url: str | None
    video_url: str | None
    thumbnail_url: str | None
    status: str
    error_message: str | None
    platform: str
    published_at: datetime | None
    instagram_media_id: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class VoiceOption(BaseModel):
    id: str
    name: str
    gender: Literal["male", "female"]
    language: str
    description: str


class VoicesResponse(BaseModel):
    voices: list[VoiceOption]
