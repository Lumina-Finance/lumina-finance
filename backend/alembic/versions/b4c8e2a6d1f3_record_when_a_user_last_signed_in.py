"""record when a user last signed in

Revision ID: b4c8e2a6d1f3
Revises: e6b2d9f4a1c7
Create Date: 2026-11-24 09:30:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.db.rls import secure_registered_table
from app.db.rls.functions import create_helper_functions

revision: str = "b4c8e2a6d1f3"
down_revision: str | Sequence[str] | None = "e6b2d9f4a1c7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the table of each user's last sign-in, filled from the sign-ins the database still holds

    No data is lost. A user's time is the latest of their newest issued token, which every sign-in and
    renewal writes, their newest session start, their newest sign-in through a provider and the last use
    of any of their passkeys. A user with none of these left gets no row, so their last sign-in reads as
    unknown rather than an invented time
    """
    op.create_table(
        "user_last_sign_ins",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("last_signed_in_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )
    secure_registered_table(op.get_bind(), "user_last_sign_ins")
    op.execute(
        sa.text(
            """
            INSERT INTO public.user_last_sign_ins (user_id, last_signed_in_at)
            SELECT user_id, max(signed_in_at) FROM (
                SELECT user_id, created_at AS signed_in_at FROM public.auth_tokens
                UNION ALL
                SELECT user_id, created_at FROM public.auth_sessions
                UNION ALL
                SELECT user_id, last_login_at FROM public.oidc_identities WHERE last_login_at IS NOT NULL
                UNION ALL
                SELECT user_id, last_used_at FROM public.webauthn_credentials WHERE last_used_at IS NOT NULL
            ) AS sign_ins
            GROUP BY user_id
            """
        )
    )
    create_helper_functions(op.get_bind())


def downgrade() -> None:
    """Drop the function listing users and the table of last sign-ins, losing every recorded time"""
    op.execute(sa.text("DROP FUNCTION IF EXISTS public.list_users(uuid, integer)"))
    op.drop_table("user_last_sign_ins")
