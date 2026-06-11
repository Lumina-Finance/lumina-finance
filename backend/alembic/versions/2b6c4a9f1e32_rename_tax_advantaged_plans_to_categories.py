"""Rename tax-advantaged plans to categories

Revision ID: 2b6c4a9f1e32
Revises: c9e5d4a1b2f0
Create Date: 2026-06-10 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "2b6c4a9f1e32"
down_revision: str | Sequence[str] | None = "c9e5d4a1b2f0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Rename TAC storage to tax-advantaged category naming"""
    op.rename_table("tax_advantaged_plans", "tax_advantaged_categories")
    op.rename_table("tax_advantaged_plan_limits", "tax_advantaged_category_limits")

    # Rename the account link so storage matches the tax-advantaged category API
    op.alter_column(
        "accounts",
        "tax_advantaged_plan_id",
        new_column_name="tax_advantaged_category_id",
        existing_type=sa.UUID(),
        existing_nullable=True,
    )

    # Rename the limit link so storage matches the tax-advantaged category API
    op.alter_column(
        "tax_advantaged_category_limits",
        "plan_id",
        new_column_name="tax_advantaged_category_id",
        existing_type=sa.UUID(),
        existing_nullable=False,
    )

    # Rename the owner foreign key so storage matches the tax-advantaged category API
    op.alter_column(
        "tax_advantaged_categories",
        "plan_owner_user_id",
        new_column_name="category_owner_user_id",
        existing_type=sa.UUID(),
        existing_nullable=False,
    )


def downgrade() -> None:
    """Rename TAC storage back to tax-advantaged plan naming"""
    # Restore the prior owner foreign key name used by the plan storage
    op.alter_column(
        "tax_advantaged_categories",
        "category_owner_user_id",
        new_column_name="plan_owner_user_id",
        existing_type=sa.UUID(),
        existing_nullable=False,
    )

    # Restore the prior limit link name used by the plan storage
    op.alter_column(
        "tax_advantaged_category_limits",
        "tax_advantaged_category_id",
        new_column_name="plan_id",
        existing_type=sa.UUID(),
        existing_nullable=False,
    )

    # Restore the prior account link name used by the plan storage
    op.alter_column(
        "accounts",
        "tax_advantaged_category_id",
        new_column_name="tax_advantaged_plan_id",
        existing_type=sa.UUID(),
        existing_nullable=True,
    )
    op.rename_table("tax_advantaged_category_limits", "tax_advantaged_plan_limits")
    op.rename_table("tax_advantaged_categories", "tax_advantaged_plans")
