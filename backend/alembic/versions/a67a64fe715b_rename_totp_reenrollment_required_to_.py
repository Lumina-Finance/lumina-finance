"""rename totp reenrollment required to second factor reenrollment required

Revision ID: a67a64fe715b
Revises: 8123ddb2123c
Create Date: 2026-06-29 22:41:00.756142
"""

from collections.abc import Sequence

from alembic import op

revision: str = "a67a64fe715b"
down_revision: str | Sequence[str] | None = "8123ddb2123c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Rename the forced re-enrolment flag now that it covers passkeys as well as TOTP"""
    op.alter_column("users", "totp_reenrollment_required", new_column_name="second_factor_reenrollment_required")


def downgrade() -> None:
    """Restore the TOTP-specific flag name"""
    op.alter_column("users", "second_factor_reenrollment_required", new_column_name="totp_reenrollment_required")
