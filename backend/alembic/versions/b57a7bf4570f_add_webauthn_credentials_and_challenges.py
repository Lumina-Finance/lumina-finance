"""add webauthn credentials and challenges

Revision ID: b57a7bf4570f
Revises: 8becd1197a9d
Create Date: 2026-06-29 12:38:31.791322
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.db.rls import grant_auth_table

revision: str = "b57a7bf4570f"
down_revision: str | Sequence[str] | None = "8becd1197a9d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create passkey credential and challenge storage and grant the app role"""
    op.create_table(
        "webauthn_credentials",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("credential_id", sa.LargeBinary(), nullable=False),
        sa.Column("public_key", sa.LargeBinary(), nullable=False),
        sa.Column("sign_count", sa.BigInteger(), nullable=False),
        sa.Column("transports", sa.Text(), nullable=True),
        sa.Column("name", sa.VARCHAR(length=100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("credential_id"),
    )
    op.create_index(op.f("ix_webauthn_credentials_user_id"), "webauthn_credentials", ["user_id"], unique=False)

    op.create_table(
        "webauthn_challenges",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("challenge", sa.LargeBinary(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("purpose", sa.VARCHAR(length=20), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("challenge"),
    )
    op.create_index(op.f("ix_webauthn_challenges_user_id"), "webauthn_challenges", ["user_id"], unique=False)

    # These tables are added after the row-level security bootstrap, so grant the app role here
    grant_auth_table(op.get_bind(), "webauthn_credentials")
    grant_auth_table(op.get_bind(), "webauthn_challenges")


def downgrade() -> None:
    """Remove passkey credential and challenge storage"""
    op.drop_index(op.f("ix_webauthn_challenges_user_id"), table_name="webauthn_challenges")
    op.drop_table("webauthn_challenges")
    op.drop_index(op.f("ix_webauthn_credentials_user_id"), table_name="webauthn_credentials")
    op.drop_table("webauthn_credentials")
