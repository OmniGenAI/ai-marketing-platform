"""cleanup_business_config

Revision ID: g7h8i9j0k1l2
Revises: e5f6a7b8c9d0
Create Date: 2026-04-21 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'g7h8i9j0k1l2'
down_revision: Union[str, Sequence[str], None] = ('c9d0e1f2a3b4', 'e5f6a7b8c9d0')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Remove unused fields, add location and competitors."""
    op.add_column('business_configs', sa.Column('location', sa.String(length=255), nullable=True))
    op.add_column('business_configs', sa.Column('competitors', sa.Text(), nullable=True))
    op.drop_column('business_configs', 'email')
    op.drop_column('business_configs', 'phone')
    op.drop_column('business_configs', 'address')
    op.drop_column('business_configs', 'platform_preference')


def downgrade() -> None:
    """Restore removed fields, drop location and competitors."""
    op.add_column('business_configs', sa.Column('platform_preference', sa.String(length=100), nullable=True))
    op.add_column('business_configs', sa.Column('address', sa.Text(), nullable=True))
    op.add_column('business_configs', sa.Column('phone', sa.String(length=50), nullable=True))
    op.add_column('business_configs', sa.Column('email', sa.String(length=255), nullable=True))
    op.drop_column('business_configs', 'competitors')
    op.drop_column('business_configs', 'location')
