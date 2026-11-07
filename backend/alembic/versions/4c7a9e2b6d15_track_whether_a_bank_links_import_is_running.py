"""track whether a bank link's import is running

Revision ID: 4c7a9e2b6d15
Revises: a09b7553ab1a
Create Date: 2026-10-05
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "4c7a9e2b6d15"
down_revision: str | Sequence[str] | None = "a09b7553ab1a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add whether each link's latest import is still running. The review pause waits for it

    Links already stored count as importing until their next sync reaches today, so none pauses
    part way through an import running now
    """
    op.add_column("bank_account_links", sa.Column("importing", sa.Boolean(), nullable=False, server_default="true"))


def downgrade() -> None:
    """Drop the flag

    Losing it means only that, once it is added back, every link counts as importing until its next
    sync reaches today, so it doesn't hold the rollback back. A link paused for review stays paused
    after the rollback, and the earlier code never lifts a pause, so its account doesn't sync until
    the pause is cleared by hand
    """
    op.drop_column("bank_account_links", "importing")
