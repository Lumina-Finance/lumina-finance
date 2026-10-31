"""add transaction links

Revision ID: c4d8e2f6a1b3
Revises: d4b8f2a6c1e3
Create Date: 2026-10-25 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.db.rls import secure_registered_table

revision: str = "c4d8e2f6a1b3"
down_revision: str | Sequence[str] | None = "d4b8f2a6c1e3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the transaction links table and enable its row-level security. No existing row changes"""
    op.create_table(
        "transaction_links",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("refund_transaction_id", sa.Uuid(), nullable=False),
        sa.Column("original_transaction_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("refund_transaction_id <> original_transaction_id", name="ck_transaction_links_distinct"),
        sa.ForeignKeyConstraint(["refund_transaction_id"], ["transactions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["original_transaction_id"], ["transactions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("refund_transaction_id", name="uq_transaction_links_refund"),
    )
    op.create_index("ix_transaction_links_original_transaction_id", "transaction_links", ["original_transaction_id"])
    secure_registered_table(op.get_bind(), "transaction_links")


def downgrade() -> None:
    """Drop the transaction links table, which removes its policy and grants and deletes every saved link"""
    op.drop_table("transaction_links")
