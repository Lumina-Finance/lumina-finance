"""Cut off budget spend at the budget owner's local today.

Revision ID: 6b4c1a2d9e70
Revises: 7e3d9b4c2a10
Create Date: 2026-09-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.db.rls.functions import create_helper_functions


revision: str = "6b4c1a2d9e70"
down_revision: str | Sequence[str] | None = "7e3d9b4c2a10"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Replace the old budget aggregation function with its owner-date-aware signature."""
    create_helper_functions(op.get_bind())


def downgrade() -> None:
    """Restore period-only budget aggregation."""
    op.execute(sa.text("DROP FUNCTION IF EXISTS public.budget_spend_rows(uuid[], timestamptz)"))
    op.execute(sa.text("""
        CREATE FUNCTION public.budget_spend_rows(p_budget_ids uuid[])
        RETURNS TABLE (
            id uuid, category_id uuid, account_id uuid, date date,
            account_currency varchar, budget_currency varchar, amount_sum numeric
        )
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
            SELECT b.id, t.category_id, t.account_id, t.dt, a.currency, bb.currency, sum(t.amount)
            FROM public.budgets b
            JOIN public.base_budgets bb ON b.base_budget_id = bb.id
            JOIN public.budget_tracked_categories btc
                ON btc.base_budget_id = bb.id
                AND btc.added_at <= b.period_end
                AND (btc.removed_at IS NULL OR btc.removed_at > b.period_end)
            JOIN public.transactions t ON t.category_id = btc.category_id
            JOIN public.accounts a ON t.account_id = a.id
            WHERE b.id = ANY(p_budget_ids)
                AND public.can_access_base_budget(bb.id)
                AND t.dt >= b.period_start
                AND t.dt <= b.period_end
                AND (
                    (bb.group_id IS NOT NULL AND a.group_id = bb.group_id)
                    OR (bb.group_id IS NULL AND a.owner_id = bb.owner_id)
                )
            GROUP BY b.id, t.category_id, t.account_id, t.dt, a.currency, bb.currency
        $$
    """))
