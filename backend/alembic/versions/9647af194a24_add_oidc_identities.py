"""add oidc identities

Revision ID: 9647af194a24
Revises: 00ef3b74493d
Create Date: 2026-07-08 15:23:13.052784
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.db.rls import grant_auth_table

revision: str = "9647af194a24"
down_revision: str | Sequence[str] | None = "00ef3b74493d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create OIDC identity storage and grant the app role"""
    op.create_table(
        "oidc_identities",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("provider_id", sa.Uuid(), nullable=False),
        sa.Column("subject", sa.Text(), nullable=False),
        sa.Column("email", sa.VARCHAR(length=254), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["provider_id"], ["oidc_providers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider_id", "subject", name="uq_oidc_identity_provider_subject"),
    )
    op.create_index(op.f("ix_oidc_identities_user_id"), "oidc_identities", ["user_id"], unique=False)

    # This table is added after the row-level security bootstrap, so grant the app role here
    grant_auth_table(op.get_bind(), "oidc_identities")


def downgrade() -> None:
    """Remove OIDC identity storage"""
    op.drop_index(op.f("ix_oidc_identities_user_id"), table_name="oidc_identities")
    op.drop_table("oidc_identities")
