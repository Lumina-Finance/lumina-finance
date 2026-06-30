"""add webauthn auth provider enum value

Revision ID: 8123ddb2123c
Revises: 0308e40d81da
Create Date: 2026-06-29 20:46:12.281286
"""

from collections.abc import Sequence

from alembic import op

revision: str = "8123ddb2123c"
down_revision: str | Sequence[str] | None = "0308e40d81da"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the webauthn label to the auth provider enum so passkey identities can be stored

    The Python AuthProvider enum gained webauthn but the type predates it, so registering a passkey
    fails with an invalid enum value until the label exists
    """
    op.execute("ALTER TYPE authprovider ADD VALUE IF NOT EXISTS 'WEBAUTHN'")


def downgrade() -> None:
    """Leave the enum label in place

    Postgres cannot drop a value from an enum type without recreating it and rewriting every column
    that references it, so the addition is intentionally not reversed
    """
