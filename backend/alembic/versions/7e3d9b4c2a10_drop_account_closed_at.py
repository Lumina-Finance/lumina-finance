"""Drop the unsupported account closing state.

Revision ID: 7e3d9b4c2a10
Revises: 0b8d6e2c9a41
Create Date: 2026-09-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "7e3d9b4c2a10"
down_revision: str | Sequence[str] | None = "0b8d6e2c9a41"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    closing_count = op.get_bind().execute(
        sa.text("SELECT count(*) FROM accounts WHERE closed_at IS NOT NULL"),
    ).scalar_one()
    if closing_count:
        raise RuntimeError("Cannot drop accounts.closed_at while accounts still have closing dates")
    op.drop_column("accounts", "closed_at")


def downgrade() -> None:
    op.add_column("accounts", sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True))
