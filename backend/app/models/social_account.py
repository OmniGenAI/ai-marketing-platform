import uuid
from datetime import datetime, timezone

from sqlalchemy import String, DateTime, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class SocialAccount(Base):
    __tablename__ = "social_accounts"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    # facebook | instagram | linkedin | youtube | devto | reddit
    platform: Mapped[str] = mapped_column(String(50))
    access_token: Mapped[str] = mapped_column(Text, default="")
    refresh_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    # When the access_token expires. Null for tokens that don't expire (rare)
    # or where the platform doesn't tell us (older long-lived tokens).
    token_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Snapshot of granted scopes at connect time — used to detect when a
    # newly-required permission means we have to re-prompt the user.
    scope: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Provider's stable user/account identifier, separate from page_id which
    # represents the publishing target (FB page, IG business account, YT channel).
    provider_user_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    page_id: Mapped[str] = mapped_column(String(255), default="")
    page_name: Mapped[str] = mapped_column(String(255), default="")
    # Free-form JSON for platform-specific fields (channel handle, subreddit
    # whitelist, dev.to org_id, etc). Keeps the schema stable while allowing
    # per-provider extras.
    extra_metadata: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    user: Mapped["User"] = relationship(back_populates="social_accounts")  # type: ignore  # noqa: F821
