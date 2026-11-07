"""add bank holds

Revision ID: b5e2c8a1d9f3
Revises: a2d7f4c8e1b6
Create Date: 2026-10-29
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.db.downgrade_guard import refuse_while_tables_hold_rows
from app.db.rls import secure_registered_table

revision: str = "b5e2c8a1d9f3"
down_revision: str | Sequence[str] | None = "a2d7f4c8e1b6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the bank holds table, empty, and enable its row-level security

    Nothing existing changes: holds appear only once a linked account syncs a record of no amount.
    Until now such a record waited in review where it could not be approved
    """
    op.create_table(
        "bank_holds",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.VARCHAR(length=32), nullable=False),
        sa.Column("external_account_id", sa.Text(), nullable=False),
        sa.Column("external_transaction_hash", sa.VARCHAR(length=64), nullable=False),
        sa.Column("hold_date", sa.Date(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("dismissed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "account_id",
            "provider",
            "external_account_id",
            "external_transaction_hash",
            name="uq_bank_holds_identity",
        ),
    )
    op.create_index("ix_bank_holds_account_id", "bank_holds", ["account_id"])
    secure_registered_table(op.get_bind(), "bank_holds")


def downgrade() -> None:
    """Drop the bank holds table, refusing while it holds a record

    The holds are only a display, and a dismissal is the user's choice, so the rollback refuses
    like the other bank sync tables rather than drop it
    """
    refuse_while_tables_hold_rows(op.get_bind(), {"bank_holds": "the zero-amount bank records shown as holds"})
    op.drop_table("bank_holds")
