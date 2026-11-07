"""add account review preferences

Revision ID: 9d2c6e1a4b58
Revises: 5b8e2d4f7a13
Create Date: 2026-10-04
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.db.downgrade_guard import refuse_while_tables_hold_rows
from app.db.rls import secure_registered_table

revision: str = "9d2c6e1a4b58"
down_revision: str | Sequence[str] | None = "5b8e2d4f7a13"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the review preferences table, empty, and enable its row-level security

    Every existing account has no row and reads as Review all, so nothing is backfilled
    """
    op.create_table(
        "account_review_preferences",
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("new_transactions", sa.VARCHAR(length=8), server_default="review", nullable=False),
        sa.Column("corrections", sa.VARCHAR(length=8), server_default="review", nullable=False),
        sa.Column("removals", sa.VARCHAR(length=8), server_default="review", nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("account_id"),
        sa.CheckConstraint(
            "new_transactions IN ('review', 'trust')", name="ck_account_review_preferences_new_transactions",
        ),
        sa.CheckConstraint("corrections IN ('review', 'trust')", name="ck_account_review_preferences_corrections"),
        sa.CheckConstraint("removals IN ('review', 'trust')", name="ck_account_review_preferences_removals"),
    )
    secure_registered_table(op.get_bind(), "account_review_preferences")


def downgrade() -> None:
    """Drop the review preferences table, refusing while any account has stored choices

    Dropping it would put every account back on Review all, silently undoing each choice to
    trust the bank, so the rollback refuses rather than forget them
    """
    refuse_while_tables_hold_rows(
        op.get_bind(), {"account_review_preferences": "the review preferences users set on their accounts"},
    )
    op.drop_table("account_review_preferences")
