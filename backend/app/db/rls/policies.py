"""Row-level security table policies and grants

The policies reference the helper names from the functions module, so a renamed helper
flows through here without a separate edit. Function calls are schema-qualified so a
changed search_path cannot route them to a different function
"""

from sqlalchemy import Connection, text

from app.config.database import APP_DB_USER
from app.db.rls.functions import (
    ACCESSIBLE_ACCOUNT_IDS,
    ACCESSIBLE_BASE_BUDGET_IDS,
    ACCESSIBLE_GROUP_IDS,
    ADMINISTERED_GROUP_IDS,
    CAN_ACCESS_ACCOUNT,
    CAN_ACCESS_BASE_BUDGET,
    CAN_ACCESS_GROUP,
    CURRENT_USER_ID,
    create_set_helpers,
)

# Table privileges the app role holds on the data it serves
APP_TABLE_PRIVILEGES = "SELECT, INSERT, UPDATE, DELETE"


def _in_set(column: str, helper: str) -> str:
    """Return a read rule's test that a column's value is in the set a helper works out

    The subquery makes Postgres run the helper once per statement, before any row is read, so the
    test can be looked up in an index on the column rather than checked against every user's rows.
    The cast keeps ANY reading the helper's one array, not a subquery's rows
    """
    return f"{column} = ANY((SELECT {helper}())::uuid[])"


# Read tests built on those sets, one per kind of key a row is reached through
_SEES_ACCOUNT = _in_set("account_id", ACCESSIBLE_ACCOUNT_IDS)
_SEES_BASE_BUDGET = _in_set("base_budget_id", ACCESSIBLE_BASE_BUDGET_IDS)
_SEES_GROUP = _in_set("group_id", ACCESSIBLE_GROUP_IDS)

# Whether the bank connection a row names is one the current user can see
_SEES_CONNECTION = "EXISTS (SELECT 1 FROM public.bank_connections c WHERE c.id = connection_id)"

# Whether the ledger transaction a row names is one the current user can see
_SEES_LEDGER_ROW = "EXISTS (SELECT 1 FROM public.transactions t WHERE t.id = transaction_id)"

# Whether the merchant or category a row names, when it names one, is one the current user can see
_SEES_NAMED_MERCHANT = "(merchant_id IS NULL OR EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = merchant_id))"
_SEES_NAMED_CATEGORY = "(category_id IS NULL OR EXISTS (SELECT 1 FROM public.categories c WHERE c.id = category_id))"

