"""Row-level security table policies and grants

The policies reference the helper names from the functions module, so a renamed helper
flows through here without a separate edit. Function calls are schema-qualified so a
changed search_path cannot route them to a different function
"""

from sqlalchemy import Connection, text

from app.config import APP_DB_USER
from app.db.rls.functions import (
    CAN_ACCESS_ACCOUNT,
    CAN_ACCESS_BASE_BUDGET,
    CAN_ACCESS_GROUP,
    CURRENT_USER_ID,
    IS_GROUP_ADMIN,
)

# Table privileges the app role holds on the data it serves
APP_TABLE_PRIVILEGES = "SELECT, INSERT, UPDATE, DELETE"

# (table, USING, WITH CHECK) for tables secured by a single policy. Where a table's read
# helper resolves access by reading the table itself, the USING clause also lists the
# direct owner and group-admin predicates so a creator can read back the row it just
# inserted, since the helper evaluates against a snapshot that predates the row inside
# the same INSERT ... RETURNING statement
SECURED_TABLES = (
    ("accounts",
     f"owner_id = {CURRENT_USER_ID}() OR {IS_GROUP_ADMIN}(group_id) OR {CAN_ACCESS_ACCOUNT}(id)",
     f"owner_id = {CURRENT_USER_ID}() OR {CAN_ACCESS_GROUP}(group_id)"),
    ("account_balance_snapshots", f"{CAN_ACCESS_ACCOUNT}(account_id)",
     f"{CAN_ACCESS_ACCOUNT}(account_id)"),
    ("account_permissions", f"{CAN_ACCESS_ACCOUNT}(account_id)",
     f"{CAN_ACCESS_ACCOUNT}(account_id)"),
    ("transactions", f"{CAN_ACCESS_ACCOUNT}(account_id)",
     f"{CAN_ACCESS_ACCOUNT}(account_id)"),
    ("base_budgets",
     f"owner_id = {CURRENT_USER_ID}() OR {IS_GROUP_ADMIN}(group_id) OR {CAN_ACCESS_BASE_BUDGET}(id)",
     f"owner_id = {CURRENT_USER_ID}() OR {CAN_ACCESS_GROUP}(group_id)"),
    ("budgets", f"{CAN_ACCESS_BASE_BUDGET}(base_budget_id)",
     f"{CAN_ACCESS_BASE_BUDGET}(base_budget_id)"),
    ("budget_tracked_categories", f"{CAN_ACCESS_BASE_BUDGET}(base_budget_id)",
     f"{CAN_ACCESS_BASE_BUDGET}(base_budget_id)"),
    ("budget_permissions", f"{CAN_ACCESS_BASE_BUDGET}(base_budget_id)",
     f"{CAN_ACCESS_BASE_BUDGET}(base_budget_id)"),
    ("group_members", f"{CAN_ACCESS_GROUP}(group_id)", f"{CAN_ACCESS_GROUP}(group_id)"),
    ("group_cache_states", f"{CAN_ACCESS_GROUP}(group_id)", f"{CAN_ACCESS_GROUP}(group_id)"),
    ("user_cache_states", f"user_id = {CURRENT_USER_ID}()", f"user_id = {CURRENT_USER_ID}()"),
    ("user_runway_accounts", f"user_id = {CURRENT_USER_ID}()",
     f"user_id = {CURRENT_USER_ID}() AND {CAN_ACCESS_ACCOUNT}(account_id)"),
    ("users", f"id = {CURRENT_USER_ID}()", f"id = {CURRENT_USER_ID}()"),
    ("merchants", f"owner_id = {CURRENT_USER_ID}() OR {CAN_ACCESS_GROUP}(group_id)",
     f"owner_id = {CURRENT_USER_ID}() OR {CAN_ACCESS_GROUP}(group_id)"),
    ("tags", f"owner_id = {CURRENT_USER_ID}() OR {CAN_ACCESS_GROUP}(group_id)",
     f"owner_id = {CURRENT_USER_ID}() OR {CAN_ACCESS_GROUP}(group_id)"),
    ("tax_advantaged_categories",
     f"category_owner_user_id = {CURRENT_USER_ID}() OR {CAN_ACCESS_GROUP}(group_id)",
     f"category_owner_user_id = {CURRENT_USER_ID}() OR {CAN_ACCESS_GROUP}(group_id)"),
    ("tax_advantaged_category_limits",
     "EXISTS (SELECT 1 FROM public.tax_advantaged_categories t WHERE t.id = tax_advantaged_category_id)",
     "EXISTS (SELECT 1 FROM public.tax_advantaged_categories t WHERE t.id = tax_advantaged_category_id)"),
    ("transaction_tags",
     "EXISTS (SELECT 1 FROM public.transactions t WHERE t.id = transaction_id)",
     "EXISTS (SELECT 1 FROM public.transactions t WHERE t.id = transaction_id) "
     "AND EXISTS (SELECT 1 FROM public.tags g WHERE g.id = tag_id)"),
)

