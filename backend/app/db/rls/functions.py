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

from app.config.imports import ABANDONED_RUN_AGE, IMPORT_UNDO_WINDOW
from app.models.bank_connection import FRESH_DISCOVERY_AGE
from app.models.bank_sync_job import CLAIM_RANK

# Schema-qualified helper names, the single source reused by the policies and the
# application call sites so a rename is one edit rather than a search across files
CURRENT_USER_ID = "public.current_user_id"
IS_GROUP_ADMIN = "public.is_group_admin"
CAN_ACCESS_ACCOUNT = "public.can_access_account"
CAN_ACCESS_GROUP = "public.can_access_group"
CAN_ACCESS_BASE_BUDGET = "public.can_access_base_budget"
FIND_LOGIN_USER = "public.find_login_user"
FIND_LOGIN_ACCOUNT = "public.find_login_account"
USER_TZ = "public.user_tz"
BUMP_GROUP_MEMBER_CACHE = "public.bump_group_member_cache"
BUDGET_SPEND_ROWS = "public.budget_spend_rows"
PRUNE_EXPIRED_IMPORT_RUNS = "public.prune_expired_import_runs"
CLAIM_BANK_SYNC_JOBS = "public.claim_bank_sync_jobs"
LIST_DUE_BANK_CONNECTIONS = "public.list_due_bank_connections"
RECORD_BANK_SYNC_SCAN = "public.record_bank_sync_scan"
PRUNE_FINISHED_BANK_SYNC_JOBS = "public.prune_finished_bank_sync_jobs"
MIGRATION_REVISIONS = "public.migration_revisions"

# The worker functions see across users. Only the worker, connecting with no request
# identity, may do that. Refusing a call made under an identity keeps a request from reaching them
_REFUSE_UNDER_A_REQUEST_IDENTITY = f"""
        IF {CURRENT_USER_ID}() IS NOT NULL THEN
            RAISE EXCEPTION 'Only the bank sync worker may call this'
                USING ERRCODE = 'insufficient_privilege';
        END IF;"""

# A claimed job's kind ranked in claim order, from the job model's ranking. The merge of new work into a
# queued job ranks by the model in Python, and the claim function holds this copy, so a change to the
# ranking reaches a database only through a migration that recreates the helpers
_CLAIM_RANK_OF_KIND = "CASE j.kind " + " ".join(f"WHEN '{kind}' THEN {rank}" for kind, rank in CLAIM_RANK.items()) + " END"

# The connection model's age at which a listing is no longer fresh, as an interval. The link flow
# compares against the model in Python, and the due scan function holds this copy, so a change to the
# age reaches a database only through a migration that recreates the helpers
_FRESH_DISCOVERY_AGE = f"interval '{int(FRESH_DISCOVERY_AGE.total_seconds())} seconds'"

# How long a claimed job holds its claim before another run may take it. The worker's job time limit is
# set well inside it, so a job is stopped before a later attempt could claim it. Copied into the claim
# function, so a change reaches a database only through a migration that recreates the helpers
_JOB_LEASE = "interval '10 minutes'"

# How long a finished job row is kept before the expired-record cleanup deletes it, the retention the
# design sets for job rows. Copied into the function that prunes them, so a change reaches a database
# only through a migration that recreates the helpers
_FINISHED_JOB_RETENTION = "interval '30 days'"

