"""Rename account hidden flag to archived.

Revision ID: 3f8a2f1c9d7b
Revises: 8b7f0f3c2a91
Create Date: 2026-06-04 00:00:00.000000
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "3f8a2f1c9d7b"
down_revision: str | Sequence[str] | None = "8b7f0f3c2a91"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "accounts",
        "is_hidden",
        new_column_name="is_archived",
        existing_type=sa.Boolean(),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "accounts",
        "is_archived",
        new_column_name="is_hidden",
        existing_type=sa.Boolean(),
        existing_nullable=False,
    )
