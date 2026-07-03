"""add mfa challenges

Revision ID: 3c0376bca26a
Revises: fffdb82ddadd
Create Date: 2026-06-26 14:48:35.156003
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.db.rls import grant_auth_table

revision: str = "3c0376bca26a"
down_revision: str | Sequence[str] | None = "fffdb82ddadd"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create mfa challenge storage and grant the app role"""
    op.create_table(
        "mfa_challenges",
        sa.Column("jti", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("jti"),
    )
    op.create_index(op.f("ix_mfa_challenges_user_id"), "mfa_challenges", ["user_id"], unique=False)

    # This table is added after the row-level security bootstrap, so grant the app role here
    grant_auth_table(op.get_bind(), "mfa_challenges")


def downgrade() -> None:
    """Remove mfa challenge storage"""
    op.drop_index(op.f("ix_mfa_challenges_user_id"), table_name="mfa_challenges")
    op.drop_table("mfa_challenges")
