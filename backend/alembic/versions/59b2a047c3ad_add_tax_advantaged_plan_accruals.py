"""Add tax-advantaged plan accrual baselines.

Revision ID: 59b2a047c3ad
Revises: 3f8a2f1c9d7b
Create Date: 2026-06-05 00:00:00.000000
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "59b2a047c3ad"
down_revision: str | Sequence[str] | None = "3f8a2f1c9d7b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "tax_advantaged_plans",
        sa.Column(
            "accrued_contributions",
            sa.BigInteger(),
            server_default="0",
            nullable=False,
        ),
    )
    op.add_column(
        "tax_advantaged_plan_limits",
        sa.Column("accrued_contributions", sa.BigInteger(), server_default="0", nullable=False),
    )
    op.add_column(
        "tax_advantaged_plan_limits",
        sa.Column("accrued_withdrawals", sa.BigInteger(), server_default="0", nullable=False),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("tax_advantaged_plan_limits", "accrued_withdrawals")
    op.drop_column("tax_advantaged_plan_limits", "accrued_contributions")
    op.drop_column("tax_advantaged_plans", "accrued_contributions")
