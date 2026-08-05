"""add import staging tables

Revision ID: 93e7aa96d2ae
Revises: 87449d849ce3
Create Date: 2026-08-04 17:50:40.379340
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op
from app.db.rls import secure_registered_table

revision: str = "93e7aa96d2ae"
down_revision: str | Sequence[str] | None = "87449d849ce3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the import run and staged row tables and enable their row-level security"""
    op.create_table(
        "import_runs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("expected_transaction_count", sa.Integer(), nullable=False),
        sa.Column("account_mappings", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("category_mappings", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("committed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("summary", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "import_staged_rows",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("import_run_id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("row_index", sa.Integer(), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.ForeignKeyConstraint(["import_run_id"], ["import_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("import_run_id", "row_index", name="uq_import_staged_row_run_index"),
    )
    secure_registered_table(op.get_bind(), "import_runs")
    secure_registered_table(op.get_bind(), "import_staged_rows")


def downgrade() -> None:
    """Drop the import staging tables, which removes their policies and grants"""
    op.drop_table("import_staged_rows")
    op.drop_table("import_runs")
