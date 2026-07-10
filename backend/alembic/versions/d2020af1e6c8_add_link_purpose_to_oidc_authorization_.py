"""add link purpose to oidc authorization requests

Revision ID: d2020af1e6c8
Revises: 440a1cffd716
Create Date: 2026-07-08 17:07:15.907481
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d2020af1e6c8"
down_revision: str | Sequence[str] | None = "440a1cffd716"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Scope sign-in roundtrips to a purpose and carry the linking user

    A roundtrip started to link a provider to a signed-in account must never complete a
    login and vice versa, and the link case needs the account it was authorized for
    """
    op.add_column(
        "oidc_authorization_requests",
        sa.Column("purpose", sa.VARCHAR(length=10), server_default="login", nullable=False),
    )
    op.add_column("oidc_authorization_requests", sa.Column("user_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_oidc_authorization_requests_user_id",
        "oidc_authorization_requests",
        "users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    """Remove the purpose scoping and linking user"""
    op.drop_constraint(
        "fk_oidc_authorization_requests_user_id", "oidc_authorization_requests", type_="foreignkey"
    )
    op.drop_column("oidc_authorization_requests", "user_id")
    op.drop_column("oidc_authorization_requests", "purpose")
