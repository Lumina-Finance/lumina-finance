"""record who added each institution

Revision ID: a4c8e2f6b1d3
Revises: 5d3c8f1a7b92
Create Date: 2026-11-22 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.db.rls import secure_registered_table

revision: str = "a4c8e2f6b1d3"
down_revision: str | Sequence[str] | None = "5d3c8f1a7b92"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the institution submissions table and enable its row-level security

    Institutions already in the list get no submission, since who added them is unknown, so they
    never count toward anyone's limit of pending institutions
    """
    op.create_table(
        "institution_submissions",
        sa.Column("institution_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["institution_id"], ["institutions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("institution_id"),
    )
    op.create_index("ix_institution_submissions_user_id", "institution_submissions", ["user_id"])
    secure_registered_table(op.get_bind(), "institution_submissions")


def downgrade() -> None:
    """Drop the institution submissions table, which removes its policy and grants

    Who added each institution is lost, while the institutions themselves stay in the list
    """
    op.drop_table("institution_submissions")
