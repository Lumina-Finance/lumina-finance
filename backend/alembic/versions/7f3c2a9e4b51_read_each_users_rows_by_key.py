"""Read each user's rows by key in the access rules and their checks.

Revision ID: 7f3c2a9e4b51
Revises: 002d89ffade0
Create Date: 2026-11-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.db.rls import apply_rls, revoke_rls

revision: str = "7f3c2a9e4b51"
down_revision: str | Sequence[str] | None = "002d89ffade0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (index, table, column, whether it leaves out rows where the column is empty, as a group
# column mostly is)
_INDEXES = (
    ("ix_accounts_owner_id", "accounts", "owner_id", False),
    ("ix_accounts_group_id", "accounts", "group_id", True),
    ("ix_base_budgets_owner_id", "base_budgets", "owner_id", False),
    ("ix_base_budgets_group_id", "base_budgets", "group_id", True),
    ("ix_tags_owner_id", "tags", "owner_id", False),
    ("ix_categories_owner_id", "categories", "owner_id", False),
    ("ix_merchants_owner_id", "merchants", "owner_id", False),
    ("ix_tax_advantaged_categories_category_owner_user_id", "tax_advantaged_categories", "category_owner_user_id", False),
    ("ix_tax_advantaged_categories_group_id", "tax_advantaged_categories", "group_id", True),
    ("ix_transactions_category_id", "transactions", "category_id", False),
    ("ix_transaction_tags_tag_id", "transaction_tags", "tag_id", False),
    ("ix_merchants_default_category_id", "merchants", "default_category_id", False),
    ("ix_budget_tracked_categories_category_id", "budget_tracked_categories", "category_id", False),
    ("ix_budget_tracked_categories_base_budget_id", "budget_tracked_categories", "base_budget_id", False),
    ("ix_bank_account_links_owner_id", "bank_account_links", "owner_id", False),
    ("ix_groups_owner_id", "groups", "owner_id", False),
    ("ix_group_members_user_id", "group_members", "user_id", False),
    ("ix_account_permissions_user_id", "account_permissions", "user_id", False),
    ("ix_budget_permissions_user_id", "budget_permissions", "user_id", False),
)

# The read rules as they stood before this revision. Each calls an access helper on every row
_ACCOUNT_RULE = "public.can_access_account(account_id)"
_BANK_RULE = "owner_id = public.current_user_id() AND public.can_access_account(account_id)"
_BUDGET_RULE = "public.can_access_base_budget(base_budget_id)"
_PREVIOUS_READ_RULES = (
    ("accounts_access", "accounts", "owner_id = public.current_user_id() OR public.is_group_admin(group_id) OR public.can_access_account(id)"),
    ("account_balance_snapshots_access", "account_balance_snapshots", _ACCOUNT_RULE),
    ("account_import_layouts_access", "account_import_layouts", _ACCOUNT_RULE),
    ("account_import_sources_access", "account_import_sources", _ACCOUNT_RULE),
    ("transactions_access", "transactions", _ACCOUNT_RULE),
    (
        "base_budgets_access",
        "base_budgets",
        "owner_id = public.current_user_id() OR public.is_group_admin(group_id) OR public.can_access_base_budget(id)",
    ),
    ("budgets_access", "budgets", _BUDGET_RULE),
    ("budget_tracked_categories_access", "budget_tracked_categories", _BUDGET_RULE),
    ("bank_account_links_access", "bank_account_links", _BANK_RULE),
    ("bank_transactions_access", "bank_transactions", _BANK_RULE),
    ("bank_pending_transactions_access", "bank_pending_transactions", _BANK_RULE),
    ("bank_holds_access", "bank_holds", _BANK_RULE),
    ("tags_access", "tags", "owner_id = public.current_user_id() OR public.can_access_group(group_id)"),
    (
        "tax_advantaged_categories_access",
        "tax_advantaged_categories",
        "category_owner_user_id = public.current_user_id() OR public.can_access_group(group_id)",
    ),
    ("categories_read", "categories", "is_system OR owner_id = public.current_user_id() OR public.can_access_group(group_id)"),
    ("merchants_read", "merchants", "is_system OR owner_id = public.current_user_id() OR public.can_access_group(group_id)"),
)

# Budget spending as it stood before this revision, reading the tracked category's transactions first
_PREVIOUS_BUDGET_SPEND_ROWS = """
    CREATE OR REPLACE FUNCTION public.budget_spend_rows(p_budget_ids uuid[], p_now timestamptz)
    RETURNS TABLE (
        id uuid,
        category_id uuid,
        account_id uuid,
        date date,
        account_currency varchar,
        budget_currency varchar,
        amount_sum numeric
    )
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
        SELECT b.id, t.category_id, t.account_id, t.dt, a.currency, bb.currency, sum(t.amount)
        FROM public.budgets b
        JOIN public.base_budgets bb ON b.base_budget_id = bb.id
        LEFT JOIN public.groups owner_group ON bb.group_id = owner_group.id
        JOIN public.users budget_owner ON budget_owner.id = COALESCE(bb.owner_id, owner_group.owner_id)
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
            AND t.dt <= (p_now AT TIME ZONE budget_owner.tz)::date
            AND (
                (bb.group_id IS NOT NULL AND a.group_id = bb.group_id)
                OR (bb.group_id IS NULL AND a.owner_id = bb.owner_id)
            )
        GROUP BY b.id, t.category_id, t.account_id, t.dt, a.currency, bb.currency
    $$
"""


def upgrade() -> None:
    """Index the keys the access rules and foreign key checks look rows up by, and rebuild the rules on them.

    No data changes. Building the indexes holds writes to each table until its index is built. The
    rules and helpers are rebuilt from the app's source, as the deploy's row-level security step does
    """
    for name, table, column, skips_empty in _INDEXES:
        op.create_index(name, table, [column], postgresql_where=sa.text(f"{column} IS NOT NULL") if skips_empty else None)

    bind = op.get_bind()
    revoke_rls(bind)
    apply_rls(bind)


def downgrade() -> None:
    """Restore the per-row access rules and the category-first budget spending, and drop the new indexes.

    No data changes. Reads go back to checking every user's rows, so they slow again as the tables grow.

    The four set helpers stay, unused. Earlier revisions that add a table build its rule from the
    app's source, which names them, so migrating back up through those revisions needs them. The
    downgrade past the revision enabling row-level security drops them with every other helper
    """
    for policy, table, using_expr in _PREVIOUS_READ_RULES:
        op.execute(sa.text(f"ALTER POLICY {policy} ON public.{table} USING ({using_expr})"))
    op.execute(sa.text(_PREVIOUS_BUDGET_SPEND_ROWS))

    for name, table, _column, _skips_empty in reversed(_INDEXES):
        op.drop_index(name, table_name=table)
