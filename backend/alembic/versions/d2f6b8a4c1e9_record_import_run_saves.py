"""Record when an import run's save was requested and why it was refused.

Revision ID: d2f6b8a4c1e9
Revises: a4c8e2f6b1d3
Create Date: 2026-11-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d2f6b8a4c1e9"
down_revision: str | Sequence[str] | None = "a4c8e2f6b1d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the two columns, empty for every run.

    No data is lost. A run staged before this revision has no save requested, and it
    answers that way while it waits to be saved.
    """
    op.add_column("import_runs", sa.Column("save_requested_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("import_runs", sa.Column("save_error", postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    """Drop the two columns.

    Only what is in flight is lost: a save requested but not yet finished is forgotten, so its run
    answers as one never saved and the page offers to save it again. Saved runs keep their summary.
    """
    op.drop_column("import_runs", "save_error")
    op.drop_column("import_runs", "save_requested_at")
