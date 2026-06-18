"""Row-level security helper functions and policies"""

from sqlalchemy import Connection, text

from app.config import APP_DB_USER

# Each helper that reads tables is SECURITY DEFINER so it runs as the migrator and
# bypasses RLS, which both lets the policies see real membership and stops a policy
# that queries a table from recursing into that table's own policy
_HELPER_FUNCTIONS = (
    # Read the per-request user identity the app sets, or NULL when it is unset so
    # unauthenticated and maintenance connections simply match no rows
    """
    CREATE OR REPLACE FUNCTION public.current_user_id() RETURNS uuid
    LANGUAGE sql STABLE SET search_path = '' AS $$
        SELECT nullif(current_setting('app.current_user_id', true), '')::uuid
    $$
    """,
    # Whether the current user is an admin of a group, used both by the access
    # helpers and directly in policies so a creator passes on its own group id
    """
    CREATE OR REPLACE FUNCTION public.is_group_admin(p_group_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
        SELECT EXISTS (
            SELECT 1 FROM public.group_members gm
            WHERE gm.group_id = p_group_id AND gm.user_id = public.current_user_id() AND gm.is_admin
        )
    $$
    """,
    # An account is visible to its personal owner, an admin of its owning group, or
    # a member holding an explicit account permission
    """
    CREATE OR REPLACE FUNCTION public.can_access_account(p_account_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
        SELECT EXISTS (
            SELECT 1 FROM public.accounts a WHERE a.id = p_account_id AND (
                a.owner_id = public.current_user_id()
                OR public.is_group_admin(a.group_id)
                OR EXISTS (
                    SELECT 1 FROM public.account_permissions ap
                    WHERE ap.account_id = a.id AND ap.user_id = public.current_user_id()
                )
            )
        )
    $$
    """,
    # A group is visible to its owner and to any member
    """
    CREATE OR REPLACE FUNCTION public.can_access_group(p_group_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
        SELECT EXISTS (
            SELECT 1 FROM public.groups g WHERE g.id = p_group_id AND (
                g.owner_id = public.current_user_id()
                OR EXISTS (
                    SELECT 1 FROM public.group_members gm
                    WHERE gm.group_id = g.id AND gm.user_id = public.current_user_id()
                )
            )
        )
    $$
    """,
    # A base budget is visible to its personal owner, an admin of its owning group,
    # or a member holding an explicit budget permission
    """
    CREATE OR REPLACE FUNCTION public.can_access_base_budget(p_base_budget_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
        SELECT EXISTS (
            SELECT 1 FROM public.base_budgets b WHERE b.id = p_base_budget_id AND (
                b.owner_id = public.current_user_id()
                OR public.is_group_admin(b.group_id)
                OR EXISTS (
                    SELECT 1 FROM public.budget_permissions bp
                    WHERE bp.base_budget_id = b.id AND bp.user_id = public.current_user_id()
                )
            )
        )
    $$
    """,
    # Look up a user by email for the pre-identity login flow, which runs before any
    # request identity exists and so cannot pass the users policy
    """
    CREATE OR REPLACE FUNCTION public.find_login_user(p_email text) RETURNS SETOF public.users
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
        SELECT * FROM public.users WHERE email = p_email
    $$
    """,
    # Return another user's timezone for the few group operations that need it,
    # exposing only the timezone rather than the whole user row
    """
    CREATE OR REPLACE FUNCTION public.user_tz(p_user_id uuid) RETURNS varchar
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
        SELECT tz FROM public.users WHERE id = p_user_id
    $$
    """,
    # Touch a user's personal cache timestamp on their behalf, used when an authorized
    # action by another user, such as removing them from a group, must invalidate their
    # cache even though the per-user write policy scopes cache writes to the caller
    """
    CREATE OR REPLACE FUNCTION public.bump_user_cache(p_user_id uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
        INSERT INTO public.user_cache_states (user_id, changed_at, last_changed_session_id)
        VALUES (p_user_id, clock_timestamp(), NULL)
        ON CONFLICT (user_id) DO UPDATE SET changed_at = clock_timestamp(), last_changed_session_id = NULL
    $$
    """,
)


# Table privileges the app role holds on the data it serves
_APP_TABLE_PRIVILEGES = "SELECT, INSERT, UPDATE, DELETE"

