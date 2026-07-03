"""add totp credentials

Revision ID: 1fe8ba5ee567
Revises: 3c0376bca26a
Create Date: 2026-06-26 15:31:30.168655
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.db.rls import grant_auth_table

revision: str = "1fe8ba5ee567"
down_revision: str | Sequence[str] | None = "3c0376bca26a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create totp credential storage and grant the app role"""
    op.create_table(
        "totp_credentials",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("secret_encrypted", sa.Text(), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("user_id"),
    )

    # This table is added after the row-level security bootstrap, so grant the app role here
    grant_auth_table(op.get_bind(), "totp_credentials")


def downgrade() -> None:
    """Remove totp credential storage"""
    op.drop_table("totp_credentials")
