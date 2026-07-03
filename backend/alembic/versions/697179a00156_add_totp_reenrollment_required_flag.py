"""add totp reenrollment required flag

Revision ID: 697179a00156
Revises: d320350aa143
Create Date: 2026-06-27 18:53:55.386220
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "697179a00156"
down_revision: str | Sequence[str] | None = "d320350aa143"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Flag accounts that must re-enrol TOTP after a recovery-code login"""
    op.add_column(
        "users",
        sa.Column("totp_reenrollment_required", sa.Boolean(), server_default="false", nullable=False),
    )


def downgrade() -> None:
    """Drop the re-enrolment flag"""
    op.drop_column("users", "totp_reenrollment_required")
