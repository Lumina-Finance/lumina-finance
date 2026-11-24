"""save rule values on waiting bank items

Revision ID: c7b2e5a9d134
Revises: a8e3f1b6d492
Create Date: 2026-11-23 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "c7b2e5a9d134"
down_revision: str | Sequence[str] | None = "a8e3f1b6d492"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the rule values and the rules' digest a waiting bank item keeps, and the check that only a waiting item holds them

    No existing row changes. An item already waiting holds neither column, which reads as an item
    put through no rules, so the owner is offered the rules for it the first time they have any
    """
    op.add_column("bank_transactions", sa.Column("rule_fill", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column("bank_transactions", sa.Column("rules_version", sa.VARCHAR(length=64), nullable=True))
    op.create_check_constraint(
        "ck_bank_transactions_rule_fill",
        "bank_transactions",
        "disposition = 'awaiting_review' OR (rule_fill IS NULL AND rules_version IS NULL)",
    )


def downgrade() -> None:
    """Drop the check and both columns

    The rule values saved on waiting items are lost, and no other row changes
    """
    op.drop_constraint("ck_bank_transactions_rule_fill", "bank_transactions", type_="check")
    op.drop_column("bank_transactions", "rules_version")
    op.drop_column("bank_transactions", "rule_fill")
