"""link imported transactions to the import run that wrote them

Revision ID: 8e2f4c6a1b37
Revises: 3d7a5e1c9b24
Create Date: 2026-10-04
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "8e2f4c6a1b37"
down_revision: str | Sequence[str] | None = "3d7a5e1c9b24"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Record which run wrote each imported transaction, and the run's file name

    Every transaction predating this keeps no run, so an import saved before this has nothing
    to undo and is never offered
    """
    op.add_column("import_runs", sa.Column("file_name", sa.VARCHAR(255), nullable=True))

    op.add_column("transactions", sa.Column("import_run_id", sa.Uuid(), nullable=True))
    op.create_index(op.f("ix_transactions_import_run_id"), "transactions", ["import_run_id"], unique=False)

    # Cleared rather than cascading, so removing a run can never take ledger rows with it. Only
    # undoing the import deletes the transactions it wrote
    op.create_foreign_key(
        "fk_transactions_import_run_id_import_runs",
        "transactions",
        "import_runs",
        ["import_run_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    """Drop the link and the run columns

    Every committed import loses the record of the transactions it wrote, so none of them can be
    undone after a later upgrade. The transactions themselves are kept
    """
    op.drop_constraint("fk_transactions_import_run_id_import_runs", "transactions", type_="foreignkey")
    op.drop_index(op.f("ix_transactions_import_run_id"), table_name="transactions")
    op.drop_column("transactions", "import_run_id")
    op.drop_column("import_runs", "file_name")
