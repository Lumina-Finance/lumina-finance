"""keep the bank's ID on each transaction an OFX import writes, once per account

Revision ID: f3a9c1d7b265
Revises: d2a6f9c4e817
Create Date: 2026-10-17 10:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "f3a9c1d7b265"
down_revision: str | Sequence[str] | None = "d2a6f9c4e817"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the bank account key and bank transaction ID columns, the rule keeping them together, and the index holding each once per account

    Every existing transaction gets neither, since none was saved with its bank's ID, so a later
    import never matches one and brings in again whatever an earlier import wrote
    """
    op.add_column("transactions", sa.Column("bank_account_key", sa.VARCHAR(length=255), nullable=True))
    op.add_column("transactions", sa.Column("bank_transaction_id", sa.VARCHAR(length=255), nullable=True))
    op.create_check_constraint(
        "ck_transactions_bank_account_key_matches_bank_transaction_id",
        "transactions",
        "(bank_account_key IS NULL) = (bank_transaction_id IS NULL)",
    )
    op.create_index(
        "uq_transactions_account_bank_transaction",
        "transactions",
        ["account_id", "bank_account_key", "bank_transaction_id"],
        unique=True,
        postgresql_where=sa.text("bank_transaction_id IS NOT NULL"),
    )


def downgrade() -> None:
    """Drop the index, the rule and both columns, which forgets every bank ID kept so far

    The transactions themselves stay. Upgrading again leaves them without an ID, so an import after
    that brings in again every transaction an earlier OFX import wrote
    """
    op.drop_index("uq_transactions_account_bank_transaction", table_name="transactions")
    op.drop_constraint("ck_transactions_bank_account_key_matches_bank_transaction_id", "transactions", type_="check")
    op.drop_column("transactions", "bank_transaction_id")
    op.drop_column("transactions", "bank_account_key")
