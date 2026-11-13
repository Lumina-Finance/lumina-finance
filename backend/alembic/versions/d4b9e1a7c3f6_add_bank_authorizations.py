"""add bank authorizations

Revision ID: d4b9e1a7c3f6
Revises: b5e2c8a1d9f3
Create Date: 2026-11-13
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.db.downgrade_guard import refuse_while_tables_hold_rows
from app.db.rls import secure_registered_table
from app.db.rls.functions import create_helper_functions

revision: str = "d4b9e1a7c3f6"
down_revision: str | Sequence[str] | None = "b5e2c8a1d9f3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PRUNE_FUNCTION = "public.prune_expired_bank_authorizations()"


def upgrade() -> None:
    """Create the bank authorizations table, empty, enable its row-level security and add its cleanup function

    Nothing existing changes: a row exists only while a user is signing in at a bank that connects
    that way, for at most 30 minutes. A database that ran the bootstrap migration on this code
    already has the function, and creating it again replaces it with the same body
    """
    op.create_table(
        "bank_authorizations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.VARCHAR(length=32), nullable=False),
        sa.Column("connection_id", sa.Uuid(), nullable=True),
        sa.Column("nickname", sa.VARCHAR(length=64), nullable=True),
        sa.Column("return_account_id", sa.Uuid(), nullable=True),
        sa.Column("credentials_encrypted", sa.Text(), nullable=False),
        sa.Column("state_hash", sa.VARCHAR(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["connection_id"], ["bank_connections.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["return_account_id"], ["accounts.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("state_hash", name="uq_bank_authorizations_state_hash"),
        sa.UniqueConstraint("owner_id", name="uq_bank_authorizations_owner_id"),
        sa.CheckConstraint("provider ~ '^[a-z][a-z0-9_]*$'", name="ck_bank_authorizations_provider"),
    )
    secure_registered_table(op.get_bind(), "bank_authorizations")
    create_helper_functions(op.get_bind())


def downgrade() -> None:
    """Drop the bank authorizations table and its cleanup function, refusing while a sign-in is still open

    Expired rows are deleted first, since nothing can finish them. A row still open belongs to a user
    at their bank, whose return would be lost, so the rollback refuses until it expires within 30 minutes
    """
    op.execute(sa.text("DELETE FROM public.bank_authorizations WHERE expires_at <= now()"))
    refuse_while_tables_hold_rows(op.get_bind(), {"bank_authorizations": "the bank sign-ins that users have not yet returned from"})
    op.execute(sa.text(f"DROP FUNCTION IF EXISTS {_PRUNE_FUNCTION}"))
    op.drop_table("bank_authorizations")
