"""remember how each account's CSV files were read

Revision ID: c4e8a2f6b913
Revises: 5c9e2a7d4b18
Create Date: 2026-10-15 19:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op
from app.db.rls import secure_registered_table

revision: str = "c4e8a2f6b913"
down_revision: str | Sequence[str] | None = "5c9e2a7d4b18"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the saved layouts table with its row-level security, and the run columns that carry a layout

    Nothing exists to carry over: every account starts with no saved layout, and runs already staged
    carry none, so their commits save nothing
    """
    op.create_table(
        "account_import_layouts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("header_key", sa.VARCHAR(length=64), nullable=False),
        sa.Column("headers", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("delimiter", sa.VARCHAR(length=1), nullable=False),
        sa.Column("header_row", sa.Integer(), nullable=False),
        sa.Column("column_map", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("date_format", sa.VARCHAR(length=16), nullable=False),
        sa.Column("amount_format", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("import_run_id", sa.Uuid(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["import_run_id"], ["import_runs.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id", "header_key", name="uq_account_import_layouts_account_header_key"),
    )
    op.create_index(
        op.f("ix_account_import_layouts_import_run_id"), "account_import_layouts", ["import_run_id"], unique=False,
    )
    secure_registered_table(op.get_bind(), "account_import_layouts")

    op.add_column("import_runs", sa.Column("csv_layout", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column("import_runs", sa.Column("replaced_csv_layout", postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    """Drop the saved layouts and the run columns, which removes the table's policy and grants

    Every account's saved layouts are lost, so the next file into it is read by detection alone. A run
    staged with a layout and committed after this saves none, and undoing an import committed before it
    no longer puts back a layout it replaced
    """
    op.drop_column("import_runs", "replaced_csv_layout")
    op.drop_column("import_runs", "csv_layout")
    op.drop_index(op.f("ix_account_import_layouts_import_run_id"), table_name="account_import_layouts")
    op.drop_table("account_import_layouts")
