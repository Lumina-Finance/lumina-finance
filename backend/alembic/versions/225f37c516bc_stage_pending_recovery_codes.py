"""stage pending recovery codes

Revision ID: 225f37c516bc
Revises: 697179a00156
Create Date: 2026-06-27 19:35:20.141650
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "225f37c516bc"
down_revision: str | Sequence[str] | None = "697179a00156"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Mark recovery codes staged until the user acknowledges a fresh batch"""
    op.add_column(
        "recovery_codes",
        sa.Column("pending", sa.Boolean(), server_default="false", nullable=False),
    )


def downgrade() -> None:
    """Drop the pending staging flag"""
    op.drop_column("recovery_codes", "pending")
