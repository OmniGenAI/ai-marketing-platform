import uuid
from datetime import datetime, timezone

from sqlalchemy import String, Boolean, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    supabase_id: Mapped[str | None] = mapped_column(
        String(36), unique=True, index=True, nullable=True
    )
    name: Mapped[str] = mapped_column(String(255))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    hashed_password: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    role: Mapped[str] = mapped_column(String(50), default="user")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    subscription: Mapped["Subscription"] = relationship(back_populates="user")  # type: ignore  # noqa: F821
    wallet: Mapped["Wallet"] = relationship(back_populates="user")  # type: ignore  # noqa: F821
    business_config: Mapped["BusinessConfig"] = relationship(back_populates="user")  # type: ignore  # noqa: F821
    posts: Mapped[list["Post"]] = relationship(back_populates="user")  # type: ignore  # noqa: F821
    social_accounts: Mapped[list["SocialAccount"]] = relationship(back_populates="user")  # type: ignore  # noqa: F821
    business_images: Mapped[list["BusinessImage"]] = relationship(back_populates="user")  # type: ignore  # noqa: F821
    reels: Mapped[list["Reel"]] = relationship(back_populates="user")  # type: ignore  # noqa: F821
    seo_saves: Mapped[list["SeoSave"]] = relationship(back_populates="user")  # type: ignore  # noqa: F821
    posters: Mapped[list["Poster"]] = relationship(back_populates="user")  # type: ignore  # noqa: F821