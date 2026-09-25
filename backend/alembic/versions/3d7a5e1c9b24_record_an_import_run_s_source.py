"""record an import run's source, budgets and accounts to archive

Revision ID: 3d7a5e1c9b24
Revises: 6b4c1a2d9e70
Create Date: 2026-09-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "3d7a5e1c9b24"
down_revision: str | Sequence[str] | None = "6b4c1a2d9e70"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add which importer opened a run, and what a provider import writes after its transactions

    Each column is defaulted in the database, so a run already staged when this reaches a
    deployment reads as the generic CSV import it was, with no budgets and nothing to archive
    """
    op.add_column("import_runs", sa.Column("source", sa.VARCHAR(length=32), server_default="generic", nullable=False))
    op.create_check_constraint(
        "ck_import_runs_source",
        "import_runs",
        "source IN ('generic', 'firefly', 'actual_budget')",
    )
    op.add_column(
        "import_runs",
        sa.Column("budget_drafts", postgresql.JSONB(astext_type=sa.Text()), server_default="[]", nullable=False),
    )
    op.add_column(
        "import_runs",
        sa.Column("archive_account_sources", postgresql.JSONB(astext_type=sa.Text()), server_default="[]", nullable=False),
    )


def downgrade() -> None:
    """Drop them, and every run that is not a generic CSV import with them

    Without its source, a Firefly III run would read as a generic CSV run afterwards: staged, it
    would be committed as the wrong kind, and committed, a repeated commit would answer with a
    summary of the wrong shape. A committed run holds only its summary, so dropping it loses nothing
    in the ledger
    """
    op.execute(sa.text("DELETE FROM import_runs WHERE source <> 'generic'"))
    op.drop_column("import_runs", "archive_account_sources")
    op.drop_column("import_runs", "budget_drafts")
    op.drop_constraint("ck_import_runs_source", "import_runs", type_="check")
    op.drop_column("import_runs", "source")
