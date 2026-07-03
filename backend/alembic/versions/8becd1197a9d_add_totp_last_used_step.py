"""add totp last used step

Revision ID: 8becd1197a9d
Revises: 225f37c516bc
Create Date: 2026-06-27 21:31:47.102815
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "8becd1197a9d"
down_revision: str | Sequence[str] | None = "225f37c516bc"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Track the last accepted TOTP step so a code cannot be replayed within its window"""
    op.add_column("totp_credentials", sa.Column("last_used_step", sa.Integer(), nullable=True))


def downgrade() -> None:
    """Drop the replay-tracking column"""
    op.drop_column("totp_credentials", "last_used_step")
