"""add scheduled_at to posts

Revision ID: j0k1l2m3n4o5
Revises: 63207d3bc469
Create Date: 2026-05-08

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = 'j0k1l2m3n4o5'
down_revision: str = '63207d3bc469'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'posts',
        sa.Column('scheduled_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('posts', 'scheduled_at')
