"""add_post_image_option

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-03-17 10:03:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b8c9d0e1f2a3'
down_revision: Union[str, Sequence[str], None] = 'a7b8c9d0e1f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add image_option column to posts table."""
    op.add_column('posts', sa.Column('image_option', sa.String(length=50), nullable=False, server_default='none'))


def downgrade() -> None:
    """Remove image_option column from posts table."""
    op.drop_column('posts', 'image_option')