# (table, USING, WITH CHECK) for tables secured by a single policy. Function calls
# are schema-qualified so a changed search_path cannot route them to a different
# function. Where a table's read helper resolves access by reading the table itself,
# the USING clause also lists the direct owner and group-admin predicates so a
# creator can read back the row it just inserted, since the helper evaluates against
# a snapshot that predates the row inside the same INSERT ... RETURNING statement
_SECURED_TABLES = (
    ("accounts",
     "owner_id = public.current_user_id() OR public.is_group_admin(group_id) OR public.can_access_account(id)",
     "owner_id = public.current_user_id() OR public.can_access_group(group_id)"),
    ("account_balance_snapshots", "public.can_access_account(account_id)",
     "public.can_access_account(account_id)"),
    ("account_permissions", "public.can_access_account(account_id)",
     "public.can_access_account(account_id)"),
    ("transactions", "public.can_access_account(account_id)",
     "public.can_access_account(account_id)"),
    ("base_budgets",
     "owner_id = public.current_user_id() OR public.is_group_admin(group_id) OR public.can_access_base_budget(id)",
     "owner_id = public.current_user_id() OR public.can_access_group(group_id)"),
    ("budgets", "public.can_access_base_budget(base_budget_id)",
     "public.can_access_base_budget(base_budget_id)"),
    ("budget_tracked_categories", "public.can_access_base_budget(base_budget_id)",
     "public.can_access_base_budget(base_budget_id)"),
    ("budget_permissions", "public.can_access_base_budget(base_budget_id)",
     "public.can_access_base_budget(base_budget_id)"),
    ("group_members", "public.can_access_group(group_id)", "public.can_access_group(group_id)"),
    ("group_cache_states", "public.can_access_group(group_id)", "public.can_access_group(group_id)"),
    ("user_cache_states", "user_id = public.current_user_id()", "user_id = public.current_user_id()"),
    ("user_runway_accounts", "user_id = public.current_user_id()",
     "user_id = public.current_user_id() AND public.can_access_account(account_id)"),
    ("users", "id = public.current_user_id()", "id = public.current_user_id()"),
    ("merchants", "owner_id = public.current_user_id() OR public.can_access_group(group_id)",
     "owner_id = public.current_user_id() OR public.can_access_group(group_id)"),
    ("tags", "owner_id = public.current_user_id() OR public.can_access_group(group_id)",
     "owner_id = public.current_user_id() OR public.can_access_group(group_id)"),
    ("tax_advantaged_categories",
     "category_owner_user_id = public.current_user_id() OR public.can_access_group(group_id)",
     "category_owner_user_id = public.current_user_id() OR public.can_access_group(group_id)"),
    ("tax_advantaged_category_limits",
     "EXISTS (SELECT 1 FROM public.tax_advantaged_categories t WHERE t.id = tax_advantaged_category_id)",
     "EXISTS (SELECT 1 FROM public.tax_advantaged_categories t WHERE t.id = tax_advantaged_category_id)"),
    ("transaction_tags",
     "EXISTS (SELECT 1 FROM public.transactions t WHERE t.id = transaction_id)",
     "EXISTS (SELECT 1 FROM public.transactions t WHERE t.id = transaction_id) "
     "AND EXISTS (SELECT 1 FROM public.tags g WHERE g.id = tag_id)"),
)

# Reference tables every authenticated user reads, with no per-row scoping
_GLOBAL_READ_TABLES = ("currencies", "institutions")

# Auth tables stay out of RLS because the login and token flows query them before a
# request identity exists, always by exact id, so the queries already scope them
_AUTH_TABLES = ("auth_identities", "password_credentials", "auth_sessions", "auth_tokens")

# Helper signatures, needed to drop them when row-level security is removed
_HELPER_SIGNATURES = (
    "current_user_id()",
    "is_group_admin(uuid)",
    "can_access_account(uuid)",
    "can_access_group(uuid)",
    "can_access_base_budget(uuid)",
    "find_login_user(text)",
    "user_tz(uuid)",
    "bump_user_cache(uuid)",
)


