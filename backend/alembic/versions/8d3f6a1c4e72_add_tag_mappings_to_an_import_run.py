"""add tag mappings to an import run

Revision ID: 8d3f6a1c4e72
Revises: 5b9e2d7a4c16
Create Date: 2026-10-31 11:20:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "8d3f6a1c4e72"
down_revision: str | Sequence[str] | None = "5b9e2d7a4c16"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add where a run holds the tag names the user answered by hand

    Defaulted in the database rather than only in the model, so a run already staged when this
    reaches a deployment reads as one that answered nothing rather than blocking the column
    """
    op.add_column(
        "import_runs",
        sa.Column(
            "tag_mappings",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
            nullable=False,
        ),
    )


def downgrade() -> None:
    """Drop it, losing the answers any staged run holds

    A run staged with tag answers and committed after this loses them, so its tag names are matched
    or created by name, which is what the importer did before the step existed
    """
    op.drop_column("import_runs", "tag_mappings")
