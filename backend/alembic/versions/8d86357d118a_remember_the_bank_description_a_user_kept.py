"""remember the bank description a user kept

Revision ID: 8d86357d118a
Revises: c4d7a2e9f1b6
Create Date: 2026-10-08
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "8d86357d118a"
down_revision: str | Sequence[str] | None = "c4d7a2e9f1b6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Only an accepted record carries review state, before and after the kept description joins it
_REVIEW_STATE_BEFORE = (
    "disposition = 'accepted' OR (aligned_amount IS NULL AND open_kind IS NULL "
    "AND previous_values IS NULL AND declined_observation IS NULL AND removed_at IS NULL)"
)
_REVIEW_STATE_AFTER = (
    "disposition = 'accepted' OR (aligned_amount IS NULL AND open_kind IS NULL AND previous_values IS NULL "
    "AND declined_observation IS NULL AND removed_at IS NULL AND kept_description IS NULL)"
)


def upgrade() -> None:
    """Add the bank description each user kept with Keep current value over a later one

    Stored records have none, since nothing kept the description before this, so a description
    kept earlier still reads as the later one the user declined, and the bank sending the kept one
    again opens a correction once more. Only an accepted record may hold one
    """
    op.add_column("bank_transactions", sa.Column("kept_description", sa.Text(), nullable=True))
    op.drop_constraint("ck_bank_transactions_review_state", "bank_transactions", type_="check")
    op.create_check_constraint("ck_bank_transactions_review_state", "bank_transactions", _REVIEW_STATE_AFTER)


def downgrade() -> None:
    """Drop the kept descriptions and restore the earlier check

    A transaction whose description the user kept then reads the bank's latest as its own again, so
    the bank sending the kept one again opens a correction. Accept or Keep closes it. Nothing in
    the ledger or its balances depends on them, so they don't hold the rollback back
    """
    op.drop_constraint("ck_bank_transactions_review_state", "bank_transactions", type_="check")
    op.create_check_constraint("ck_bank_transactions_review_state", "bank_transactions", _REVIEW_STATE_BEFORE)
    op.drop_column("bank_transactions", "kept_description")
