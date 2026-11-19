"""Upgrade, downgrade and re-upgrade of the revision that reads each user's rows by key

A database built from scratch already has the current rules at the revision before, because the
revision enabling row-level security builds them from the app's source. So the downgrade is checked
for what it leaves, the per-row rules and none of the new indexes, rather than against that
starting state
"""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from tests.conftest import WORKER_DB_NAME
from tests.migrations.support import _create_engine_for_database, _drop_database, _recreate_database, _run_alembic, _run_alembic_upgrade

_DB_NAME = f"{WORKER_DB_NAME}_alembic_access_rule_sets"
_BEFORE_REVISION = "002d89ffade0"
_REVISION = "7f3c2a9e4b51"

# Each read rule the revision rewrites, by table and policy, with its text on main before this
# revision, as Postgres stores it, and the set it tests now
_ACCOUNT_RULE = "can_access_account(account_id)"
_BANK_RULE = "((owner_id = current_user_id()) AND can_access_account(account_id))"
_BUDGET_RULE = "can_access_base_budget(base_budget_id)"
_GROUP_RULE = "(is_system OR (owner_id = current_user_id()) OR can_access_group(group_id))"
_ACCOUNTS = "accessible_account_ids"
_BASE_BUDGETS = "accessible_base_budget_ids"
_GROUPS = "accessible_group_ids"
_READ_RULES = {
    ("accounts", "accounts_access"): (
        "((owner_id = current_user_id()) OR is_group_admin(group_id) OR can_access_account(id))",
        _ACCOUNTS,
    ),
    ("account_balance_snapshots", "account_balance_snapshots_access"): (_ACCOUNT_RULE, _ACCOUNTS),
    ("account_import_layouts", "account_import_layouts_access"): (_ACCOUNT_RULE, _ACCOUNTS),
    ("account_import_sources", "account_import_sources_access"): (_ACCOUNT_RULE, _ACCOUNTS),
    ("transactions", "transactions_access"): (_ACCOUNT_RULE, _ACCOUNTS),
    ("bank_account_links", "bank_account_links_access"): (_BANK_RULE, _ACCOUNTS),
    ("bank_transactions", "bank_transactions_access"): (_BANK_RULE, _ACCOUNTS),
    ("bank_pending_transactions", "bank_pending_transactions_access"): (_BANK_RULE, _ACCOUNTS),
    ("bank_holds", "bank_holds_access"): (_BANK_RULE, _ACCOUNTS),
    ("base_budgets", "base_budgets_access"): (
        "((owner_id = current_user_id()) OR is_group_admin(group_id) OR can_access_base_budget(id))",
        _BASE_BUDGETS,
    ),
    ("budgets", "budgets_access"): (_BUDGET_RULE, _BASE_BUDGETS),
    ("budget_tracked_categories", "budget_tracked_categories_access"): (_BUDGET_RULE, _BASE_BUDGETS),
    ("tags", "tags_access"): ("((owner_id = current_user_id()) OR can_access_group(group_id))", _GROUPS),
    ("tax_advantaged_categories", "tax_advantaged_categories_access"): (
        "((category_owner_user_id = current_user_id()) OR can_access_group(group_id))",
        _GROUPS,
    ),
    ("categories", "categories_read"): (_GROUP_RULE, _GROUPS),
    ("merchants", "merchants_read"): (_GROUP_RULE, _GROUPS),
}
_NEW_HELPERS = {"administered_group_ids", "accessible_group_ids", "accessible_account_ids", "accessible_base_budget_ids"}
_NEW_INDEXES = {
    "ix_accounts_owner_id",
    "ix_accounts_group_id",
    "ix_base_budgets_owner_id",
    "ix_base_budgets_group_id",
    "ix_tags_owner_id",
    "ix_categories_owner_id",
    "ix_merchants_owner_id",
    "ix_tax_advantaged_categories_category_owner_user_id",
    "ix_tax_advantaged_categories_group_id",
    "ix_transactions_category_id",
    "ix_transaction_tags_tag_id",
    "ix_merchants_default_category_id",
    "ix_budget_tracked_categories_category_id",
    "ix_budget_tracked_categories_base_budget_id",
    "ix_bank_account_links_owner_id",
    "ix_groups_owner_id",
    "ix_group_members_user_id",
    "ix_account_permissions_user_id",
    "ix_budget_permissions_user_id",
}
# Group columns are mostly empty, so their indexes leave those rows out
_PARTIAL_INDEXES = {"ix_accounts_group_id", "ix_base_budgets_group_id", "ix_tax_advantaged_categories_group_id"}


