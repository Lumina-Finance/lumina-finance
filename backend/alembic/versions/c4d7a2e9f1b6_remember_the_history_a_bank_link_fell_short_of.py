"""remember the history a bank link's import or catch-up fell short of

Revision ID: c4d7a2e9f1b6
Revises: b3f1c9a7d2e4
Create Date: 2026-10-08
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c4d7a2e9f1b6"
down_revision: str | Sequence[str] | None = "b3f1c9a7d2e4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the reminder each link shows about history the bank may not have returned

    One reminder names the day an import or catch-up asked from and the earliest booked transaction
    it got, and another the latest day that still came back as long as the provider's longest
    response. Links already stored have neither, so only imports, catch-ups and days fetched from now
    on raise one
    """
    op.add_column("bank_account_links", sa.Column("history_reminder_start", sa.Date(), nullable=True))
    op.add_column("bank_account_links", sa.Column("history_reminder_earliest", sa.Date(), nullable=True))
    op.add_column("bank_account_links", sa.Column("cut_off_day", sa.Date(), nullable=True))
    op.add_column("bank_account_links", sa.Column("cut_off_day_dismissed", sa.Boolean(), server_default="false", nullable=False))


def downgrade() -> None:
    """Drop the reminders

    The earlier code never shows them, so nothing reads them. Once they are added back, a reminder
    raised in between is gone, dismissed or not, and only later imports, catch-ups and days raise one
    """
    op.drop_column("bank_account_links", "cut_off_day_dismissed")
    op.drop_column("bank_account_links", "cut_off_day")
    op.drop_column("bank_account_links", "history_reminder_earliest")
    op.drop_column("bank_account_links", "history_reminder_start")
