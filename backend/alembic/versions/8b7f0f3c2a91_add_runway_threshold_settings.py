"""add runway threshold settings

Revision ID: 8b7f0f3c2a91
Revises: 12adf8266729
Create Date: 2026-05-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8b7f0f3c2a91'
down_revision: Union[str, Sequence[str], None] = '12adf8266729'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'users',
        sa.Column('runway_risky_below_months', sa.Float(), server_default='1', nullable=False),
    )
    op.add_column(
        'users',
        sa.Column('runway_healthy_at_months', sa.Float(), server_default='3', nullable=False),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('users', 'runway_healthy_at_months')
    op.drop_column('users', 'runway_risky_below_months')
