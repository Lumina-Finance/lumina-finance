"""record when a reset link was emailed

Revision ID: d4b8f2a6c1e3
Revises: c5d2a8f1b7e3
Create Date: 2026-10-27 00:30:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d4b8f2a6c1e3"
down_revision: str | Sequence[str] | None = "c5d2a8f1b7e3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the time a link was handed to the mail server, so a link never emailed can be told apart

    Every row that names a user was a real send before this, so it counts as emailed when it was created
    and nobody gets a fresh allowance or loses a live link
    """
    op.add_column("password_reset_tokens", sa.Column("emailed_at", sa.DateTime(timezone=True), nullable=True))
    op.execute("UPDATE password_reset_tokens SET emailed_at = created_at WHERE user_id IS NOT NULL")


def downgrade() -> None:
    """Drop the column, so every stored link counts as sent again"""
    op.drop_column("password_reset_tokens", "emailed_at")
