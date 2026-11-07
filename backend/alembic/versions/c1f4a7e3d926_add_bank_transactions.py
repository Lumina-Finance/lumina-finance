"""add booked bank transactions and their review state

Revision ID: c1f4a7e3d926
Revises: 9d2c6e1a4b58
Create Date: 2026-10-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op
from app.db.downgrade_guard import refuse_while_tables_hold_rows
from app.db.rls import secure_registered_table

revision: str = "c1f4a7e3d926"
down_revision: str | Sequence[str] | None = "9d2c6e1a4b58"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OBSERVATION_COLUMNS = (
    "observed_date",
    "observed_amount",
    "raw_amount",
    "description",
    "merchant_name",
    "category_hint",
    "extras",
    "observed_at",
)


def upgrade() -> None:
    """Create the bank transactions table, empty, and enable its row-level security

    Ledger transactions gain no column: every existing one has no bank transaction pointing at
    it, so each reads as manual, and each is
    """
    op.create_table(
        "bank_transactions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.VARCHAR(length=32), nullable=False),
        sa.Column("external_account_id", sa.Text(), nullable=False),
        sa.Column("external_transaction_id", sa.Text(), nullable=False),
        sa.Column("disposition", sa.VARCHAR(length=16), nullable=False),
        sa.Column("transaction_id", sa.Uuid(), nullable=True),
        sa.Column("observed_date", sa.Date(), nullable=True),
        sa.Column("observed_amount", sa.BigInteger(), nullable=True),
        sa.Column("raw_amount", sa.Text(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("merchant_name", sa.Text(), nullable=True),
        sa.Column("category_hint", sa.Text(), nullable=True),
        sa.Column("extras", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("aligned_date", sa.Date(), nullable=True),
        sa.Column("aligned_amount", sa.BigInteger(), nullable=True),
        sa.Column("open_kind", sa.VARCHAR(length=16), nullable=True),
        sa.Column("proposed_fields", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("declined_observation", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["transaction_id"], ["transactions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "account_id",
            "provider",
            "external_account_id",
            "external_transaction_id",
            name="uq_bank_transactions_identity",
        ),
        sa.UniqueConstraint("transaction_id", name="uq_bank_transactions_transaction_id"),
        sa.CheckConstraint("provider ~ '^[a-z][a-z0-9_]*$'", name="ck_bank_transactions_provider"),
        sa.CheckConstraint(
            "disposition IN ('awaiting_review', 'accepted', 'dismissed')", name="ck_bank_transactions_disposition",
        ),
        sa.CheckConstraint("open_kind IN ('correction', 'removal')", name="ck_bank_transactions_open_kind"),
        sa.CheckConstraint(
            "(disposition = 'accepted') = (transaction_id IS NOT NULL) "
            "AND (disposition = 'accepted') = (aligned_date IS NOT NULL)",
            name="ck_bank_transactions_accepted",
        ),
        sa.CheckConstraint(
            "disposition = 'accepted' OR (aligned_amount IS NULL AND open_kind IS NULL "
            "AND proposed_fields IS NULL AND declined_observation IS NULL)",
            name="ck_bank_transactions_review_state",
        ),
        sa.CheckConstraint(
            "disposition = 'dismissed' OR (observed_date IS NOT NULL AND description IS NOT NULL "
            "AND observed_at IS NOT NULL AND (observed_amount IS NULL) <> (raw_amount IS NULL))",
            name="ck_bank_transactions_observation",
        ),
        sa.CheckConstraint(
            "disposition <> 'dismissed' OR (" + " AND ".join(f"{column} IS NULL" for column in _OBSERVATION_COLUMNS) + ")",
            name="ck_bank_transactions_dismissed",
        ),
    )
    secure_registered_table(op.get_bind(), "bank_transactions")


def downgrade() -> None:
    """Drop the bank transactions table, refusing while it holds a record

    Dropping it would forget which ledger rows came from a bank, every waiting review item and
    every dismissal, so a later sync would import dismissed and accepted transactions again as
    new items. The rollback refuses rather than lose them
    """
    refuse_while_tables_hold_rows(
        op.get_bind(),
        {"bank_transactions": "bank transaction records, with the review decisions and the bank source of ledger rows"},
    )
    op.drop_table("bank_transactions")
