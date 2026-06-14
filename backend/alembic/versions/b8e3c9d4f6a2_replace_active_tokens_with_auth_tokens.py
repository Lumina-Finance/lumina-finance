"""Replace active tokens with auth tokens

Revision ID: b8e3c9d4f6a2
Revises: a4f8d1c2e7b3
Create Date: 2026-06-12 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "b8e3c9d4f6a2"
down_revision: str | Sequence[str] | None = "a4f8d1c2e7b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create token allowlist storage tied to auth sessions"""
    auth_token_kind = postgresql.ENUM("ACCESS", "REFRESH", name="authtokenkind", create_type=False)
    auth_token_kind.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "auth_tokens",
        sa.Column("jti", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("session_id", sa.UUID(), nullable=False),
        sa.Column("token_kind", auth_token_kind, nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("refresh_grace_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "token_kind = 'REFRESH' OR refresh_grace_expires_at IS NULL",
            name="ck_auth_token_refresh_grace_kind",
        ),
        sa.ForeignKeyConstraint(["session_id"], ["auth_sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("jti"),
    )
    op.create_index(op.f("ix_auth_tokens_session_id"), "auth_tokens", ["session_id"], unique=False)
    op.create_index(op.f("ix_auth_tokens_user_id"), "auth_tokens", ["user_id"], unique=False)
    op.create_index(
        "uq_auth_token_session_access",
        "auth_tokens",
        ["session_id"],
        unique=True,
        postgresql_where=sa.text("token_kind = 'ACCESS'"),
    )
    op.create_index(
        "uq_auth_token_session_current_refresh",
        "auth_tokens",
        ["session_id"],
        unique=True,
        postgresql_where=sa.text("token_kind = 'REFRESH' AND refresh_grace_expires_at IS NULL"),
    )
    op.create_index(
        "uq_auth_token_session_previous_refresh",
        "auth_tokens",
        ["session_id"],
        unique=True,
        postgresql_where=sa.text("token_kind = 'REFRESH' AND refresh_grace_expires_at IS NOT NULL"),
    )

    # This migration intentionally invalidates every existing login session
    op.execute(sa.text("DELETE FROM auth_sessions"))

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

    op.drop_index("uq_auth_token_session_previous_refresh", table_name="auth_tokens")
    op.drop_index("uq_auth_token_session_current_refresh", table_name="auth_tokens")
    op.drop_index("uq_auth_token_session_access", table_name="auth_tokens")
    op.drop_index(op.f("ix_auth_tokens_user_id"), table_name="auth_tokens")
    op.drop_index(op.f("ix_auth_tokens_session_id"), table_name="auth_tokens")
    op.drop_table("auth_tokens")
    postgresql.ENUM(name="authtokenkind").drop(op.get_bind(), checkfirst=True)
