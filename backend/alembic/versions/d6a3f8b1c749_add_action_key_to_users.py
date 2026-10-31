"""add action key to users

Revision ID: d6a3f8b1c749
Revises: 8d3f6a1c4e72
Create Date: 2026-10-31 09:30:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d6a3f8b1c749"
down_revision: str | Sequence[str] | None = "8d3f6a1c4e72"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the action key preference, which every existing user starts on as Alt, the key the transaction dialogue's shortcuts use"""
    # Bounds this revision's statements, so a deploy blocked behind a long-running request fails
    # instead of queueing an exclusive lock on users that stalls every authenticated request. Every
    # pending revision runs in one transaction, so the setting is reset below rather than left to
    # bound the revisions after this one
    op.execute(sa.text("SET LOCAL lock_timeout = '5s'"))

    op.add_column("users", sa.Column("action_key", sa.VARCHAR(length=32), server_default="alt", nullable=False))
    op.create_check_constraint("ck_users_action_key", "users", "action_key IN ('alt', 'left-alt')")

    op.execute(sa.text("SET LOCAL lock_timeout = DEFAULT"))


def downgrade() -> None:
    """Drop the action key preference, losing any key a user chose"""
    op.drop_constraint("ck_users_action_key", "users", type_="check")
    op.drop_column("users", "action_key")
