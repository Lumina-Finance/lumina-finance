"""Row-level security table policies and grants

The policies reference the helper names from the functions module, so a renamed helper
flows through here without a separate edit. Function calls are schema-qualified so a
changed search_path cannot route them to a different function
"""

from sqlalchemy import Connection, text

from app.config.database import APP_DB_USER
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
    ("saved_insights_ranges", f"user_id = {CURRENT_USER_ID}()", f"user_id = {CURRENT_USER_ID}()"),
    ("import_runs", f"owner_id = {CURRENT_USER_ID}()", f"owner_id = {CURRENT_USER_ID}()"),
    ("import_staged_rows", f"owner_id = {CURRENT_USER_ID}()", f"owner_id = {CURRENT_USER_ID}()"),
    ("users", f"id = {CURRENT_USER_ID}()", f"id = {CURRENT_USER_ID}()"),
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
AUTH_TABLES = (
    "auth_identities",
    "password_credentials",
    "auth_sessions",
    "auth_tokens",
    "password_reset_tokens",
    "mfa_challenges",
    "totp_credentials",
    "recovery_codes",
    "webauthn_credentials",
    "webauthn_challenges",
    "oidc_providers",
    "oidc_identities",
    "oidc_authorization_requests",
)


def apply_policies(connection: Connection) -> None:
    """Enable the policies and grant the app role the access it serves"""
    for table, using_expr, check_expr in SECURED_TABLES:

        # A table added after the bootstrap RLS migration is created and secured by its own
        # later migration, so a from-scratch upgrade reaches this loop before that table
        # exists, while the test harness builds the full schema first and secures it here
        # The coverage guard test is what proves every registered table ends up secured
        if not _table_exists(connection, table):
            continue
        _secure_table(connection, table, using_expr, check_expr)
    _secure_categories(connection)
    _secure_merchants(connection)
    _secure_groups(connection)

    for table in GLOBAL_READ_TABLES:
        connection.execute(text(f'GRANT SELECT ON public.{table} TO "{APP_DB_USER}"'))
    connection.execute(text(f'GRANT INSERT ON public.institutions TO "{APP_DB_USER}"'))
    for table in AUTH_TABLES:

        # A later migration can add an auth table after this bootstrap runs, so skip any
        # not yet created and let that migration grant the app role through grant_auth_table
        if not _table_exists(connection, table):
            continue
        connection.execute(text(f'GRANT {APP_TABLE_PRIVILEGES} ON public.{table} TO "{APP_DB_USER}"'))

    # The app role evaluates the policies and the auth flows, so it must execute the
    # helpers, while their SECURITY DEFINER owner is what reaches the underlying rows
    connection.execute(text(f'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO "{APP_DB_USER}"'))


def _table_exists(connection: Connection, table: str) -> bool:
    """Whether a public table is already present in the database"""
    return connection.execute(
        text("SELECT to_regclass(:qualified)"), {"qualified": f"public.{table}"}
    ).scalar() is not None


def _column_exists(connection: Connection, table: str, column: str) -> bool:
    """Whether a column is already present on a public table"""
    return connection.execute(
        text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = :table AND column_name = :column"
        ),
        {"table": table, "column": column},
    ).scalar() is not None


def secure_registered_table(connection: Connection, table: str) -> None:
    """Enable row-level security on one already-created table using its registered policy

    Incremental migrations that add a secured table call this so the single SECURED_TABLES
    definition stays the only source of the table's access rule
    """
    for name, using_expr, check_expr in SECURED_TABLES:
        if name == table:
            _secure_table(connection, name, using_expr, check_expr)
            return
    raise KeyError(f"No registered row-level security policy for table {table!r}")


def grant_auth_table(connection: Connection, table: str) -> None:
    """Grant the app role on one auth table added after the bootstrap migration

    Auth tables carry no row-level policy, so an incremental migration that adds one calls
    this to give the app role the same access the bootstrap grants the original auth tables
    """
    if table not in AUTH_TABLES:
        raise KeyError(f"{table!r} is not a registered auth table")
    connection.execute(text(f'GRANT {APP_TABLE_PRIVILEGES} ON public.{table} TO "{APP_DB_USER}"'))


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


def _secure_merchants(connection: Connection) -> None:
    """Enable RLS on merchants, keeping system rows readable but app-immutable"""
    owned = f"owner_id = {CURRENT_USER_ID}() OR {CAN_ACCESS_GROUP}(group_id)"

    # The bootstrap migration replays this against a database from before is_system existed, so the
    # ownership-only rule stands in there. Nothing in the migration chain corrects it: the deploy
    # re-applies these policies after migrating, which is when the system rows become readable
    if not _column_exists(connection, "merchants", "is_system"):
        _secure_table(connection, "merchants", owned, owned)
        return

    connection.execute(text("ALTER TABLE public.merchants ENABLE ROW LEVEL SECURITY"))
    connection.execute(text(
        f"CREATE POLICY merchants_read ON public.merchants FOR SELECT USING (is_system OR {owned})"
    ))

    # System merchants are seeded by the migrator, so the app role can only write
    # its own personal or group merchants
    scoped = f"(owner_id = {CURRENT_USER_ID}() OR {CAN_ACCESS_GROUP}(group_id)) AND NOT is_system"
    connection.execute(text(f"CREATE POLICY merchants_insert ON public.merchants FOR INSERT WITH CHECK ({scoped})"))
    connection.execute(text(f"CREATE POLICY merchants_update ON public.merchants FOR UPDATE USING ({scoped}) WITH CHECK ({scoped})"))
    connection.execute(text(f"CREATE POLICY merchants_delete ON public.merchants FOR DELETE USING ({scoped})"))
    connection.execute(text(f'GRANT {APP_TABLE_PRIVILEGES} ON public.merchants TO "{APP_DB_USER}"'))


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
