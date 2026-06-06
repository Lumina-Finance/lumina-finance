"""add cache change state

Revision ID: c9e5d4a1b2f0
Revises: 59b2a047c3ad
Create Date: 2026-06-06 00:00:00.000000

"""
from typing import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "c9e5d4a1b2f0"
down_revision: str | Sequence[str] | None = "59b2a047c3ad"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "user_cache_states",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("changed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )
    op.create_table(
        "group_cache_states",
        sa.Column("group_id", sa.UUID(), nullable=False),
        sa.Column("changed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["group_id"], ["groups.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("group_id"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("group_cache_states")
    op.drop_table("user_cache_states")
