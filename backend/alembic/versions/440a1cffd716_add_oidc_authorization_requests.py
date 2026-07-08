"""add oidc authorization requests

Revision ID: 440a1cffd716
Revises: 9647af194a24
Create Date: 2026-07-08 15:23:13.211860
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.db.rls import grant_auth_table

revision: str = "440a1cffd716"
down_revision: str | Sequence[str] | None = "9647af194a24"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create single-use OIDC sign-in roundtrip storage and grant the app role"""
    op.create_table(
        "oidc_authorization_requests",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("state_hash", sa.Text(), nullable=False),
        sa.Column("nonce", sa.Text(), nullable=False),
        sa.Column("code_verifier", sa.Text(), nullable=False),
        sa.Column("provider_id", sa.Uuid(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["provider_id"], ["oidc_providers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("state_hash"),
    )

    # This table is added after the row-level security bootstrap, so grant the app role here
    grant_auth_table(op.get_bind(), "oidc_authorization_requests")


def downgrade() -> None:
    """Remove OIDC sign-in roundtrip storage"""
    op.drop_table("oidc_authorization_requests")
