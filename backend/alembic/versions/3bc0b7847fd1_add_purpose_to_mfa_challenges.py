"""add purpose to mfa challenges

Revision ID: 3bc0b7847fd1
Revises: a67a64fe715b
Create Date: 2026-07-05 21:36:14.997889

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3bc0b7847fd1'
down_revision: Union[str, Sequence[str], None] = 'a67a64fe715b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Existing rows were all issued by the login flow, so they backfill as login
    op.add_column("mfa_challenges", sa.Column("purpose", sa.String(), nullable=False, server_default="login"))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("mfa_challenges", "purpose")
