"""record when a provider removes a bank transaction

Revision ID: fd0604d3f3c4
Revises: 4c7a9e2b6d15
Create Date: 2026-10-05
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "fd0604d3f3c4"
down_revision: str | Sequence[str] | None = "4c7a9e2b6d15"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Only an accepted record carries review state, before and after the removal time joins it
_REVIEW_STATE_BEFORE = (
    "disposition = 'accepted' OR (aligned_amount IS NULL AND open_kind IS NULL "
    "AND previous_values IS NULL AND declined_observation IS NULL)"
)
_REVIEW_STATE_AFTER = (
    "disposition = 'accepted' OR (aligned_amount IS NULL AND open_kind IS NULL "
    "AND previous_values IS NULL AND declined_observation IS NULL AND removed_at IS NULL)"
)


def upgrade() -> None:
    """Add when the provider reported each accepted bank transaction removed, so the same removal sent again opens nothing

    Every stored record reads as one the provider still lists, and each is one, since nothing opened a
    removal before this. Only an accepted record may carry the time, and a removal under review
    needs it
    """
    op.add_column("bank_transactions", sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True))
    op.drop_constraint("ck_bank_transactions_review_state", "bank_transactions", type_="check")
    op.create_check_constraint("ck_bank_transactions_review_state", "bank_transactions", _REVIEW_STATE_AFTER)
    op.create_check_constraint("ck_bank_transactions_removal", "bank_transactions", "open_kind <> 'removal' OR removed_at IS NOT NULL")


def downgrade() -> None:
    """Drop the removal times and their checks

    A removal still waiting stays waiting. Losing the times means only that a removal the user kept
    opens again if the provider sends it again, and no provider this release supports reports
    removals, so they don't hold the rollback back
    """
    op.drop_constraint("ck_bank_transactions_removal", "bank_transactions", type_="check")
    op.drop_constraint("ck_bank_transactions_review_state", "bank_transactions", type_="check")
    op.create_check_constraint("ck_bank_transactions_review_state", "bank_transactions", _REVIEW_STATE_BEFORE)
    op.drop_column("bank_transactions", "removed_at")
