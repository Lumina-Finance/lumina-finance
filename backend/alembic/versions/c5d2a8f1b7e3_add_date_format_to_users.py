"""add date format to users

Revision ID: c5d2a8f1b7e3
Revises: c5a1e7d3b926
Create Date: 2026-10-25 18:50:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c5d2a8f1b7e3"
down_revision: str | Sequence[str] | None = "c5a1e7d3b926"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the date format preference, which every existing user starts on as month-day-year, the way dates were written"""
    # Bounds this revision's statements, so a deploy blocked behind a long-running request fails
    # instead of queueing an exclusive lock on users that stalls every authenticated request. Every
    # pending revision runs in one transaction, so the setting is reset below rather than left to
    # bound the revisions after this one
    op.execute(sa.text("SET LOCAL lock_timeout = '5s'"))

    op.add_column("users", sa.Column("date_format", sa.VARCHAR(length=32), server_default="month-day-year", nullable=False))
    op.create_check_constraint(
        "ck_users_date_format",
        "users",
        "date_format IN ('month-day-year', 'day-month-year', 'iso')",
    )

    op.execute(sa.text("SET LOCAL lock_timeout = DEFAULT"))


def downgrade() -> None:
    """Drop the date format preference, losing any format a user chose"""
    op.drop_constraint("ck_users_date_format", "users", type_="check")
    op.drop_column("users", "date_format")
