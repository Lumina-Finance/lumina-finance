"""add confirmed_at to webauthn credentials

Revision ID: 0308e40d81da
Revises: b57a7bf4570f
Create Date: 2026-06-29 14:09:15.103128
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0308e40d81da"
down_revision: str | Sequence[str] | None = "b57a7bf4570f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the staging timestamp that holds a first passkey inactive until recovery codes are saved"""
    op.add_column("webauthn_credentials", sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Drop the passkey staging timestamp"""
    op.drop_column("webauthn_credentials", "confirmed_at")
