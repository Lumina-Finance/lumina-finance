"""require oidc identity email

Revision ID: 2c12fe09ae65
Revises: d43394689578
Create Date: 2026-07-09 16:37:51.661232
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "2c12fe09ae65"
down_revision: str | Sequence[str] | None = "d43394689578"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Make the OIDC identity email non-null

    Every flow that creates an identity now requires the provider to supply an email, so the column
    enforces the same invariant the application does
    """
    op.alter_column("oidc_identities", "email", existing_type=sa.VARCHAR(length=254), nullable=False)


def downgrade() -> None:
    """Allow a null OIDC identity email again"""
    op.alter_column("oidc_identities", "email", existing_type=sa.VARCHAR(length=254), nullable=True)
