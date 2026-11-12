"""mark a bank connection's request budget spent

Revision ID: c4e8a2f6b1d3
Revises: a8d3f6b2c5e1
Create Date: 2026-10-04
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c4e8a2f6b1d3"
down_revision: str | Sequence[str] | None = "a8d3f6b2c5e1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add when a connection's request budget frees again after the provider says its quota is spent"""
    op.add_column("bank_connections", sa.Column("request_budget_spent_until", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Drop the spent mark

    It lasts at most 24 hours, and losing it only lets the next request go out before then, so it
    doesn't hold the rollback back
    """
    op.drop_column("bank_connections", "request_budget_spent_until")
