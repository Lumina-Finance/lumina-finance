"""Replace active tokens with auth tokens

Revision ID: b8e3c9d4f6a2
Revises: a4f8d1c2e7b3
Create Date: 2026-06-12 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b8e3c9d4f6a2"
down_revision: str | Sequence[str] | None = "a4f8d1c2e7b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create token allowlist storage tied to auth sessions"""
    auth_token_kind = sa.Enum("ACCESS", "REFRESH", name="authtokenkind")
    auth_token_kind.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "auth_tokens",
        sa.Column("jti", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("session_id", sa.UUID(), nullable=False),
        sa.Column("token_kind", auth_token_kind, nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["auth_sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("jti"),
        sa.UniqueConstraint("session_id", "token_kind", name="uq_auth_token_session_kind"),
    )
    op.create_index(op.f("ix_auth_tokens_session_id"), "auth_tokens", ["session_id"], unique=False)
    op.create_index(op.f("ix_auth_tokens_user_id"), "auth_tokens", ["user_id"], unique=False)

    op.drop_index(op.f("ix_active_tokens_session_id"), table_name="active_tokens")
    op.drop_table("active_tokens")


def downgrade() -> None:
    """Restore active token storage"""
    op.create_table(
        "active_tokens",
        sa.Column("jti", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("session_id", sa.UUID(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("jti"),
    )
    op.create_index(op.f("ix_active_tokens_session_id"), "active_tokens", ["session_id"], unique=False)

    op.drop_index(op.f("ix_auth_tokens_user_id"), table_name="auth_tokens")
    op.drop_index(op.f("ix_auth_tokens_session_id"), table_name="auth_tokens")
    op.drop_table("auth_tokens")
    sa.Enum(name="authtokenkind").drop(op.get_bind(), checkfirst=True)
