import json
from datetime import datetime

from pydantic import BaseModel, field_validator


# Keep these in sync with `frontend/src/lib/poster/templates.ts`.
POSTER_TEMPLATE_STYLES: tuple[str, ...] = (
    "minimal",
    "bold",
    "corporate",
    "festival",
    "tech",
    "startup",
    "event",
    "sale",
)

POSTER_ASPECT_RATIOS: tuple[str, ...] = ("1:1", "4:5", "9:16", "16:9")

POSTER_CAPTION_TONES: tuple[str, ...] = (
    "professional",
    "friendly",
    "witty",
    "casual",
)

# Suggested action verbs the user can hint to the LLM. Empty string = no hint.
POSTER_CTA_VERB_HINTS: tuple[str, ...] = (
    "",
    "Enroll",
    "Register",
    "Join",
    "Reserve",
    "Start",
    "Shop",
    "Claim",
    "Book",
)


class PosterGenerateRequest(BaseModel):
    title: str
    theme: str = ""
    optional_text: str | None = None
    template_style: str = "minimal"
    aspect_ratio: str = "1:1"
    caption_tone: str = "professional"
    primary_color: str | None = None
    secondary_color: str | None = None
    show_logo: bool = True
    cta_verb_hint: str | None = None

    @field_validator("title")
    @classmethod
    def title_must_not_be_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Title is required")
        return v.strip()

    @field_validator("theme")
    @classmethod
    def normalize_theme(cls, v: str) -> str:
        return (v or "").strip()

    @field_validator("optional_text")
    @classmethod
    def normalize_optional_text(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        return v or None

    @field_validator("template_style")
    @classmethod
    def validate_template_style(cls, v: str) -> str:
        v = (v or "").strip().lower()
        if v not in POSTER_TEMPLATE_STYLES:
            raise ValueError(
                f"template_style must be one of: {', '.join(POSTER_TEMPLATE_STYLES)}"
            )
        return v

    @field_validator("aspect_ratio")
    @classmethod
    def validate_aspect_ratio(cls, v: str) -> str:
        v = (v or "").strip()
        if v not in POSTER_ASPECT_RATIOS:
            raise ValueError(
                f"aspect_ratio must be one of: {', '.join(POSTER_ASPECT_RATIOS)}"
            )
        return v

    @field_validator("caption_tone")
    @classmethod
    def validate_caption_tone(cls, v: str) -> str:
        v = (v or "").strip().lower()
        if v not in POSTER_CAPTION_TONES:
            raise ValueError(
                f"caption_tone must be one of: {', '.join(POSTER_CAPTION_TONES)}"
            )
        return v

    @field_validator("cta_verb_hint")
    @classmethod
    def normalize_cta_verb_hint(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        return v or None


class PosterUpdate(BaseModel):
    title: str | None = None
    headline: str | None = None
    tagline: str | None = None
    cta: str | None = None
    caption: str | None = None
    event_meta: str | None = None
    features: list[str] | None = None
    brand_label: str | None = None
    status: str | None = None


class PosterResponse(BaseModel):
    id: str
    user_id: str
    title: str
    theme: str
    optional_text: str | None
    template_style: str
    aspect_ratio: str
    caption_tone: str
    headline: str | None
    tagline: str | None
    cta: str | None
    caption: str | None
    event_meta: str | None
    # Frontend always receives a list (possibly empty). Persisted as JSON in DB.
    features: list[str]
    brand_label: str | None
    background_image_url: str | None
    primary_color: str | None
    secondary_color: str | None
    show_logo: str
    status: str
    error_message: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("features", mode="before")
    @classmethod
    def _parse_features(cls, v):
        """ORM stores features as a JSON string; coerce to list[str] for the API."""
        if v is None or v == "":
            return []
        if isinstance(v, list):
            return [str(x) for x in v]
        if isinstance(v, str):
            try:
                parsed = json.loads(v)
                return [str(x) for x in parsed] if isinstance(parsed, list) else []
            except (json.JSONDecodeError, TypeError):
                return []
        return []


class PosterGenerateResponse(BaseModel):
    poster: PosterResponse
    credits_remaining: int
    background_generation_failed: bool = False