# Signatures the app no longer creates, dropped wherever the helpers are applied or revoked.
# bump_user_cache stamped whatever user id it was given, and the app role can execute every
# function in the schema, so leaving it on an already-provisioned database would keep any
# authenticated user able to invalidate any other user's cache
_OBSOLETE_SIGNATURES: tuple[str, ...] = (
    "public.bump_user_cache(uuid)",
    f"{BUDGET_SPEND_ROWS}(uuid[])",
)


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
    # the rest of the user row outside the self-only users policy. The comparison folds A to Z on
    # both sides through the C collation, in step with the unique index and fold_email in Python, so
    # one address is one account however it is typed, on any database locale
    _Helper(
        f"""
    CREATE OR REPLACE FUNCTION {FIND_LOGIN_USER}(p_email text) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
        SELECT id FROM public.users WHERE lower(email COLLATE "C") = lower(p_email COLLATE "C")
    $$
    """,
        f"{FIND_LOGIN_USER}(text)",
    ),
    # The same lookup for a flow that must reach the account's own mailbox, also returning the address
    # as stored. The caller already holds the address, so this adds only its stored capitals. It
    # takes an address rather than an id so it never turns an id into an email
    _Helper(
        f"""
    CREATE OR REPLACE FUNCTION {FIND_LOGIN_ACCOUNT}(p_email text) RETURNS TABLE (id uuid, email text)
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
        SELECT u.id, u.email FROM public.users u WHERE lower(u.email COLLATE "C") = lower(p_email COLLATE "C")
    $$
    """,
        f"{FIND_LOGIN_ACCOUNT}(text)",
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
    # cache writes to the caller. Both halves are needed: administering the named group alone
    # would let anyone stamp any user, since creating a group makes the creator its admin, so
    # the target has to be a member of that same group. The caller must therefore stamp before
    # deleting the membership. This narrows the reachable set rather than closing it, because
    # an admin can add a user to their own group without that user agreeing, so the caller
    # still gets there with the target's id and one extra call. plpgsql rather than sql so a
    # denied call raises instead of quietly inserting nothing, and a null target or a
    # connection carrying no identity is refused outright rather than compared to NULL
    _Helper(
        f"""
    CREATE OR REPLACE FUNCTION {BUMP_GROUP_MEMBER_CACHE}(p_user_id uuid, p_group_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
    BEGIN
        IF p_user_id IS NULL OR (p_user_id IS DISTINCT FROM {CURRENT_USER_ID}() AND NOT (
            {IS_GROUP_ADMIN}(p_group_id)
            AND EXISTS (
                SELECT 1 FROM public.group_members gm
                WHERE gm.group_id = p_group_id AND gm.user_id = p_user_id
            )
        )) THEN
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
    CREATE OR REPLACE FUNCTION {BUDGET_SPEND_ROWS}(p_budget_ids uuid[], p_now timestamptz)
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
            AND {CAN_ACCESS_BASE_BUDGET}(bb.id)
            AND t.dt >= b.period_start
            AND t.dt <= b.period_end
            AND t.dt <= (p_now AT TIME ZONE budget_owner.tz)::date
            AND (
                (bb.group_id IS NOT NULL AND a.group_id = bb.group_id)
                OR (bb.group_id IS NULL AND a.owner_id = bb.owner_id)
            )
        GROUP BY b.id, t.category_id, t.account_id, t.dt, a.currency, bb.currency
    $$
    """,
        f"{BUDGET_SPEND_ROWS}(uuid[], timestamptz)",
    ),
    # Deletes every user's runs that were abandoned before being committed or are past their undo
    # window, which a sweep with no request identity could not see through the owner policy. The
    # lifetimes are written into the body rather than taken as arguments, since the app role can
    # execute every helper and must not be able to choose a shorter one. A run another transaction
    # holds is skipped rather than waited on: a commit holding it either lands, and the run is no
    # longer expired, or refuses it as abandoned. Written in plpgsql so creating it does not check
    # the table exists, since migrations that predate import runs create every current helper
    _Helper(
        f"""
    CREATE OR REPLACE FUNCTION {PRUNE_EXPIRED_IMPORT_RUNS}() RETURNS integer
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
    DECLARE
        pruned integer;
    BEGIN
        WITH expired AS (
            SELECT r.id FROM public.import_runs r
            WHERE (
                r.committed_at IS NULL
                AND r.created_at < now() - make_interval(secs => {int(ABANDONED_RUN_AGE.total_seconds())})
            )
            OR r.committed_at < now() - make_interval(secs => {int(IMPORT_UNDO_WINDOW.total_seconds())})
            FOR UPDATE SKIP LOCKED
        ), deleted AS (
            DELETE FROM public.import_runs r USING expired e WHERE r.id = e.id RETURNING 1
        )
        SELECT count(*)::integer INTO pruned FROM deleted;
        RETURN pruned;
    END
    $$
    """,
        f"{PRUNE_EXPIRED_IMPORT_RUNS}()",
    ),
    # The bank sync worker's functions are plpgsql and their bodies are resolved only when they run,
    # because the bootstrap migration creates every helper before the bank sync tables exist.
    # Each returns only what the worker needs to go on as the owning user
    #
    # Claim the next due jobs across every user, initial and manual first. A queued job waits
    # while its connection has a job running, and a running job whose lease ran out is claimed
    # again as a new attempt, so a crashed worker's job resumes and its first runner can tell it
    # no longer holds it. SKIP LOCKED keeps two workers claiming at once from taking one job
    _Helper(
        f"""
    CREATE OR REPLACE FUNCTION {CLAIM_BANK_SYNC_JOBS}(p_limit integer)
    RETURNS TABLE (job_id uuid, owner_id uuid, connection_id uuid, kind text, discover boolean, attempt integer)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
    #variable_conflict use_column
    BEGIN{_REFUSE_UNDER_A_REQUEST_IDENTITY}

        RETURN QUERY
        WITH claimable AS (
            SELECT j.id FROM public.bank_sync_jobs j
            WHERE (
                j.status = 'queued' AND j.run_after <= now()
                AND NOT EXISTS (
                    SELECT 1 FROM public.bank_sync_jobs r
                    WHERE r.connection_id = j.connection_id AND r.status = 'running'
                )
            ) OR (j.status = 'running' AND j.lease_expires_at <= now())
            ORDER BY
                {_CLAIM_RANK_OF_KIND},
                j.run_after,
                j.created_at
            LIMIT p_limit
            FOR UPDATE OF j SKIP LOCKED
        )
        UPDATE public.bank_sync_jobs j
        SET status = 'running', attempt = j.attempt + 1, lease_expires_at = now() + {_JOB_LEASE}
        FROM claimable c
        WHERE j.id = c.id
        RETURNING j.id, j.owner_id, j.connection_id, j.kind::text, j.discover, j.attempt;
    END
    $$
    """,
        f"{CLAIM_BANK_SYNC_JOBS}(integer)",
    ),
    # The connections due for a scheduled sync, by id and owner only. A rejected credential
    # stops automatic sync until the user reconnects. A connection whose bank accounts were never
    # listed, such as one whose claim stopped mid-listing, is due once nothing is queued or running
    # for it and FRESH_DISCOVERY_AGE has passed since it was claimed or its last listing failed
    _Helper(
        f"""
    CREATE OR REPLACE FUNCTION {LIST_DUE_BANK_CONNECTIONS}(p_now timestamptz)
    RETURNS TABLE (connection_id uuid, owner_id uuid)
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
    #variable_conflict use_column
    BEGIN{_REFUSE_UNDER_A_REQUEST_IDENTITY}

        RETURN QUERY
        SELECT c.id, c.owner_id FROM public.bank_connections c
        WHERE c.credential_rejected_at IS NULL
            AND (
                c.next_sync_at <= p_now
                OR (
                    c.discovered_at IS NULL
                    AND GREATEST(c.created_at, c.discovery_failed_at) <= p_now - {_FRESH_DISCOVERY_AGE}
                    AND NOT EXISTS (
                        SELECT 1 FROM public.bank_sync_jobs j
                        WHERE j.connection_id = c.id AND j.status IN ('queued', 'running')
                    )
                )
            )
        ORDER BY c.next_sync_at;
    END
    $$
    """,
        f"{LIST_DUE_BANK_CONNECTIONS}(timestamptz)",
    ),
    # Stamp the worker's heartbeat after a due scan. The heartbeat is its table's one row, id 1
    _Helper(
        f"""
    CREATE OR REPLACE FUNCTION {RECORD_BANK_SYNC_SCAN}(p_now timestamptz) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
    BEGIN{_REFUSE_UNDER_A_REQUEST_IDENTITY}

        INSERT INTO public.bank_sync_heartbeat (id, last_scan_at) VALUES (1, p_now)
        ON CONFLICT (id) DO UPDATE SET last_scan_at = EXCLUDED.last_scan_at;
    END
    $$
    """,
        f"{RECORD_BANK_SYNC_SCAN}(timestamptz)",
    ),
    # Deletes every user's jobs finished longer ago than the retention, which a sweep with no request
    # identity could not see through the owner policy. The retention is written into the body rather
    # than taken as an argument, since the app role can execute every helper and must not be able to
    # choose a shorter one. Written in plpgsql so creating it does not check the table exists
    _Helper(
        f"""
    CREATE OR REPLACE FUNCTION {PRUNE_FINISHED_BANK_SYNC_JOBS}() RETURNS integer
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
    DECLARE
        pruned integer;
    BEGIN
        WITH deleted AS (
            DELETE FROM public.bank_sync_jobs WHERE finished_at < now() - {_FINISHED_JOB_RETENTION} RETURNING 1
        )
        SELECT count(*)::integer INTO pruned FROM deleted;
        RETURN pruned;
    END
    $$
    """,
        f"{PRUNE_FINISHED_BANK_SYNC_JOBS}()",
    ),
    # The revisions the database is migrated to. The worker compares them with the head it
    # ships before it starts. The app role can't read the migration history itself, and the
    # revision says nothing about any user, so this one refuses no one. A database never
    # migrated, such as the test schema built from the models, has no history and returns none
    _Helper(
        f"""
    CREATE OR REPLACE FUNCTION {MIGRATION_REVISIONS}() RETURNS SETOF text
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
    BEGIN
        IF to_regclass('public.alembic_version') IS NULL THEN
            RETURN;
        END IF;
        RETURN QUERY SELECT version_num::text FROM public.alembic_version;
    END
    $$
    """,
        f"{MIGRATION_REVISIONS}()",
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
