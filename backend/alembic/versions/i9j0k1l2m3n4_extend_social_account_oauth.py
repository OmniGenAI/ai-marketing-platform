"""extend_social_account_oauth_columns_and_post_external_id

Adds columns required for multi-platform OAuth (LinkedIn, YouTube, Dev.to,
Reddit) and per-post analytics tracking via `posts.external_post_id`.

Revision ID: i9j0k1l2m3n4
Revises: h8i9j0k1l2m3
Create Date: 2026-04-30 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "i9j0k1l2m3n4"
down_revision: Union[str, Sequence[str], None] = "h8i9j0k1l2m3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # social_accounts: extra fields needed for OAuth refresh + per-platform metadata
    op.add_column(
        "social_accounts",
        sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "social_accounts",
        sa.Column("scope", sa.String(length=500), nullable=True),
    )
    op.add_column(
        "social_accounts",
        sa.Column("provider_user_id", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "social_accounts",
        sa.Column("extra_metadata", sa.Text(), nullable=True),
    )
    op.add_column(
        "social_accounts",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    # posts: store the platform-issued post ID so analytics can be fetched later
    op.add_column(
        "posts",
        sa.Column("external_post_id", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("posts", "external_post_id")
    op.drop_column("social_accounts", "updated_at")
    op.drop_column("social_accounts", "extra_metadata")
    op.drop_column("social_accounts", "provider_user_id")
    op.drop_column("social_accounts", "scope")
    op.drop_column("social_accounts", "token_expires_at")
