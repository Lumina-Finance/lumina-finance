"""remember which importer last brought transactions into each account

Revision ID: d2a6f9c4e817
Revises: b8d4f1a6c203
Create Date: 2026-10-16 22:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op
from app.db.rls import secure_registered_table

revision: str = "d2a6f9c4e817"
down_revision: str | Sequence[str] | None = "b8d4f1a6c203"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the remembered sources table with its row-level security, and the run column that carries what a commit replaced

    Nothing exists to carry over: runs already committed kept no record of the accounts they wrote to,
    since every later commit deletes them, so every account starts with no remembered source
    """
    op.create_table(
        "account_import_sources",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("source", sa.VARCHAR(length=32), nullable=False),
        sa.Column("import_run_id", sa.Uuid(), nullable=True),
        sa.CheckConstraint(
            "source IN ('generic', 'firefly', 'actual_budget', 'ofx')", name="ck_account_import_sources_source",
        ),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["import_run_id"], ["import_runs.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id", name="uq_account_import_sources_account_id"),
    )
    op.create_index(
        op.f("ix_account_import_sources_import_run_id"), "account_import_sources", ["import_run_id"], unique=False,
    )
    secure_registered_table(op.get_bind(), "account_import_sources")

    op.add_column(
        "import_runs",
        sa.Column("replaced_account_sources", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    """Drop the remembered sources and the run column, which removes the table's policy and grants

    Every account's remembered source is lost, so its import page opens on CSV again. Undoing an import
    committed before this no longer puts back a source it replaced
    """
    op.drop_column("import_runs", "replaced_account_sources")
    op.drop_index(op.f("ix_account_import_sources_import_run_id"), table_name="account_import_sources")
    op.drop_table("account_import_sources")
