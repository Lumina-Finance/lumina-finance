"""stop keeping whether a bank hold was dismissed

Revision ID: 1ab249c82417
Revises: 24f0f404f878
Create Date: 2026-11-16
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "1ab249c82417"
down_revision: str | Sequence[str] | None = "24f0f404f878"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Drop the stamp a dismissed hold kept, since holds are listed for awareness only

    Every hold stays. One the user dismissed is listed again until the bank stops reporting it, and
    takes the bank's date and description the next time the bank sends it
    """
    op.drop_column("bank_holds", "dismissed_at")


def downgrade() -> None:
    """Add the dismissal stamp back, empty

    Every hold stays and none counts as dismissed, so a hold dismissed before the upgrade stays listed
    """
    op.add_column("bank_holds", sa.Column("dismissed_at", sa.DateTime(timezone=True), nullable=True))
