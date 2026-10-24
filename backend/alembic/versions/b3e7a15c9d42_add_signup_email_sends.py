"""add signup email sends

Revision ID: b3e7a15c9d42
Revises: 4e8b2d6a9c15
Create Date: 2026-10-24 03:30:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.db.rls import grant_auth_table

revision: str = "b3e7a15c9d42"
down_revision: str | Sequence[str] | None = "4e8b2d6a9c15"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the sign-up email send log and grant the app role"""
    op.create_table(
        "signup_email_sends",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email_hash", sa.VARCHAR(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_signup_email_sends_email_hash"), "signup_email_sends", ["email_hash"], unique=False)

    # This table is added after the row-level security bootstrap, so grant the app role here
    grant_auth_table(op.get_bind(), "signup_email_sends")


def downgrade() -> None:
    """Remove the sign-up email send log, which drops the day's counts so every address can be emailed again"""
    op.drop_index(op.f("ix_signup_email_sends_email_hash"), table_name="signup_email_sends")
    op.drop_table("signup_email_sends")
