"""add a free-text notes column to accounts

Revision ID: b5e1d7a3c902
Revises: b7d3f1a9c5e2
Create Date: 2026-10-31 09:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b5e1d7a3c902"
down_revision: str | Sequence[str] | None = "b7d3f1a9c5e2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the nullable notes column, which every existing account starts without"""
    op.add_column("accounts", sa.Column("notes", sa.VARCHAR(length=2000), nullable=True))


def downgrade() -> None:
    """Drop the notes column, which forgets every note written so far"""
    op.drop_column("accounts", "notes")
