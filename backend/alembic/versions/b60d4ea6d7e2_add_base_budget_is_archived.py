"""add base budget is archived

Revision ID: b60d4ea6d7e2
Revises: 2c12fe09ae65
Create Date: 2026-07-16 17:54:25.824533
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b60d4ea6d7e2"
down_revision: str | Sequence[str] | None = "2c12fe09ae65"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the archived flag that hides a base budget and stops period instance generation"""
    op.add_column(
        "base_budgets",
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade() -> None:
    """Drop the base budget archived flag"""
    op.drop_column("base_budgets", "is_archived")
