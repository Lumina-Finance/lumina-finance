"""flag an available balance that can't be read

Revision ID: b3f1c9a7d2e4
Revises: 7d2f9b4e1c63
Create Date: 2026-10-07
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b3f1c9a7d2e4"
down_revision: str | Sequence[str] | None = "7d2f9b4e1c63"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Record whether a bank account's available balance came but can't be read exactly, apart from one never sent

    Bank accounts already stored read as never sent until their next listing or sync reads them again
    """
    op.add_column(
        "bank_external_accounts",
        sa.Column("available_balance_unreadable", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade() -> None:
    """Drop the flag

    The next listing or sync reads the balances again, so losing it only shows an unreadable
    available balance as never sent until then
    """
    op.drop_column("bank_external_accounts", "available_balance_unreadable")
