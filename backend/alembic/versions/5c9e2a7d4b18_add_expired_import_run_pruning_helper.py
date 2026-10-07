"""Add the helper that prunes every user's expired import runs.

Revision ID: 5c9e2a7d4b18
Revises: 8e2f4c6a1b37
Create Date: 2026-10-06
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.db.rls.functions import create_helper_functions


revision: str = "5c9e2a7d4b18"
down_revision: str | Sequence[str] | None = "8e2f4c6a1b37"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the pruning helper. No rows change until something calls it."""
    create_helper_functions(op.get_bind())


def downgrade() -> None:
    """Drop the pruning helper. No rows change."""
    op.execute(sa.text("DROP FUNCTION IF EXISTS public.prune_expired_import_runs()"))
