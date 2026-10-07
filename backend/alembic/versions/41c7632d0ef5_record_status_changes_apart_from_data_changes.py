"""record status changes apart from data changes

Revision ID: 41c7632d0ef5
Revises: fd0604d3f3c4
Create Date: 2026-10-07
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "41c7632d0ef5"
down_revision: str | Sequence[str] | None = "fd0604d3f3c4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add when bank sync last changed what a user's pages show without changing their ledger

    Every user starts without one, so pages read their data marker alone until the next sync
    """
    op.add_column("user_cache_states", sa.Column("status_changed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Drop the status times, leaving each page to notice a sync's next data change instead"""
    op.drop_column("user_cache_states", "status_changed_at")
