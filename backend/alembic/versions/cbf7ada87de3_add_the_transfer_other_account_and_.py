"""add the transfer other account and internal transfer counting

Revision ID: cbf7ada87de3
Revises: b60d4ea6d7e2
Create Date: 2026-07-31 16:19:48.406792
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "cbf7ada87de3"
down_revision: str | Sequence[str] | None = "b60d4ea6d7e2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Record the other side of a transfer, and whether a category counts its own internal ones"""

    # Existing categories take the new behaviour, which leaves internal transfers out of the totals
    op.add_column(
        "tax_advantaged_categories",
        sa.Column("counts_internal_transfers", sa.Boolean(), nullable=False, server_default="false"),
    )

    # Created explicitly, since adding a column typed with an enum does not build the type
    other_account_scope = postgresql.ENUM(
        "TRACKED", "OUTSIDE", name="transferotheraccountscope", create_type=False,
    )
    other_account_scope.create(op.get_bind(), checkfirst=True)

    # Both columns stay empty on every transaction predating them, which reads as unanswered
    op.add_column("transactions", sa.Column("other_account_id", sa.Uuid(), nullable=True))
    op.add_column("transactions", sa.Column("other_account_scope", other_account_scope, nullable=True))
    op.create_index(op.f("ix_transactions_other_account_id"), "transactions", ["other_account_id"], unique=False)

    # Refusing rather than cascading, since a transfer in another account keeps its own row when
    # the account it records is deleted. Deferred to the commit, because deleting a group cascades
    # into its accounts and their transactions in one statement and an immediate check fires or
    # not depending on which physical row it reaches first
    op.create_foreign_key(
        "fk_transactions_other_account_id_accounts",
        "transactions",
        "accounts",
        ["other_account_id"],
        ["id"],
        ondelete="NO ACTION",
        deferrable=True,
        initially="DEFERRED",
    )

    # Null-safe on both sides, so an account recorded without a scope is rejected rather than
    # passing on an unknown comparison
    op.create_check_constraint(
        "ck_transactions_other_account_scope_matches_id",
        "transactions",
        "(other_account_id IS NOT NULL) = (other_account_scope IS NOT DISTINCT FROM 'TRACKED')",
    )


def downgrade() -> None:
    """Drop both transfer columns, their constraints, and the internal transfer setting"""
    op.drop_constraint("ck_transactions_other_account_scope_matches_id", "transactions", type_="check")
    op.drop_constraint("fk_transactions_other_account_id_accounts", "transactions", type_="foreignkey")
    op.drop_index(op.f("ix_transactions_other_account_id"), table_name="transactions")
    op.drop_column("transactions", "other_account_scope")
    op.drop_column("transactions", "other_account_id")
    op.drop_column("tax_advantaged_categories", "counts_internal_transfers")

    # Dropping the column leaves the enum type behind, so it goes explicitly
    postgresql.ENUM(name="transferotheraccountscope").drop(op.get_bind(), checkfirst=True)
