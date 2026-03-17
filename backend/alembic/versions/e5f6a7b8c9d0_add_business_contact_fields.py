"""add_business_contact_fields

Revision ID: e5f6a7b8c9d0
Revises: a1b2c3d4e5f6
Create Date: 2026-03-17 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add contact fields to business_configs table."""
    op.add_column('business_configs', sa.Column('email', sa.String(length=255), nullable=True))
    op.add_column('business_configs', sa.Column('phone', sa.String(length=50), nullable=True))
    op.add_column('business_configs', sa.Column('address', sa.Text(), nullable=True))
    op.add_column('business_configs', sa.Column('website', sa.String(length=500), nullable=True))
    op.add_column('business_configs', sa.Column('website_context', sa.Text(), nullable=True))


def downgrade() -> None:
    """Remove contact fields from business_configs table."""
    op.drop_column('business_configs', 'website_context')
    op.drop_column('business_configs', 'website')
    op.drop_column('business_configs', 'address')
    op.drop_column('business_configs', 'phone')
    op.drop_column('business_configs', 'email')
