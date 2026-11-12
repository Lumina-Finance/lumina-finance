"""rename proposed fields to previous values

Revision ID: a09b7553ab1a
Revises: e9b4d1f7a2c6
Create Date: 2026-10-05
"""

from collections.abc import Sequence

from alembic import op

revision: str = "a09b7553ab1a"
down_revision: str | Sequence[str] | None = "e9b4d1f7a2c6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Rename the column holding the bank's values before a correction after what it holds

    Every stored value is kept, and the review state check follows the column to its new name
    """
    op.alter_column("bank_transactions", "proposed_fields", new_column_name="previous_values")


def downgrade() -> None:
    """Restore the earlier column name, keeping every stored value"""
    op.alter_column("bank_transactions", "previous_values", new_column_name="proposed_fields")
