"""sync the links a user asks to sync now

Revision ID: 7d2f9b4e1c63
Revises: 41c7632d0ef5
Create Date: 2026-10-06
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "7d2f9b4e1c63"
down_revision: str | Sequence[str] | None = "41c7632d0ef5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the links a queued job syncs whatever their next daily time, since the user asked to sync them now

    Jobs already queued were asked for none, so each syncs the links due as before
    """
    op.add_column(
        "bank_sync_jobs",
        sa.Column("requested_link_ids", postgresql.ARRAY(sa.Uuid()), nullable=False, server_default="{}"),
    )


def downgrade() -> None:
    """Drop the requested links

    Losing them only leaves a Sync now still queued to sync its account at its next daily time, so
    they don't hold the rollback back
    """
    op.drop_column("bank_sync_jobs", "requested_link_ids")
