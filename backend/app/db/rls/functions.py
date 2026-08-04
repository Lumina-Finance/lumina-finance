"""Row-level security helper functions

Each helper that reads tables is SECURITY DEFINER so it runs as the migrator and
bypasses RLS, which both lets the policies see real membership and stops a policy that
queries a table from recursing into that table's own policy. Every helper is paired
with the signature needed to drop it, so adding one is a single edit and revoking can
never leave a function behind

A helper whose argument list changes is a new function rather than a replacement, so the
signature it used to have is retired through the obsolete list below and dropped by both
the apply and the revoke path
"""

from typing import NamedTuple

from sqlalchemy import Connection, text

# Schema-qualified helper names, the single source reused by the policies and the
# application call sites so a rename is one edit rather than a search across files
CURRENT_USER_ID = "public.current_user_id"
IS_GROUP_ADMIN = "public.is_group_admin"
CAN_ACCESS_ACCOUNT = "public.can_access_account"
CAN_ACCESS_GROUP = "public.can_access_group"
CAN_ACCESS_BASE_BUDGET = "public.can_access_base_budget"
FIND_LOGIN_USER = "public.find_login_user"
USER_TZ = "public.user_tz"
BUMP_GROUP_MEMBER_CACHE = "public.bump_group_member_cache"
BUDGET_SPEND_ROWS = "public.budget_spend_rows"

# Signatures the app no longer creates, dropped wherever the helpers are applied or revoked.
# bump_user_cache stamped whatever user id it was given, and the app role can execute every
# function in the schema, so leaving it on an already-provisioned database would keep any
# authenticated user able to invalidate any other user's cache
_OBSOLETE_SIGNATURES: tuple[str, ...] = ("public.bump_user_cache(uuid)",)


class _Helper(NamedTuple):
    """A helper's creation statement paired with the signature used to drop it"""

    create_sql: str

    # Schema-qualified name and argument types, e.g. public.user_tz(uuid)
    drop_signature: str