async def _budget_spend_settings(conn: AsyncConnection) -> list[str]:
    """Return the settings budget spending runs under"""
    return await conn.scalar(text("SELECT proconfig FROM pg_proc WHERE proname = 'budget_spend_rows'"))


async def _read_state(conn: AsyncConnection) -> tuple[dict, dict, dict]:
    """Read every policy's read and write conditions, every function's definition, and every index"""
    policies = {
        (row.tablename, row.policyname): (row.qual, row.with_check)
        for row in await conn.execute(text("SELECT tablename, policyname, qual, with_check FROM pg_policies WHERE schemaname = 'public'"))
    }
    functions = {
        row.proname: row.definition
        for row in await conn.execute(
            text(
                "SELECT p.proname, pg_get_functiondef(p.oid) AS definition"
                " FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'"
            )
        )
    }
    indexes = {
        row.indexname: row.indexdef
        for row in await conn.execute(text("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'"))
    }
    return policies, functions, indexes


async def test_access_rule_sets_migration_round_trips() -> None:
    """Verify the upgrade tests sets, the downgrade restores the per-row rules, and a re-upgrade lands on the same state"""
    await _recreate_database(_DB_NAME)
    engine = _create_engine_for_database(_DB_NAME)
    try:
        _run_alembic_upgrade(_DB_NAME, revision=_REVISION)
        async with engine.connect() as conn:
            upgraded = await _read_state(conn)
            assert await _budget_spend_settings(conn) == ['search_path=""', "jit=off"]
        policies, functions, indexes = upgraded
        for key, (_previous_rule, set_helper) in _READ_RULES.items():
            read_rule, _write_rule = policies[key]
            assert set_helper in read_rule, key
            assert "can_access_" not in read_rule, key
        assert _NEW_HELPERS <= functions.keys()
        # The route tests build their schema from the models, so each index must match them, column
        # and condition included
        model_engine = _create_engine_for_database(WORKER_DB_NAME)
        try:
            async with model_engine.connect() as conn:
                _policies, _functions, model_indexes = await _read_state(conn)
        finally:
            await model_engine.dispose()
        assert {name: indexes[name] for name in _NEW_INDEXES} == {name: model_indexes[name] for name in _NEW_INDEXES}
        for name in _PARTIAL_INDEXES:
            assert indexes[name].endswith("WHERE (group_id IS NOT NULL)"), name
        assert "LATERAL" in functions["budget_spend_rows"]

        completed = _run_alembic(_DB_NAME, "downgrade", _BEFORE_REVISION)
        assert completed.returncode == 0, completed.stdout + completed.stderr
        async with engine.connect() as conn:
            policies, functions, indexes = await _read_state(conn)
            assert await _budget_spend_settings(conn) == ['search_path=""']
        for key, (previous_rule, _set_helper) in _READ_RULES.items():
            read_rule, write_rule = policies[key]
            assert read_rule == previous_rule, key
            assert write_rule == upgraded[0][key][1], key
        # Kept, since earlier revisions build their tables' rules from the source naming them
        assert _NEW_HELPERS <= functions.keys()
        assert not _NEW_INDEXES & indexes.keys()
        assert "LATERAL" not in functions["budget_spend_rows"]

        _run_alembic_upgrade(_DB_NAME, revision=_REVISION)
        async with engine.connect() as conn:
            assert await _read_state(conn) == upgraded
    finally:
        await engine.dispose()
        await _drop_database(_DB_NAME)
