"""Add cache change session.

Revision ID: d4b8c1e9a6f2
Revises: c9e5d4a1b2f0
Create Date: 2026-06-06 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d4b8c1e9a6f2"
down_revision: str | Sequence[str] | None = "c9e5d4a1b2f0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("user_cache_states", sa.Column("last_changed_session_id", sa.UUID(), nullable=True))
    op.add_column("group_cache_states", sa.Column("last_changed_session_id", sa.UUID(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("group_cache_states", "last_changed_session_id")
    op.drop_column("user_cache_states", "last_changed_session_id")