# (table, USING, WITH CHECK) for tables secured by a single policy. A read rule on a table
# holding personal rows tests membership in a set worked out once per statement, so a read
# narrows to the caller's rows by key. A write rule checks only the rows written, so it calls
# the row helper. Where a table's set is worked out by reading the table itself, the USING
# clause also lists the direct owner and group-admin tests so a creator can read back the row
# it just inserted, since the set comes from a snapshot that predates the row inside the same
# INSERT ... RETURNING statement. Tables only grouped resources fill keep their row helpers
SECURED_TABLES = (
    (
        "accounts",
        f"owner_id = {CURRENT_USER_ID}() OR {_in_set('group_id', ADMINISTERED_GROUP_IDS)} OR {_in_set('id', ACCESSIBLE_ACCOUNT_IDS)}",
        f"owner_id = {CURRENT_USER_ID}() OR {CAN_ACCESS_GROUP}(group_id)",
    ),
    ("account_balance_snapshots", _SEES_ACCOUNT, f"{CAN_ACCESS_ACCOUNT}(account_id)"),
    ("account_permissions", f"{CAN_ACCESS_ACCOUNT}(account_id)", f"{CAN_ACCESS_ACCOUNT}(account_id)"),
    ("account_import_layouts", _SEES_ACCOUNT, f"{CAN_ACCESS_ACCOUNT}(account_id)"),
    ("account_import_sources", _SEES_ACCOUNT, f"{CAN_ACCESS_ACCOUNT}(account_id)"),
    ("transactions", _SEES_ACCOUNT, f"{CAN_ACCESS_ACCOUNT}(account_id)"),
    (
        "base_budgets",
        f"owner_id = {CURRENT_USER_ID}() OR {_in_set('group_id', ADMINISTERED_GROUP_IDS)} OR {_in_set('id', ACCESSIBLE_BASE_BUDGET_IDS)}",
        f"owner_id = {CURRENT_USER_ID}() OR {CAN_ACCESS_GROUP}(group_id)",
    ),
    ("budgets", _SEES_BASE_BUDGET, f"{CAN_ACCESS_BASE_BUDGET}(base_budget_id)"),
    ("budget_tracked_categories", _SEES_BASE_BUDGET, f"{CAN_ACCESS_BASE_BUDGET}(base_budget_id)"),
    ("budget_permissions", f"{CAN_ACCESS_BASE_BUDGET}(base_budget_id)", f"{CAN_ACCESS_BASE_BUDGET}(base_budget_id)"),
    ("group_members", f"{CAN_ACCESS_GROUP}(group_id)", f"{CAN_ACCESS_GROUP}(group_id)"),
    ("group_cache_states", f"{CAN_ACCESS_GROUP}(group_id)", f"{CAN_ACCESS_GROUP}(group_id)"),
    # The one row is every user's to read and move, but never without a signed-in identity
    ("shared_cache_state", f"{CURRENT_USER_ID}() IS NOT NULL", f"{CURRENT_USER_ID}() IS NOT NULL"),
    ("user_cache_states", f"user_id = {CURRENT_USER_ID}()", f"user_id = {CURRENT_USER_ID}()"),
    ("user_runway_accounts", f"user_id = {CURRENT_USER_ID}()", f"user_id = {CURRENT_USER_ID}() AND {CAN_ACCESS_ACCOUNT}(account_id)"),
    ("user_credit_excluded_accounts", f"user_id = {CURRENT_USER_ID}()", f"user_id = {CURRENT_USER_ID}() AND {CAN_ACCESS_ACCOUNT}(account_id)"),
    ("saved_insights_ranges", f"user_id = {CURRENT_USER_ID}()", f"user_id = {CURRENT_USER_ID}()"),
    ("user_last_sign_ins", f"user_id = {CURRENT_USER_ID}()", f"user_id = {CURRENT_USER_ID}()"),
    # Who added an institution is the adder's alone to read, though the institution is everyone's
    ("institution_submissions", f"user_id = {CURRENT_USER_ID}()", f"user_id = {CURRENT_USER_ID}()"),
    ("import_runs", f"owner_id = {CURRENT_USER_ID}()", f"owner_id = {CURRENT_USER_ID}()"),
    ("import_staged_rows", f"owner_id = {CURRENT_USER_ID}()", f"owner_id = {CURRENT_USER_ID}()"),
    # Bank sync records belong to their owner, and those tied to an account also need
    # access to it. Foreign keys skip row-level security, so a write naming a connection or a
    # ledger row also has to see it. That keeps one user from attaching rows to another's
    ("bank_connections", f"owner_id = {CURRENT_USER_ID}()", f"owner_id = {CURRENT_USER_ID}()"),
    ("bank_provider_requests", f"owner_id = {CURRENT_USER_ID}()", f"owner_id = {CURRENT_USER_ID}() AND {_SEES_CONNECTION}"),
    ("bank_external_accounts", f"owner_id = {CURRENT_USER_ID}()", f"owner_id = {CURRENT_USER_ID}() AND {_SEES_CONNECTION}"),
    (
        "bank_account_links",
        f"owner_id = {CURRENT_USER_ID}() AND {_SEES_ACCOUNT}",
        f"owner_id = {CURRENT_USER_ID}() AND {CAN_ACCESS_ACCOUNT}(account_id) AND (connection_id IS NULL OR {_SEES_CONNECTION})",
    ),
    (
        "bank_transactions",
        f"owner_id = {CURRENT_USER_ID}() AND {_SEES_ACCOUNT}",
        f"owner_id = {CURRENT_USER_ID}() AND {CAN_ACCESS_ACCOUNT}(account_id) AND (transaction_id IS NULL OR {_SEES_LEDGER_ROW})",
    ),
    (
        "bank_pending_transactions",
        f"owner_id = {CURRENT_USER_ID}() AND {_SEES_ACCOUNT}",
        f"owner_id = {CURRENT_USER_ID}() AND {CAN_ACCESS_ACCOUNT}(account_id)",
    ),
    (
        "bank_holds",
        f"owner_id = {CURRENT_USER_ID}() AND {_SEES_ACCOUNT}",
        f"owner_id = {CURRENT_USER_ID}() AND {CAN_ACCESS_ACCOUNT}(account_id)",
    ),
    ("bank_sync_jobs", f"owner_id = {CURRENT_USER_ID}()", f"owner_id = {CURRENT_USER_ID}() AND {_SEES_CONNECTION}"),
    (
        "bank_authorizations",
        f"owner_id = {CURRENT_USER_ID}()",
        f"owner_id = {CURRENT_USER_ID}() AND (connection_id IS NULL OR {_SEES_CONNECTION}) "
        f"AND (return_account_id IS NULL OR {CAN_ACCESS_ACCOUNT}(return_account_id))",
    ),
    ("users", f"id = {CURRENT_USER_ID}()", f"id = {CURRENT_USER_ID}()"),
    (
        "tags",
        f"owner_id = {CURRENT_USER_ID}() OR {_SEES_GROUP}",
        f"owner_id = {CURRENT_USER_ID}() OR {CAN_ACCESS_GROUP}(group_id)",
    ),
    (
        "tax_advantaged_categories",
        f"category_owner_user_id = {CURRENT_USER_ID}() OR {_SEES_GROUP}",
        f"category_owner_user_id = {CURRENT_USER_ID}() OR {CAN_ACCESS_GROUP}(group_id)",
    ),
    (
        "tax_advantaged_category_limits",
        "EXISTS (SELECT 1 FROM public.tax_advantaged_categories t WHERE t.id = tax_advantaged_category_id)",
        "EXISTS (SELECT 1 FROM public.tax_advantaged_categories t WHERE t.id = tax_advantaged_category_id)",
    ),
    (
        "transaction_links",
        "EXISTS (SELECT 1 FROM public.transactions t WHERE t.id = refund_transaction_id) "
        "AND EXISTS (SELECT 1 FROM public.transactions t WHERE t.id = original_transaction_id)",
        "EXISTS (SELECT 1 FROM public.transactions t WHERE t.id = refund_transaction_id) "
        "AND EXISTS (SELECT 1 FROM public.transactions t WHERE t.id = original_transaction_id)",
    ),
    (
        "transaction_tags",
        "EXISTS (SELECT 1 FROM public.transactions t WHERE t.id = transaction_id)",
        "EXISTS (SELECT 1 FROM public.transactions t WHERE t.id = transaction_id) AND EXISTS (SELECT 1 FROM public.tags g WHERE g.id = tag_id)",
    ),
    # Foreign keys skip row-level security, so a rule naming a merchant or category also has to see
    # it. That keeps one user from putting another's, found by id, on a rule of their own
    (
        "import_rules",
        f"owner_id = {CURRENT_USER_ID}()",
        f"owner_id = {CURRENT_USER_ID}() AND {_SEES_NAMED_MERCHANT} AND {_SEES_NAMED_CATEGORY}",
    ),
    (
        "import_rule_tags",
        "EXISTS (SELECT 1 FROM public.import_rules r WHERE r.id = import_rule_id)",
        "EXISTS (SELECT 1 FROM public.import_rules r WHERE r.id = import_rule_id) AND EXISTS (SELECT 1 FROM public.tags g WHERE g.id = tag_id)",
    ),
)

