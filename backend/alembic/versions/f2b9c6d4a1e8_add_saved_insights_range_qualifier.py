"""add saved insights range qualifier

Revision ID: f2b9c6d4a1e8
Revises: e7a1c3b9d2f4
Create Date: 2026-06-19 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "f2b9c6d4a1e8"
down_revision: str | Sequence[str] | None = "e7a1c3b9d2f4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the qualifier column distinguishing this, last, and past range anchoring"""

    # Existing rows predate the builder and were all rolling windows, so default them to past
    op.add_column(
        "saved_insights_ranges",
        sa.Column("qualifier", sa.VARCHAR(length=16), nullable=False, server_default="past"),
    )
    op.create_check_constraint(
        "ck_saved_insights_range_qualifier",
        "saved_insights_ranges",
        "qualifier IN ('this', 'last', 'past')",
    )


def downgrade() -> None:
    """Drop the qualifier column and its check constraint"""
    op.drop_constraint("ck_saved_insights_range_qualifier", "saved_insights_ranges", type_="check")
    op.drop_column("saved_insights_ranges", "qualifier")
