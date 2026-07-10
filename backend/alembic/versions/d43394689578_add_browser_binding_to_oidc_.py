"""add browser binding to oidc authorization requests

Revision ID: d43394689578
Revises: d2020af1e6c8
Create Date: 2026-07-08 19:40:19.632772
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d43394689578"
down_revision: str | Sequence[str] | None = "d2020af1e6c8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Carry the hashed login binding secret so a callback proves it started in the same browser

    A login roundtrip stores the hash of a secret handed to the browser as a cookie, and the
    callback must present the matching secret, so a stolen state and code cannot complete a
    login in a victim's browser. Nullable because a link roundtrip is bound by user instead
    """
    op.add_column(
        "oidc_authorization_requests", sa.Column("browser_binding_hash", sa.Text(), nullable=True)
    )


def downgrade() -> None:
    """Remove the login binding secret hash"""
    op.drop_column("oidc_authorization_requests", "browser_binding_hash")
