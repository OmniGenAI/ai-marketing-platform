from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, model_validator


# ---------------------------------------------------------------------------
# Enums — the new primary knobs replacing the weak "tone" string
# ---------------------------------------------------------------------------

class VoicePreset(str, Enum):
    founder_pov     = "founder_pov"
    contrarian      = "contrarian"
    story_driven    = "story_driven"
    data_backed     = "data_backed"
    educational     = "educational"
    technical_deep  = "technical_deep"
    casual_builder  = "casual_builder"


class ContentGoal(str, Enum):
    clicks     = "clicks"
    comments   = "comments"
    authority  = "authority"
    promote    = "promote"
    viral      = "viral"


class CtaStyle(str, Enum):
    soft       = "soft"
    hard       = "hard"
    curiosity  = "curiosity"
    none       = "none"


HookStyle = Literal["curiosity", "contrarian", "data", "story", "bold"]

PlatformKey = Literal[
    "linkedin", "twitter", "email", "youtube",
    "instagram", "facebook", "quotes", "carousel",
]

ALL_PLATFORMS: list[str] = [
    "linkedin", "twitter", "email", "youtube",
    "instagram", "facebook", "quotes", "carousel",
]


# Back-compat: legacy "tone" → new voice
LEGACY_TONE_TO_VOICE = {
    "professional": VoicePreset.founder_pov,
    "friendly":     VoicePreset.story_driven,
    "witty":        VoicePreset.contrarian,
    "casual":       VoicePreset.casual_builder,
    "formal":       VoicePreset.educational,
}


# ---------------------------------------------------------------------------
# Response blocks
# ---------------------------------------------------------------------------

class EmailBlock(BaseModel):
    subject: str = ""
    body: str = ""


class HookVariant(BaseModel):
    style: HookStyle
    text: str = ""
    score: int = 0   # 0..100 heuristic, populated in Phase C


class RepurposeFormats(BaseModel):
    # Pinned-first output tile
    hook_variations: list[HookVariant] = []

    # Plural = new, singular = deprecated alias (kept for 1 release).
    linkedin_posts: list[str] = []
    linkedin_post: str = ""          # DEPRECATED — mirrors linkedin_posts[0]

    twitter_thread: list[str] = []

    email: EmailBlock = EmailBlock()

    youtube_description: str = ""

    instagram_captions: list[str] = []
    instagram_caption: str = ""      # DEPRECATED — mirrors instagram_captions[0]

    facebook_posts: list[str] = []
    facebook_post: str = ""          # DEPRECATED — mirrors facebook_posts[0]

    quote_cards: list[str] = []
    carousel_outline: list[str] = []


# ---------------------------------------------------------------------------
# Request
# ---------------------------------------------------------------------------

class RepurposeRequest(BaseModel):
    # Source A — existing blog save
    blog_save_id: str | None = None
    # Source B — raw paste
    blog_content: str | None = None
    blog_title: str | None = None

    source_url: str = ""
    primary_keyword: str | None = None
    secondary_keywords: list[str] = []

    # v2 — primary signals
    voice: VoicePreset = VoicePreset.founder_pov
    goal: ContentGoal = ContentGoal.authority
    cta_style: CtaStyle = CtaStyle.soft

    # Platform + variation controls
    platforms: list[str] = Field(default_factory=lambda: list(ALL_PLATFORMS))
    variations_per_platform: int = Field(default=1, ge=1, le=5)
    include_hook_variations: bool = True
    # Bulk-across-styles (Phase C): when true + variations_per_platform > 1,
    # each LinkedIn/IG/FB variant is written in a different voice so the user
    # can A/B across voice styles in a single run.
    variations_across_voices: bool = False

    # Context passthrough
    business_name: str = ""
    niche: str = ""

    # DEPRECATED — legacy tone; mapped to voice only if voice is at default.
    tone: str | None = None

    @model_validator(mode="after")
    def _validate(self) -> "RepurposeRequest":
        has_blog_ref = bool(self.blog_save_id)
        has_raw = bool((self.blog_content or "").strip())
        if not has_blog_ref and not has_raw:
            raise ValueError(
                "Provide either blog_save_id, or blog_content (with source_url)."
            )
        if has_raw and not (self.source_url or "").strip():
            raise ValueError("source_url is required when pasting raw content.")

        # Back-compat: if caller still sends `tone` and hasn't overridden voice,
        # promote tone → voice so existing clients keep working.
        if self.tone and self.voice == VoicePreset.founder_pov:
            mapped = LEGACY_TONE_TO_VOICE.get(self.tone.lower().strip())
            if mapped:
                self.voice = mapped

        # Normalize platforms: lowercase, strip, dedupe, drop unknowns.
        cleaned: list[str] = []
        seen: set[str] = set()
        for p in self.platforms or []:
            pk = str(p).strip().lower()
            if pk in ALL_PLATFORMS and pk not in seen:
                cleaned.append(pk)
                seen.add(pk)
        self.platforms = cleaned or list(ALL_PLATFORMS)
        return self


class RepurposeSaveItem(BaseModel):
    id: str
    title: str
    source_url: str = ""
    primary_keyword: str = ""
    created_at: str
    updated_at: str


class RepurposeResponse(BaseModel):
    save_id: str
    source_url: str
    primary_keyword: str
    keywords_used: list[str]
    voice: VoicePreset = VoicePreset.founder_pov
    goal: ContentGoal = ContentGoal.authority
    platforms: list[str] = Field(default_factory=lambda: list(ALL_PLATFORMS))
    formats: RepurposeFormats


# ---------------------------------------------------------------------------
# Phase B — per-section regenerate + inline autosave
# ---------------------------------------------------------------------------

RewriteSection = Literal[
    "hook_variations",
    "linkedin",
    "twitter_thread",
    "email",
    "youtube",
    "instagram",
    "facebook",
    "quotes",
    "carousel",
]

RewritePreset = Literal[
    "sharper",
    "shorter",
    "bolder",
    "curiosity_gap",
    "more_specific",
]


class RegenerateRequest(BaseModel):
    section: RewriteSection
    variant_index: int = Field(default=0, ge=0, le=4)  # LI/IG/FB variant picker
    preset: RewritePreset | None = None                # quick-rewrite pill
    instruction: str | None = None                     # free-form user instruction

    @model_validator(mode="after")
    def _at_least_one(self) -> "RegenerateRequest":
        # One of preset/instruction is fine, both is fine; neither is also fine
        # (section is regenerated with default "freshen up" semantics).
        return self


class RegenerateResponse(BaseModel):
    section: RewriteSection
    variant_index: int
    formats: RepurposeFormats
    free_rerolls_remaining: int
    credits_charged: int = 0


class RepurposePatchRequest(BaseModel):
    formats: RepurposeFormats


class RepurposePatchResponse(BaseModel):
    save_id: str
    updated_at: str