def apply_rls(connection: Connection) -> None:
    """Create the RLS helpers, enable the policies, and grant the app role access"""
    for function_sql in _HELPER_FUNCTIONS:
        connection.execute(text(function_sql))

    for table, using_expr, check_expr in _SECURED_TABLES:
        _secure_table(connection, table, using_expr, check_expr)
    _secure_categories(connection)
    _secure_groups(connection)

    for table in _GLOBAL_READ_TABLES:
        connection.execute(text(f'GRANT SELECT ON public.{table} TO "{APP_DB_USER}"'))
    connection.execute(text(f'GRANT INSERT ON public.institutions TO "{APP_DB_USER}"'))
    for table in _AUTH_TABLES:
        connection.execute(text(f'GRANT {_APP_TABLE_PRIVILEGES} ON public.{table} TO "{APP_DB_USER}"'))

    # The app role evaluates the policies and the auth flows, so it must execute the
    # helpers, while their SECURITY DEFINER owner is what reaches the underlying rows
    connection.execute(text(f'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO "{APP_DB_USER}"'))


def revoke_rls(connection: Connection) -> None:
    """Drop every policy, disable row-level security, and remove the helpers"""
    connection.execute(text(
        "DO $$ DECLARE r record; BEGIN "
        "FOR r IN SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public' LOOP "
        "EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename); "
        "END LOOP; "
        "FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP "
        "EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', r.tablename); "
        "END LOOP; END $$"
    ))
    for signature in _HELPER_SIGNATURES:
        connection.execute(text(f"DROP FUNCTION IF EXISTS public.{signature}"))


def _secure_table(connection: Connection, table: str, using_expr: str, check_expr: str) -> None:
    """Enable RLS on a table, add its single access policy, and grant the app role"""
    connection.execute(text(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY"))
    connection.execute(text(
        f"CREATE POLICY {table}_access ON public.{table} USING ({using_expr}) WITH CHECK ({check_expr})"
    ))
    connection.execute(text(f'GRANT {_APP_TABLE_PRIVILEGES} ON public.{table} TO "{APP_DB_USER}"'))


def _secure_categories(connection: Connection) -> None:
    """Enable RLS on categories, keeping system rows readable but app-immutable"""
    connection.execute(text("ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY"))
    connection.execute(text(
        "CREATE POLICY categories_read ON public.categories FOR SELECT "
        "USING (is_system OR owner_id = public.current_user_id() OR public.can_access_group(group_id))"
    ))

    # System categories are seeded by the migrator, so the app role can only write
    # its own personal or group categories
    scoped = "(owner_id = public.current_user_id() OR public.can_access_group(group_id)) AND NOT is_system"
    connection.execute(text(f"CREATE POLICY categories_insert ON public.categories FOR INSERT WITH CHECK ({scoped})"))
    connection.execute(text(f"CREATE POLICY categories_update ON public.categories FOR UPDATE USING ({scoped}) WITH CHECK ({scoped})"))
    connection.execute(text(f"CREATE POLICY categories_delete ON public.categories FOR DELETE USING ({scoped})"))
    connection.execute(text(f'GRANT {_APP_TABLE_PRIVILEGES} ON public.categories TO "{APP_DB_USER}"'))


def _secure_groups(connection: Connection) -> None:
    """Enable RLS on groups, created by their owner and managed by their members"""
    connection.execute(text("ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY"))
    access = "public.can_access_group(id)"

    # The read policy also accepts the direct owner check so a creator can read back
    # the group it just inserted, before the access helper can observe the new row in
    # the same INSERT ... RETURNING statement
    read_access = f"owner_id = public.current_user_id() OR {access}"
    connection.execute(text(f"CREATE POLICY groups_read ON public.groups FOR SELECT USING ({read_access})"))
    connection.execute(text("CREATE POLICY groups_insert ON public.groups FOR INSERT WITH CHECK (owner_id = public.current_user_id())"))
    connection.execute(text(f"CREATE POLICY groups_update ON public.groups FOR UPDATE USING ({access}) WITH CHECK ({access})"))
    connection.execute(text(f"CREATE POLICY groups_delete ON public.groups FOR DELETE USING ({access})"))
    connection.execute(text(f'GRANT {_APP_TABLE_PRIVILEGES} ON public.groups TO "{APP_DB_USER}"'))
