"""Add each user's saved copy key number.

Revision ID: c5e8a2f1d7b3
Revises: c91e4a7b3d25
Create Date: 2026-11-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.db.rls.functions import create_helper_functions

revision: str = "c5e8a2f1d7b3"
down_revision: str | Sequence[str] | None = "c91e4a7b3d25"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the key number, starting every user at 0, and the function that raises it.

    No data is lost. A browser that saved a copy before this revision has none to decrypt, so it
    saves a fresh one at its next sign-in or session renewal.
    """
    op.add_column("users", sa.Column("saved_copy_key_version", sa.Integer(), server_default="0", nullable=False))
    create_helper_functions(op.get_bind())


def downgrade() -> None:
    """Drop the function and the key number.

    No rows are lost, but every user's number is. Applying the revision again restarts every
    number at 0, so a key an earlier rotation retired can be issued again. A copy saved under it
    before that rotation becomes readable to whoever kept the key. That is accepted, since a copy
    is only a cache.
    """
    op.execute(sa.text("DROP FUNCTION IF EXISTS public.rotate_saved_copy_key(uuid)"))
    op.drop_column("users", "saved_copy_key_version")
