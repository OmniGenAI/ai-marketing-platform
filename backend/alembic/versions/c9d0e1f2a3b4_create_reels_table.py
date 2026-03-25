"""create_reels_table

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-03-25 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c9d0e1f2a3b4'
down_revision: Union[str, Sequence[str], None] = 'b8c9d0e1f2a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create reels table."""
    op.create_table('reels',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('topic', sa.String(length=500), nullable=False),
        sa.Column('tone', sa.String(length=50), nullable=False, server_default='professional'),
        sa.Column('voice', sa.String(length=100), nullable=False, server_default='en-US-JennyNeural'),
        sa.Column('duration_target', sa.Integer(), nullable=False, server_default='30'),
        sa.Column('script', sa.Text(), nullable=True),
        sa.Column('hashtags', sa.Text(), nullable=True),
        sa.Column('audio_url', sa.Text(), nullable=True),
        sa.Column('video_url', sa.Text(), nullable=True),
        sa.Column('thumbnail_url', sa.Text(), nullable=True),
        sa.Column('status', sa.String(length=50), nullable=False, server_default='pending'),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('platform', sa.String(length=50), nullable=False, server_default='instagram'),
        sa.Column('published_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('instagram_media_id', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_reels_user_id', 'reels', ['user_id'])
    op.create_index('ix_reels_status', 'reels', ['status'])


def downgrade() -> None:
    """Drop reels table."""
    op.drop_index('ix_reels_status', table_name='reels')
    op.drop_index('ix_reels_user_id', table_name='reels')
    op.drop_table('reels')
