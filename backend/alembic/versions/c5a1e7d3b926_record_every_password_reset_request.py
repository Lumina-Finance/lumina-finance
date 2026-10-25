"""record every password reset request

Revision ID: c5a1e7d3b926
Revises: b3e7a15c9d42
Create Date: 2026-10-25 04:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c5a1e7d3b926"
down_revision: str | Sequence[str] | None = "b3e7a15c9d42"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Let a reset token row belong to no user, and index the rows by age

    Every row saved so far names its user and was a real send, so all of them keep counting and
    nobody gets a fresh allowance
    """
    op.alter_column("password_reset_tokens", "user_id", existing_type=sa.Uuid(), nullable=True)

    # Every request now prunes old rows by age, and requests for any email add rows
    op.create_index(op.f("ix_password_reset_tokens_created_at"), "password_reset_tokens", ["created_at"], unique=False)


def downgrade() -> None:
    """Delete the rows that belong to no user, then require a user on every row

    Those rows record requests that sent nothing, and each was already used and expired, so no reset
    link stops working and no allowance changes
    """
    op.drop_index(op.f("ix_password_reset_tokens_created_at"), table_name="password_reset_tokens")
    op.execute("DELETE FROM password_reset_tokens WHERE user_id IS NULL")
    op.alter_column("password_reset_tokens", "user_id", existing_type=sa.Uuid(), nullable=False)