# Tables the app role reads with no per-row scoping, either because every authenticated
# user reads the same reference rows or because the row describes the deployment itself
GLOBAL_READ_TABLES = (
    "bank_sync_heartbeat",
    "bank_transaction_key_fingerprint",
    "currencies",
    "encryption_key_fingerprint",
    "institutions",
)

# Auth tables stay out of RLS because the login and token flows query them before a
# request identity exists, always by exact id, so the queries already scope them
AUTH_TABLES = (
    "auth_identities",
    "password_credentials",
    "auth_sessions",
    "auth_tokens",
    "password_reset_tokens",
    "email_change_requests",
    "login_lockouts",
    "signup_email_sends",
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
        # A table added after the bootstrap RLS migration is created by its own later
        # migration, so a from-scratch upgrade reaches this loop before that table exists.
        # The apply-rls run after migrations is what grants it
        if not _table_exists(connection, table):
            continue
        connection.execute(text(f'GRANT SELECT ON public.{table} TO "{APP_DB_USER}"'))
    # Institutions are submitted and corrected by the users who read them, so the app role
    # writes the table as well, while the rest of the global-read tables stay read-only to it
    connection.execute(text(f'GRANT INSERT, UPDATE ON public.institutions TO "{APP_DB_USER}"'))
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
    return connection.execute(text("SELECT to_regclass(:qualified)"), {"qualified": f"public.{table}"}).scalar() is not None


def _column_exists(connection: Connection, table: str, column: str) -> bool:
    """Whether a column is already present on a public table"""
    return (
        connection.execute(
            text("SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = :table AND column_name = :column"),
            {"table": table, "column": column},
        ).scalar()
        is not None
    )


def secure_registered_table(connection: Connection, table: str) -> None:
    """Enable row-level security on one already-created table using its registered policy

    Incremental migrations that add a secured table call this so the single SECURED_TABLES
    definition stays the only source of the table's access rule. That rule is today's, so it can
    name a helper newer than the migration. The set helpers are created first for that reason, and a
    rule naming any other new helper needs it created here too, or upgrading an older database fails
    """
    for name, using_expr, check_expr in SECURED_TABLES:
        if name == table:
            create_set_helpers(connection)
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


def grant_global_read_table(connection: Connection, table: str) -> None:
    """Grant the app role on one global-read table added after the bootstrap migration

    Global-read tables carry no row-level policy, so an incremental migration that adds one
    calls this to give the app role the read access the bootstrap grants the original ones
    """
    if table not in GLOBAL_READ_TABLES:
        raise KeyError(f"{table!r} is not a registered global-read table")
    connection.execute(text(f'GRANT SELECT ON public.{table} TO "{APP_DB_USER}"'))


def drop_policies(connection: Connection) -> None:
    """Drop every policy and disable row-level security on every public table"""
    connection.execute(
        text(
            "DO $$ DECLARE r record; BEGIN "
            "FOR r IN SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public' LOOP "
            "EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename); "
            "END LOOP; "
            "FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP "
            "EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', r.tablename); "
            "END LOOP; END $$"
        )
    )


def _secure_table(connection: Connection, table: str, using_expr: str, check_expr: str) -> None:
    """Enable RLS on a table, add its single access policy, and grant the app role"""
    connection.execute(text(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY"))
    connection.execute(text(f"CREATE POLICY {table}_access ON public.{table} USING ({using_expr}) WITH CHECK ({check_expr})"))
    connection.execute(text(f'GRANT {APP_TABLE_PRIVILEGES} ON public.{table} TO "{APP_DB_USER}"'))


def _secure_categories(connection: Connection) -> None:
    """Enable RLS on categories, keeping system rows readable but app-immutable"""
    connection.execute(text("ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY"))
    connection.execute(
        text(
            "CREATE POLICY categories_read ON public.categories FOR SELECT"
            f" USING (is_system OR owner_id = {CURRENT_USER_ID}() OR {_SEES_GROUP})"
        )
    )

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
    connection.execute(
        text(
            f"CREATE POLICY merchants_read ON public.merchants FOR SELECT USING (is_system OR owner_id = {CURRENT_USER_ID}() OR {_SEES_GROUP})"
        )
    )

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
