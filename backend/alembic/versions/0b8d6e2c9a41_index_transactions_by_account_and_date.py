"""Index transactions by account and date

Revision ID: 0b8d6e2c9a41
Revises: 51c17506619a
Create Date: 2026-09-18
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0b8d6e2c9a41"
down_revision: str | Sequence[str] | None = "51c17506619a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the account/date index without changing ledger rows or existing indexes"""
    op.create_index("ix_transactions_account_id_dt", "transactions", ["account_id", "dt"], unique=False)


def downgrade() -> None:
    """Remove only the account/date index"""
    op.drop_index("ix_transactions_account_id_dt", table_name="transactions")
