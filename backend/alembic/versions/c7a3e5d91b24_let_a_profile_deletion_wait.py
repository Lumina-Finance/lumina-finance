"""let a profile deletion wait

Revision ID: c7a3e5d91b24
Revises: b4c8e2a6d1f3
Create Date: 2026-11-23 09:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.db.rls.functions import create_helper_functions

revision: str = "c7a3e5d91b24"
down_revision: str | Sequence[str] | None = "b4c8e2a6d1f3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add when a marked profile's deletion is due and when its reminder was sent, and recreate the helpers

    No data is lost. A profile already marked has no due time, so it is still deleted at once. Bank sync now
    skips the connections of any marked profile, and the cleanup lists the profiles due a reminder
    """
    op.add_column("users", sa.Column("deletion_due_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("deletion_reminder_sent_at", sa.DateTime(timezone=True), nullable=True))
    create_helper_functions(op.get_bind())


def downgrade() -> None:
    """Drop the two columns and the reminder listing, and list every marked profile to delete again

    A profile still waiting for its due time loses its mark and stays, so its owner can sign in again and
    nothing is deleted early. A profile whose due time has passed stays marked and is deleted. The helpers
    that skip a marked owner's connections stay, since they read only the mark, which remains. Run this only
    with the app offline
    """
    op.execute(sa.text("UPDATE users SET deletion_requested_at = NULL WHERE deletion_due_at > now()"))
    op.execute(sa.text("DROP FUNCTION IF EXISTS public.list_profiles_to_remind()"))
    # The listing as the previous revision left it, written out here since it must not name the dropped column
    op.execute(
        sa.text(
            """
            CREATE OR REPLACE FUNCTION public.list_profiles_to_delete() RETURNS SETOF uuid
            LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
            BEGIN
                IF public.current_user_id() IS NOT NULL THEN
                    RAISE EXCEPTION 'Only the cleanup may list the profiles to delete'
                        USING ERRCODE = 'insufficient_privilege';
                END IF;

                RETURN QUERY SELECT u.id FROM public.users u WHERE u.deletion_requested_at IS NOT NULL ORDER BY u.deletion_requested_at;
            END
            $$
            """
        )
    )
    op.drop_column("users", "deletion_reminder_sent_at")
    op.drop_column("users", "deletion_due_at")
