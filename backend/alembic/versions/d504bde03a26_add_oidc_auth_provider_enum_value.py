"""add oidc auth provider enum value

Revision ID: d504bde03a26
Revises: 3bc0b7847fd1
Create Date: 2026-07-08 15:08:22.200890
"""

from collections.abc import Sequence

from alembic import op

revision: str = "d504bde03a26"
down_revision: str | Sequence[str] | None = "3bc0b7847fd1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the oidc label to the auth provider enum so single sign-on identities can be stored

    The Python AuthProvider enum gained oidc but the type predates it, so linking an OIDC
    identity fails with an invalid enum value until the label exists
    """
    op.execute("ALTER TYPE authprovider ADD VALUE IF NOT EXISTS 'OIDC'")


def downgrade() -> None:
    """Leave the enum label in place

    Postgres cannot drop a value from an enum type without recreating it and rewriting every column
    that references it, so the addition is intentionally not reversed
    """
