"""Add the change marker for data every user sees.

Revision ID: a41d6e0c93b7
Revises: c5e8a2f1d7b3
Create Date: 2026-11-19
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.db.rls import secure_registered_table

revision: str = "a41d6e0c93b7"
down_revision: str | Sequence[str] | None = "c5e8a2f1d7b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the single-row table and secure it, leaving it empty until the first shared change"""
    op.create_table(
        "shared_cache_state",
        sa.Column("id", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("changed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("id", name="ck_shared_cache_state_single_row"),
        sa.PrimaryKeyConstraint("id"),
    )
    secure_registered_table(op.get_bind(), "shared_cache_state")


def downgrade() -> None:
    """Drop the table, which removes its policy and grants. Shared changes made meanwhile are no longer recorded"""
    op.drop_table("shared_cache_state")