# Reference tables every authenticated user reads, with no per-row scoping
GLOBAL_READ_TABLES = ("currencies", "institutions")

# Auth tables stay out of RLS because the login and token flows query them before a
# request identity exists, always by exact id, so the queries already scope them
AUTH_TABLES = ("auth_identities", "password_credentials", "auth_sessions", "auth_tokens")


def apply_policies(connection: Connection) -> None:
    """Enable the policies and grant the app role the access it serves"""
    for table, using_expr, check_expr in SECURED_TABLES:
        _secure_table(connection, table, using_expr, check_expr)
    _secure_categories(connection)
    _secure_groups(connection)

    for table in GLOBAL_READ_TABLES:
        connection.execute(text(f'GRANT SELECT ON public.{table} TO "{APP_DB_USER}"'))
    connection.execute(text(f'GRANT INSERT ON public.institutions TO "{APP_DB_USER}"'))
    for table in AUTH_TABLES:
        connection.execute(text(f'GRANT {APP_TABLE_PRIVILEGES} ON public.{table} TO "{APP_DB_USER}"'))

    # The app role evaluates the policies and the auth flows, so it must execute the
    # helpers, while their SECURITY DEFINER owner is what reaches the underlying rows
    connection.execute(text(f'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO "{APP_DB_USER}"'))


def drop_policies(connection: Connection) -> None:
    """Drop every policy and disable row-level security on every public table"""
    connection.execute(text(
        "DO $$ DECLARE r record; BEGIN "
        "FOR r IN SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public' LOOP "
        "EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename); "
        "END LOOP; "
        "FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP "
        "EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', r.tablename); "
        "END LOOP; END $$"
    ))


def _secure_table(connection: Connection, table: str, using_expr: str, check_expr: str) -> None:
    """Enable RLS on a table, add its single access policy, and grant the app role"""
    connection.execute(text(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY"))
    connection.execute(text(
        f"CREATE POLICY {table}_access ON public.{table} USING ({using_expr}) WITH CHECK ({check_expr})"
    ))
    connection.execute(text(f'GRANT {APP_TABLE_PRIVILEGES} ON public.{table} TO "{APP_DB_USER}"'))


def _secure_categories(connection: Connection) -> None:
    """Enable RLS on categories, keeping system rows readable but app-immutable"""
    connection.execute(text("ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY"))
    connection.execute(text(
        "CREATE POLICY categories_read ON public.categories FOR SELECT "
        f"USING (is_system OR owner_id = {CURRENT_USER_ID}() OR {CAN_ACCESS_GROUP}(group_id))"
    ))

    # System categories are seeded by the migrator, so the app role can only write
    # its own personal or group categories
    scoped = f"(owner_id = {CURRENT_USER_ID}() OR {CAN_ACCESS_GROUP}(group_id)) AND NOT is_system"
    connection.execute(text(f"CREATE POLICY categories_insert ON public.categories FOR INSERT WITH CHECK ({scoped})"))
    connection.execute(text(f"CREATE POLICY categories_update ON public.categories FOR UPDATE USING ({scoped}) WITH CHECK ({scoped})"))
    connection.execute(text(f"CREATE POLICY categories_delete ON public.categories FOR DELETE USING ({scoped})"))
    connection.execute(text(f'GRANT {APP_TABLE_PRIVILEGES} ON public.categories TO "{APP_DB_USER}"'))


def _secure_groups(connection: Connection) -> None:
    """Enable RLS on groups, created by their owner and managed by their members"""
    connection.execute(text("ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY"))
    access = f"{CAN_ACCESS_GROUP}(id)"

    # The read policy also accepts the direct owner check so a creator can read back
    # the group it just inserted, before the access helper can observe the new row in
    # the same INSERT ... RETURNING statement
    read_access = f"owner_id = {CURRENT_USER_ID}() OR {access}"
    connection.execute(text(f"CREATE POLICY groups_read ON public.groups FOR SELECT USING ({read_access})"))
    connection.execute(text(f"CREATE POLICY groups_insert ON public.groups FOR INSERT WITH CHECK (owner_id = {CURRENT_USER_ID}())"))
    connection.execute(text(f"CREATE POLICY groups_update ON public.groups FOR UPDATE USING ({access}) WITH CHECK ({access})"))
    connection.execute(text(f"CREATE POLICY groups_delete ON public.groups FOR DELETE USING ({access})"))
    connection.execute(text(f'GRANT {APP_TABLE_PRIVILEGES} ON public.groups TO "{APP_DB_USER}"'))
