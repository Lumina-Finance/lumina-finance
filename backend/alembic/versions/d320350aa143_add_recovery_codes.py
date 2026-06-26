"""add recovery codes

Revision ID: d320350aa143
Revises: 1fe8ba5ee567
Create Date: 2026-06-26 16:15:46.988405
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.db.rls import grant_auth_table

revision: str = "d320350aa143"
down_revision: str | Sequence[str] | None = "1fe8ba5ee567"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create recovery code storage and grant the app role"""
    op.create_table(
        "recovery_codes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("code_hash", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code_hash"),
    )
    op.create_index(op.f("ix_recovery_codes_user_id"), "recovery_codes", ["user_id"], unique=False)

    # This table is added after the row-level security bootstrap, so grant the app role here
    grant_auth_table(op.get_bind(), "recovery_codes")


def downgrade() -> None:
    """Remove recovery code storage"""
    op.drop_index(op.f("ix_recovery_codes_user_id"), table_name="recovery_codes")
    op.drop_table("recovery_codes")
