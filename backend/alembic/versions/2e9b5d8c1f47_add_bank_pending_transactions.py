"""add pending bank transactions

Revision ID: 2e9b5d8c1f47
Revises: c1f4a7e3d926
Create Date: 2026-10-04
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.db.downgrade_guard import refuse_while_tables_hold_rows
from app.db.rls import secure_registered_table

revision: str = "2e9b5d8c1f47"
down_revision: str | Sequence[str] | None = "c1f4a7e3d926"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the pending bank transactions table, empty, and enable its row-level security

    Nothing existing changes: pending items appear only once a linked account syncs
    """
    op.create_table(
        "bank_pending_transactions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("external_transaction_id", sa.Text(), nullable=False),
        sa.Column("transaction_date", sa.Date(), nullable=False),
        sa.Column("amount", sa.BigInteger(), nullable=True),
        sa.Column("raw_amount", sa.Text(), nullable=True),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("(amount IS NULL) <> (raw_amount IS NULL)", name="ck_bank_pending_transactions_amount"),
    )
    op.create_index("ix_bank_pending_transactions_account_id", "bank_pending_transactions", ["account_id"])
    secure_registered_table(op.get_bind(), "bank_pending_transactions")


def downgrade() -> None:
    """Drop the pending bank transactions table, refusing while it holds an item

    The items are only a display of what the bank hasn't posted, and the next sync would fetch
    them again, but the rollback refuses like the other bank sync tables rather than drop data
    """
    refuse_while_tables_hold_rows(
        op.get_bind(), {"bank_pending_transactions": "the pending bank transactions shown on linked accounts"},
    )
    op.drop_table("bank_pending_transactions")
