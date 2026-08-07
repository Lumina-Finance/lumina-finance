"""add merchant mappings to an import run

Revision ID: ea697fdf5846
Revises: 60ed789e8b06
Create Date: 2026-08-06 22:35:43.155370
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "ea697fdf5846"
down_revision: str | Sequence[str] | None = "60ed789e8b06"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add where a run holds the payee values the user answered by hand

    Defaulted in the database rather than only in the model, so a run already staged when this
    reaches a deployment reads as one that answered nothing rather than blocking the column
    """
    op.add_column(
        "import_runs",
        sa.Column(
            "merchant_mappings",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
            nullable=False,
        ),
    )


def downgrade() -> None:
    """Drop it, losing the answers any staged run holds

    A run staged with merchant answers and committed after this loses them, so its payees are
    matched or created by name, which is what the importer did before the step existed
    """
    op.drop_column("import_runs", "merchant_mappings")
