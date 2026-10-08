"""remember the history a bank link's import or catch-up fell short of

Revision ID: c4d7a2e9f1b6
Revises: e5a8c1f7b3d9
Create Date: 2026-10-08
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c4d7a2e9f1b6"
down_revision: str | Sequence[str] | None = "e5a8c1f7b3d9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the reminder each link shows about history the bank may not have returned

    The reminder names the day an import or catch-up asked from and the earliest booked transaction
    it got. Links already stored have none, so only imports and catch-ups from now on raise one
    """
    op.add_column("bank_account_links", sa.Column("history_reminder_start", sa.Date(), nullable=True))
    op.add_column("bank_account_links", sa.Column("history_reminder_earliest", sa.Date(), nullable=True))


def downgrade() -> None:
    """Drop the reminder

    The earlier code never shows it, so nothing reads it. Once it is added back, a reminder raised
    in between is gone, dismissed or not, and only later imports and catch-ups raise one
    """
    op.drop_column("bank_account_links", "history_reminder_earliest")
    op.drop_column("bank_account_links", "history_reminder_start")