_HELPERS: tuple[_Helper, ...] = (
    # Read the per-request user identity the app sets, or NULL when it is unset so
    # unauthenticated and maintenance connections simply match no rows
    _Helper(
        f"""
    CREATE OR REPLACE FUNCTION {CURRENT_USER_ID}() RETURNS uuid
    LANGUAGE sql STABLE SET search_path = '' AS $$
        SELECT nullif(current_setting('app.current_user_id', true), '')::uuid
    $$
    """,
        f"{CURRENT_USER_ID}()",
    ),
    # Whether the current user is an admin of a group, used both by the access
    # helpers and directly in policies so a creator passes on its own group id
    _Helper(
        f"""
    CREATE OR REPLACE FUNCTION {IS_GROUP_ADMIN}(p_group_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
        SELECT EXISTS (
            SELECT 1 FROM public.group_members gm
            WHERE gm.group_id = p_group_id AND gm.user_id = {CURRENT_USER_ID}() AND gm.is_admin
        )
    $$
    """,
        f"{IS_GROUP_ADMIN}(uuid)",
    ),
    # An account is visible to its personal owner, an admin of its owning group, or
    # a member holding an explicit account permission
    _Helper(
        f"""
    CREATE OR REPLACE FUNCTION {CAN_ACCESS_ACCOUNT}(p_account_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
        SELECT EXISTS (
            SELECT 1 FROM public.accounts a WHERE a.id = p_account_id AND (
                a.owner_id = {CURRENT_USER_ID}()
                OR {IS_GROUP_ADMIN}(a.group_id)
                OR EXISTS (
                    SELECT 1 FROM public.account_permissions ap
                    WHERE ap.account_id = a.id AND ap.user_id = {CURRENT_USER_ID}()
                )
            )
        )
    $$
    """,
        f"{CAN_ACCESS_ACCOUNT}(uuid)",
    ),
    # A group is visible to its owner and to any member
    _Helper(
        f"""
    CREATE OR REPLACE FUNCTION {CAN_ACCESS_GROUP}(p_group_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
        SELECT EXISTS (
            SELECT 1 FROM public.groups g WHERE g.id = p_group_id AND (
                g.owner_id = {CURRENT_USER_ID}()
                OR EXISTS (
                    SELECT 1 FROM public.group_members gm
                    WHERE gm.group_id = g.id AND gm.user_id = {CURRENT_USER_ID}()
                )
            )
        )
    $$
    """,
        f"{CAN_ACCESS_GROUP}(uuid)",
    ),
    # A base budget is visible to its personal owner, an admin of its owning group,
    # or a member holding an explicit budget permission
    _Helper(
        f"""
    CREATE OR REPLACE FUNCTION {CAN_ACCESS_BASE_BUDGET}(p_base_budget_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
        SELECT EXISTS (
            SELECT 1 FROM public.base_budgets b WHERE b.id = p_base_budget_id AND (
                b.owner_id = {CURRENT_USER_ID}()
                OR {IS_GROUP_ADMIN}(b.group_id)
                OR EXISTS (
                    SELECT 1 FROM public.budget_permissions bp
                    WHERE bp.base_budget_id = b.id AND bp.user_id = {CURRENT_USER_ID}()
                )
            )
        )
    $$
    """,
        f"{CAN_ACCESS_BASE_BUDGET}(uuid)",
    ),
    # Resolve a user id by email for the pre-identity login and signup flows, which run
    # before a request identity exists. Returns only the id so the definer never exposes
    # the rest of the user row outside the self-only users policy
    _Helper(
        f"""
    CREATE OR REPLACE FUNCTION {FIND_LOGIN_USER}(p_email text) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
        SELECT id FROM public.users WHERE email = p_email
    $$
    """,
        f"{FIND_LOGIN_USER}(text)",
    ),
    # Return another user's timezone for the few group operations that need it,
    # exposing only the timezone rather than the whole user row
    _Helper(
        f"""
    CREATE OR REPLACE FUNCTION {USER_TZ}(p_user_id uuid) RETURNS varchar
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
        SELECT tz FROM public.users WHERE id = p_user_id
    $$
    """,
        f"{USER_TZ}(uuid)",
    ),
    # Touch a group member's personal cache timestamp on their behalf, used when an admin
    # removing them must invalidate their cache even though the per-user write policy scopes
    # cache writes to the caller. The group is an argument rather than looked up from the
    # target's membership, because the caller has already deleted that membership by the time
    # this runs, while the caller's own is still there. plpgsql rather than sql so a denied
    # call raises instead of quietly inserting nothing, and IS DISTINCT FROM so a connection
    # carrying no identity is refused rather than comparing to NULL and falling through
    _Helper(
        f"""
    CREATE OR REPLACE FUNCTION {BUMP_GROUP_MEMBER_CACHE}(p_user_id uuid, p_group_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
    BEGIN
        IF p_user_id IS DISTINCT FROM {CURRENT_USER_ID}() AND NOT {IS_GROUP_ADMIN}(p_group_id) THEN
            RAISE EXCEPTION 'Not authorized to invalidate the cache for this user'
                USING ERRCODE = 'insufficient_privilege';
        END IF;

        INSERT INTO public.user_cache_states (user_id, changed_at, last_changed_session_id)
        VALUES (p_user_id, clock_timestamp(), NULL)
        ON CONFLICT (user_id) DO UPDATE SET changed_at = clock_timestamp(), last_changed_session_id = NULL;
    END
    $$
    """,
        f"{BUMP_GROUP_MEMBER_CACHE}(uuid, uuid)",
    ),
    # Aggregate spend per tracked category for budgets the current user can access
    # The visibility check makes the function self-authorizing rather than trusting its
    # callers, and returns category totals over accounts the reader cannot see row by
    # row, the privacy-respecting design of utilization, without ever exposing the
    # individual transactions to the app role
    _Helper(
        f"""
    CREATE OR REPLACE FUNCTION {BUDGET_SPEND_ROWS}(p_budget_ids uuid[])
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
        JOIN public.budget_tracked_categories btc
            ON btc.base_budget_id = bb.id
            AND btc.added_at <= b.period_end
            AND (btc.removed_at IS NULL OR btc.removed_at > b.period_end)
        JOIN public.transactions t ON t.category_id = btc.category_id
        JOIN public.accounts a ON t.account_id = a.id
        WHERE b.id = ANY(p_budget_ids)
            AND {CAN_ACCESS_BASE_BUDGET}(bb.id)
            AND t.dt >= b.period_start
            AND t.dt <= b.period_end
            AND (
                (bb.group_id IS NOT NULL AND a.group_id = bb.group_id)
                OR (bb.group_id IS NULL AND a.owner_id = bb.owner_id)
            )
        GROUP BY b.id, t.category_id, t.account_id, t.dt, a.currency, bb.currency
    $$
    """,
        f"{BUDGET_SPEND_ROWS}(uuid[])",
    ),
)


def create_helper_functions(connection: Connection) -> None:
    """Create every SECURITY DEFINER helper the policies and the app rely on"""
    _drop_obsolete_helper_functions(connection)
    for helper in _HELPERS:
        connection.execute(text(helper.create_sql))


def drop_helper_functions(connection: Connection) -> None:
    """Drop every helper function when row-level security is removed"""
    _drop_obsolete_helper_functions(connection)
    for helper in _HELPERS:
        connection.execute(text(f"DROP FUNCTION IF EXISTS {helper.drop_signature}"))


def _drop_obsolete_helper_functions(connection: Connection) -> None:
    """Drop retired helper signatures the app no longer creates"""
    for signature in _OBSOLETE_SIGNATURES:
        connection.execute(text(f"DROP FUNCTION IF EXISTS {signature}"))
