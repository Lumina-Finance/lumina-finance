"""add accounts left out of dashboard credit utilization

Revision ID: 9d2f6b4e7a31
Revises: 9e1b5c3a7d24
Create Date: 2026-10-16 19:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.db.rls import secure_registered_table

revision: str = "9d2f6b4e7a31"
down_revision: str | Sequence[str] | None = "9e1b5c3a7d24"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the table of accounts users leave out of credit utilization, with its row-level security

    Nothing exists to carry over: every credit account keeps counting until its user leaves it out
    """
    op.create_table(
        "user_credit_excluded_accounts",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "account_id"),
    )
    secure_registered_table(op.get_bind(), "user_credit_excluded_accounts")


def downgrade() -> None:
    """Drop the table, which removes its policy and grants

    Every user's choice is lost, so all their credit accounts count toward utilization again
    """
    op.drop_table("user_credit_excluded_accounts")
