import uuid
from datetime import datetime, timezone

from sqlalchemy import String, DateTime, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    content: Mapped[str] = mapped_column(Text, default="")
    hashtags: Mapped[str] = mapped_column(Text, default="")
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_option: Mapped[str] = mapped_column(String(50), default="none")
    platform: Mapped[str] = mapped_column(String(50), default="facebook")
    tone: Mapped[str] = mapped_column(String(50), default="professional")
    status: Mapped[str] = mapped_column(String(50), default="draft")
    # Platform-issued ID returned at publish time. Format varies by provider:
    #   facebook  -> "{page_id}_{post_id}"
    #   instagram -> media id (numeric)
    #   linkedin  -> activity URN ("urn:li:activity:...")
    #   youtube   -> 11-char video id
    #   devto     -> article id (int as string)
    #   reddit    -> fullname ("t3_xxxxx")
    # Stored opaquely; each provider's analytics fetcher knows how to parse it.
    external_post_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # When status == "scheduled", the background scheduler publishes at this time (UTC).
    scheduled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    user: Mapped["User"] = relationship(back_populates="posts")  # type: ignore  # noqa: F821
