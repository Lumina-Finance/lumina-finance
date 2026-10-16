"""allow OFX as an import run's source

Revision ID: b8d4f1a6c203
Revises: c4e8a2f6b913
Create Date: 2026-10-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b8d4f1a6c203"
down_revision: str | Sequence[str] | None = "c4e8a2f6b913"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Let a run name OFX as the importer that opened it

    Widens the check only, so every run already saved keeps the source it has
    """
    op.drop_constraint("ck_import_runs_source", "import_runs", type_="check")
    op.create_check_constraint(
        "ck_import_runs_source",
        "import_runs",
        "source IN ('generic', 'firefly', 'actual_budget', 'ofx')",
    )


def downgrade() -> None:
    """Narrow the check again, deleting every OFX run first

    The constraint would refuse the OFX rows, and re-labelling them as CSV would make a committed
    OFX import read as a CSV one on the last import card. A committed run holds only its summary and
    the transactions it wrote live on in the ledger, so deleting the runs loses no transaction, only
    the chance to undo that import
    """
    op.execute(sa.text("DELETE FROM import_runs WHERE source = 'ofx'"))
    op.drop_constraint("ck_import_runs_source", "import_runs", type_="check")
    op.create_check_constraint(
        "ck_import_runs_source",
        "import_runs",
        "source IN ('generic', 'firefly', 'actual_budget')",
    )
