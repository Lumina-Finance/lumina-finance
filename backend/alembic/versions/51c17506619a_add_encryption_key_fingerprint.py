"""add encryption key fingerprint

Revision ID: 51c17506619a
Revises: ea697fdf5846
Create Date: 2026-08-20 19:25:12.938671
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.db.rls import grant_global_read_table

revision: str = "51c17506619a"
down_revision: str | Sequence[str] | None = "ea697fdf5846"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the single row binding the database to its encryption key"""
    op.create_table(
        "encryption_key_fingerprint",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("fingerprint", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_encryption_key_fingerprint_singleton"),
        sa.PrimaryKeyConstraint("id"),
    )

    # This table is added after the row-level security bootstrap, so grant the app role here
    grant_global_read_table(op.get_bind(), "encryption_key_fingerprint")

    # No row is written here. The fingerprint is recorded by verify-fingerprint on the next
    # boot, which proves the resolved key decrypts existing data before recording it


def downgrade() -> None:
    """Remove the encryption key binding"""
    op.drop_table("encryption_key_fingerprint")
