"""plan links a bank sync job found failing last

Revision ID: e9b4d1f7a2c6
Revises: c4e8a2f6b1d3
Create Date: 2026-10-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "e9b4d1f7a2c6"
down_revision: str | Sequence[str] | None = "c4e8a2f6b1d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the links a queued job plans only once no other link is due, since an earlier job couldn't bring them back whole

    Jobs already queued defer nothing, so each tries its links in the order it plans them
    """
    op.add_column(
        "bank_sync_jobs",
        sa.Column("deferred_link_ids", postgresql.ARRAY(sa.Uuid()), nullable=False, server_default="{}"),
    )


def downgrade() -> None:
    """Drop the deferred links

    Losing them only lets a queued job try a failing link before the others again, so they don't
    hold the rollback back
    """
    op.drop_column("bank_sync_jobs", "deferred_link_ids")
