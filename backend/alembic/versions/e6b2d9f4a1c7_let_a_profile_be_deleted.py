"""let a profile be deleted

Revision ID: e6b2d9f4a1c7
Revises: d2f6b8a4c1e9
Create Date: 2026-11-22 18:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.db.rls.functions import create_helper_functions

revision: str = "e6b2d9f4a1c7"
down_revision: str | Sequence[str] | None = "d2f6b8a4c1e9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The columns naming a user that had no delete rule, as (table, column), written out here since a later
# change to the models must not change what this revision did
_USER_REFERENCES = (
    ("accounts", "owner_id"),
    ("account_permissions", "user_id"),
    ("auth_identities", "user_id"),
    ("password_credentials", "user_id"),
    ("totp_credentials", "user_id"),
    ("base_budgets", "owner_id"),
    ("budget_permissions", "user_id"),
    ("categories", "owner_id"),
    ("groups", "owner_id"),
    ("group_members", "user_id"),
    ("merchants", "owner_id"),
    ("tags", "owner_id"),
    ("transactions", "created_by_user_id"),
)


def upgrade() -> None:
    """Add the time a user asked to delete their profile, and delete a user's rows with the user

    No data is lost. Every existing user has no deletion time, so nothing changes for them. Each column
    above now deletes its row when the user row goes, where before deleting a user who had any such row
    was refused
    """
    op.add_column("users", sa.Column("deletion_requested_at", sa.DateTime(timezone=True), nullable=True))
    for table, column in _USER_REFERENCES:
        _replace_user_reference(table, column, ondelete="CASCADE")
    # Lets each deletion batch find the transactions a user created without reading every user's
    op.create_index(op.f("ix_transactions_created_by_user_id"), "transactions", ["created_by_user_id"], unique=False)
    create_helper_functions(op.get_bind())


def downgrade() -> None:
    """Drop the deletion time and the function listing it, and refuse to delete a user who has rows again

    A profile whose deletion hasn't finished loses its mark and stays, so its owner can sign in again.
    Run this only with the app offline, once no profile is waiting to be deleted
    """
    op.execute(sa.text("DROP FUNCTION IF EXISTS public.list_profiles_to_delete()"))
    op.drop_index(op.f("ix_transactions_created_by_user_id"), table_name="transactions")
    for table, column in _USER_REFERENCES:
        _replace_user_reference(table, column, ondelete=None)
    op.drop_column("users", "deletion_requested_at")


def _replace_user_reference(table: str, column: str, *, ondelete: str | None) -> None:
    """Recreate the foreign key from a column to users under its own name, with the given delete rule"""
    name = op.get_bind().scalar(
        sa.text(
            """
            SELECT con.conname FROM pg_constraint con
            JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
            WHERE con.contype = 'f' AND con.conrelid = to_regclass(:table)
                AND con.confrelid = 'public.users'::regclass AND att.attname = :column
            """
        ).bindparams(table=f"public.{table}", column=column)
    )
    if name is None:
        raise RuntimeError(f"{table}.{column} has no foreign key to users to replace")
    op.drop_constraint(name, table, type_="foreignkey")
    op.create_foreign_key(name, table, "users", [column], ["id"], ondelete=ondelete)
