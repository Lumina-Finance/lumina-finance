"""remember when a bank link's import ended

Revision ID: e5a8c1f7b3d9
Revises: b3f1c9a7d2e4
Create Date: 2026-10-08
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "e5a8c1f7b3d9"
down_revision: str | Sequence[str] | None = "b3f1c9a7d2e4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add when each link's latest import ended. That tells the items it brought from those later syncs brought

    The opening adjustment waits until no item the import brought is still waiting for review. Links
    already stored have no time, so one whose import has already ended is never offered the
    adjustment, while one still importing gets its time when the import ends
    """
    op.add_column("bank_account_links", sa.Column("import_ended_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Drop the time

    The earlier code never offers the adjustment, so nothing reads it. Once it is added back, a link
    whose import ended in between is never offered the adjustment, and an offer already made stays
    """
    op.drop_column("bank_account_links", "import_ended_at")
