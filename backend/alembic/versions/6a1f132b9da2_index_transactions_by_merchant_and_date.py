"""Index transactions by merchant and date.

The merchant listing sums a per-transaction weight over a bounded date range for each merchant,
which the single-column index could not restrict, so every one of a merchant's rows was read and
the ones outside the range discarded. Leading the new index on merchant_id keeps every lookup the
single-column one served, which is why that one is dropped rather than left to be maintained on
every write for nothing.

Revision ID: 6a1f132b9da2
Revises: 9563defdb8fd
Create Date: 2026-08-05 23:59:30.236397

"""

from collections.abc import Sequence

from alembic import op

revision: str = "6a1f132b9da2"
down_revision: str | Sequence[str] | None = "9563defdb8fd"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_index(op.f("ix_transactions_merchant_id"), table_name="transactions")
    op.create_index("ix_transactions_merchant_id_dt", "transactions", ["merchant_id", "dt"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_transactions_merchant_id_dt", table_name="transactions")
    op.create_index(op.f("ix_transactions_merchant_id"), "transactions", ["merchant_id"], unique=False)
