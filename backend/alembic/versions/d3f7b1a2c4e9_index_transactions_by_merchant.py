"""Index transactions by merchant.

Revision ID: d3f7b1a2c4e9
Revises: a6eede94e4f4
Create Date: 2026-06-18 00:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

revision: str = "d3f7b1a2c4e9"
down_revision: str | Sequence[str] | None = "a6eede94e4f4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_index(op.f("ix_transactions_merchant_id"), "transactions", ["merchant_id"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_transactions_merchant_id"), table_name="transactions")
