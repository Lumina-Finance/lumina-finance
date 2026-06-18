"""enable row level security

Revision ID: a6eede94e4f4
Revises: b8e3c9d4f6a2
Create Date: 2026-06-17 21:19:57.026290
"""

from collections.abc import Sequence

from alembic import op
from app.db.rls import apply_rls, revoke_rls

revision: str = "a6eede94e4f4"
down_revision: str | Sequence[str] | None = "b8e3c9d4f6a2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the row-level security helpers and enable the policies"""
    apply_rls(op.get_bind())


def downgrade() -> None:
    """Remove the row-level security policies and helpers"""
    revoke_rls(op.get_bind())
