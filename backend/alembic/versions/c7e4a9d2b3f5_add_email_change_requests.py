"""add email change requests

Revision ID: c7e4a9d2b3f5
Revises: a41d6e0c93b7
Create Date: 2026-11-21 03:30:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.db.rls import grant_auth_table

revision: str = "c7e4a9d2b3f5"
down_revision: str | Sequence[str] | None = "a41d6e0c93b7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create email change request storage and grant the app role

    Starts empty, so no existing row changes
    """
    op.create_table(
        "email_change_requests",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("new_email", sa.VARCHAR(length=254), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
        sa.UniqueConstraint("user_id", name="uq_email_change_requests_user_id"),
    )
    op.create_index(op.f("ix_email_change_requests_expires_at"), "email_change_requests", ["expires_at"], unique=False)

    # This table is added after the row-level security bootstrap, so grant the app role here
    grant_auth_table(op.get_bind(), "email_change_requests")


def downgrade() -> None:
    """Remove email change request storage, dropping every pending request and leaving every account's address as it is"""
    op.drop_index(op.f("ix_email_change_requests_expires_at"), table_name="email_change_requests")
    op.drop_table("email_change_requests")
