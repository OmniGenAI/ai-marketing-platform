import uuid
from datetime import datetime, timezone

from sqlalchemy import String, DateTime, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Poster(Base):
    __tablename__ = "posters"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))

    # Inputs the user provided
    title: Mapped[str] = mapped_column(String(500))
    theme: Mapped[str] = mapped_column(String(255), default="")
    optional_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    template_style: Mapped[str] = mapped_column(String(50), default="minimal")
    aspect_ratio: Mapped[str] = mapped_column(String(20), default="1:1")
    caption_tone: Mapped[str] = mapped_column(String(50), default="professional")

    # AI-generated copy block (frontend renders these as CSS overlay text)
    headline: Mapped[str | None] = mapped_column(Text, nullable=True)
    tagline: Mapped[str | None] = mapped_column(Text, nullable=True)
    cta: Mapped[str | None] = mapped_column(String(255), nullable=True)
    caption: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Eyebrow line above the headline — "30-Day Bootcamp · Self-paced".
    event_meta: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # 3 to 4 short benefit bullets, JSON-encoded list of strings.
    features: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Footer brand strip — "BusinessName · site.com · @handle".
    brand_label: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # AI-generated background image (text-free) — Supabase Storage URL or data URI
    background_image_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Snapshot of brand colors used at generation time so re-renders stay stable
    primary_color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    secondary_color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    show_logo: Mapped[str] = mapped_column(String(10), default="true")

    status: Mapped[str] = mapped_column(String(50), default="draft")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    user: Mapped["User"] = relationship(back_populates="posters")  # type: ignore  # noqa: F821
