"""add saved insights ranges

Revision ID: e7a1c3b9d2f4
Revises: d3f7b1a2c4e9
Create Date: 2026-06-18 11:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.db.rls import secure_registered_table

revision: str = "e7a1c3b9d2f4"
down_revision: str | Sequence[str] | None = "d3f7b1a2c4e9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the saved insights ranges table and enable its row-level security"""
    op.create_table(
        "saved_insights_ranges",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.VARCHAR(length=64), nullable=False),
        sa.Column("amount", sa.SmallInteger(), nullable=False),
        sa.Column("unit", sa.VARCHAR(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "name", name="uq_saved_insights_range_user_name"),
        sa.CheckConstraint("amount > 0", name="ck_saved_insights_range_amount_positive"),
        sa.CheckConstraint(
            "unit IN ('day', 'week', 'month', 'quarter', 'year')",
            name="ck_saved_insights_range_unit",
        ),
    )
    secure_registered_table(op.get_bind(), "saved_insights_ranges")


def downgrade() -> None:
    """Drop the saved insights ranges table, which removes its policy and grants"""
    op.drop_table("saved_insights_ranges")
