"""The bootstrap and migrate jobs against a real PostgreSQL server

Each job's credentials, its repeat and its refusal to run beside another run of itself are shown
against a server of its own (tests/db/conftest.py), since bootstrap creates roles for the whole server
"""

import asyncio
import json
import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import text

from app.bank_transaction_key import KEY_ENV_VAR, KEY_FILE, generate_key, key_fingerprint
from app.config.database import APP_DB_USER, MIGRATOR_DB_USER
from app.db import provision, seeds
from app.db.bank_transaction_key import RESET_COMMAND
from app.db.jobs import SETUP_LOCK_ID, run_bootstrap, run_migrate
from app.services.categories.defaults import SYSTEM_CATEGORY_DEFAULTS
from app.services.currencies.defaults import CURRENCIES
from app.services.merchants.defaults import SYSTEM_MERCHANT_NAMES
from tests.db.support import (
    ADMIN_LOCK_TIMEOUT_SECONDS,
    APP_PASSWORD,
    LOGIN_PASSWORD,
    RESTRICTED_ADMIN_LOGIN,
    SUPERUSER_LOGIN,
    Target,
    bootstrap_environment,
    migrate_environment,
    query,
    run_job,
    run_module,
)
from tests.migrations.support import (
    BANK_SYNC_IDS,
    BANK_SYNC_SEED,
    BEFORE_BANK_SYNC_ID_HASH_REVISION,
    expected_bank_sync_hash,
)

# Seconds the tests give a job to notice another run, and to finish once it may go on
_JOB_TIMEOUT_SECONDS = 120

# Everything a run of migrate changes or reads back, in one value, so two states compare as equal
# only when no row, policy, grant or record differs. Seeded rows come whole, creation times included
_SNAPSHOT = """
    SELECT jsonb_build_object(
        'revisions', (SELECT jsonb_agg(version_num ORDER BY version_num) FROM alembic_version),
        'currencies', (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM currencies c),
        'categories', (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.name) FROM categories c),
        'merchants', (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.name) FROM merchants m),
        'encryption_key', (SELECT jsonb_agg(to_jsonb(f)) FROM encryption_key_fingerprint f),
        'bank_transaction_key', (SELECT jsonb_agg(to_jsonb(f)) FROM bank_transaction_key_fingerprint f),
        'policies', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.tablename, p.policyname) FROM pg_policies p),
        'grants', (
            SELECT jsonb_agg(to_jsonb(g) ORDER BY g.table_name, g.privilege_type)
            FROM information_schema.role_table_grants g WHERE g.grantee = '{app_role}'
        )
    )::text
"""

# What a migration hashing saved bank sync IDs would change, in one value: the revision, the bank's own
# IDs and the record of the key. The hash replaces those IDs
_BANK_ID_STATE = """
    SELECT jsonb_build_object(
        'revisions', (SELECT jsonb_agg(version_num) FROM alembic_version),
        'ids', (SELECT jsonb_agg(external_transaction_id ORDER BY external_transaction_id) FROM bank_transactions),
        'fingerprint', (SELECT fingerprint FROM bank_transaction_key_fingerprint)
    )::text
"""

# The steps that migrate, each a module and its command: the migrate job alone, as a deployment runs it,
# and the image's start. The image first takes the step that provisions the hash key
_MIGRATE_JOB = (("app.db.jobs", "migrate"),)
_IMAGE_START = (("app.db.bank_transaction_key", "ensure-key"), ("app.db.jobs", "migrate"))

# Everything a run of bootstrap sets, in one value: the two roles, their settings and memberships, the
# owners of the schema's objects, and the database's and schema's grants. It holds no password, since
# pg_roles shows every password as asterisks
_BOOTSTRAP_SNAPSHOT = """
    SELECT jsonb_build_object(
        'roles', (
            SELECT jsonb_agg(to_jsonb(r) - 'rolpassword' ORDER BY r.rolname)
            FROM pg_roles r WHERE r.rolname IN ('{migrator}', '{app}')
        ),
        'memberships', (
            SELECT jsonb_agg(to_jsonb(m) ORDER BY m.roleid, m.member)
            FROM pg_auth_members m
            WHERE m.roleid::regrole::text IN ('{migrator}', '{app}') OR m.member::regrole::text IN ('{migrator}', '{app}')
        ),
        'owners', (
            SELECT jsonb_object_agg(owned.name, owned.owner) FROM (
                SELECT 'relation ' || c.relname AS name, c.relowner::regrole::text AS owner
                FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
                UNION ALL
                SELECT 'function ' || p.oid::regprocedure::text, p.proowner::regrole::text
                FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                UNION ALL
                SELECT 'type ' || t.typname, t.typowner::regrole::text
                FROM pg_type t WHERE t.typnamespace = 'public'::regnamespace
            ) owned
        ),
        'database_grants', (SELECT datacl::text FROM pg_database WHERE datname = current_database()),
        'schema', (
            SELECT jsonb_build_object('owner', nspowner::regrole::text, 'grants', nspacl::text)
            FROM pg_namespace WHERE nspname = 'public'
        )
    )::text
"""


async def _bank_id_state(target: Target) -> str:
    """Return the revision, the saved bank sync IDs and the recorded hash key, in one value"""
    return await query(target.superuser(), _BANK_ID_STATE)


async def _snapshot(target: Target) -> str:
    """Return the database's state after a run of migrate"""
    return await query(target.superuser(), _SNAPSHOT.format(app_role=APP_DB_USER))


async def _bootstrap_snapshot(target: Target) -> str:
    """Return what a run of bootstrap has set"""
    return await query(target.superuser(), _BOOTSTRAP_SNAPSHOT.format(migrator=MIGRATOR_DB_USER, app=APP_DB_USER))


@asynccontextmanager
async def _limits_on(target: Target, login: str, limits: dict[str, int]) -> AsyncIterator[None]:
    """Give a login settings that end a statement, a lock wait or an idle transaction after some seconds, then take them away"""
    superuser = target.superuser()
    try:
        async with superuser.connect() as connection:
            for name, seconds in limits.items():
                await connection.execute(text(f"ALTER ROLE {login} SET {name} = '{seconds}s'"))
        yield
    finally:
        async with superuser.connect() as connection:
            for name in limits:
                await connection.execute(text(f"ALTER ROLE {login} RESET {name}"))
        await superuser.dispose()


async def _wait_until(condition: Callable[[], bool], what: str, job: asyncio.Task) -> None:
    """Return once the condition holds, failing naming what was waited for, or with the error that ended the job first"""
    async with asyncio.timeout(_JOB_TIMEOUT_SECONDS):
        while not condition():
            if job.done():
                await job
                raise AssertionError(f"the job ended before {what}")
            await asyncio.sleep(0.05)


async def test_migrate_runs_with_only_the_migrators_password_and_the_keys_and_a_second_run_changes_nothing(provision_into):
    """A deployment gives the migrate job no admin login and no app password, and each release runs it again"""
    async with provision_into(SUPERUSER_LOGIN) as target:
        await run_bootstrap()
        environment = migrate_environment(target)

        first = await asyncio.to_thread(run_module, "app.db.jobs", "migrate", environment=environment)

        assert first.returncode == 0, first.stdout + first.stderr
        assert "Migrated the database from no schema" in first.stderr, "a first run says it migrated"
        assert await query(target.superuser(), "SELECT count(*) FROM currencies") == len(CURRENCIES), "every currency was seeded"
        assert await query(target.superuser(), "SELECT count(*) FROM categories WHERE is_system") == len(SYSTEM_CATEGORY_DEFAULTS), (
            "every system category was seeded"
        )
        assert await query(target.superuser(), "SELECT count(*) FROM merchants WHERE is_system") == len(SYSTEM_MERCHANT_NAMES), (
            "every system merchant was seeded"
        )
        assert await query(target.superuser(), "SELECT count(*) FROM encryption_key_fingerprint") == 1, "the key was recorded"
        assert await query(target.superuser(), "SELECT fingerprint FROM bank_transaction_key_fingerprint") == key_fingerprint(
            bytes.fromhex(environment["BANK_TRANSACTION_HASH_KEY"])
        ), "a database recording no hash key yet records the one given"
        app_engine = target.engine(APP_DB_USER, APP_PASSWORD)
        assert await query(app_engine, "SELECT count(*) FROM currencies") == len(CURRENCIES), "the app role was granted its access"
        after_first = await _snapshot(target)

        second = await asyncio.to_thread(run_module, "app.db.jobs", "migrate", environment=environment)

        assert second.returncode == 0, second.stdout + second.stderr
        assert "already migrated" in second.stderr, "a second run says there was nothing to do"
        assert "waits for it" not in second.stderr, "a second run after the first has finished waits for nothing"
        assert await _snapshot(target) == after_first, "the second run left the database as it was"

        script = await asyncio.to_thread(run_module, "scripts.seed_merchants", environment=environment)
        assert script.returncode == 0, "the seed script too needs only the migrator's password: " + script.stderr


async def test_two_migrate_runs_started_together_leave_the_database_as_one_run_does(provision_into):
    """Two deploys of one release, such as two containers starting at once, both succeed, and one finds the work done"""
    async with provision_into(SUPERUSER_LOGIN) as target:
        await run_bootstrap()
        environment = migrate_environment(target)

        runs = await asyncio.gather(*(asyncio.to_thread(run_module, "app.db.jobs", "migrate", environment=environment) for _ in range(2)))

        for run in runs:
            assert run.returncode == 0, run.stdout + run.stderr
        reports = sorted("migrated" if "from no schema" in run.stderr else "already migrated" for run in runs)
        assert reports == ["already migrated", "migrated"], "one run migrated and the other found it done"
        after_both = await _snapshot(target)

        await asyncio.to_thread(run_module, "app.db.jobs", "migrate", environment=environment)

        assert await _snapshot(target) == after_both, "a later run changes nothing the two did not"


async def test_bootstrap_runs_with_only_the_admin_login_and_the_role_passwords_and_a_second_run_changes_nothing(provision_into):
    """A deployment gives the bootstrap job no key and no migrator login, and may run it again"""
    async with provision_into(SUPERUSER_LOGIN) as target:
        environment = bootstrap_environment(target)
        # A table the admin owns, as a restored backup leaves it, so the first run has an owner to change
        superuser = target.superuser()
        async with superuser.connect() as connection:
            await connection.execute(text("CREATE TABLE restored (id serial PRIMARY KEY)"))
        await superuser.dispose()

        first = await run_job("bootstrap", environment)

        assert first.returncode == 0, first.stdout + first.stderr
        after_first = json.loads(await _bootstrap_snapshot(target))
        assert [role["rolname"] for role in after_first["roles"]] == sorted([MIGRATOR_DB_USER, APP_DB_USER]), "both roles were created"
        assert set(after_first["owners"].values()) == {MIGRATOR_DB_USER}, "the admin's table went to the migrator"

        second = await run_job("bootstrap", environment)

        assert second.returncode == 0, second.stdout + second.stderr
        assert json.loads(await _bootstrap_snapshot(target)) == after_first, "the second run left the roles, owners and grants as they were"


async def test_a_restored_dump_gets_its_owners_grants_and_policies_back_through_the_jobs(provision_into):
    """A backup restored as the admin arrives owned by the admin, with no grants, and the jobs set it right

    Bootstrap hands the tables to the migrator, and migrate puts back the policies and the app role's access
    """
    async with provision_into(SUPERUSER_LOGIN) as target:
        await run_bootstrap()
        environment = migrate_environment(target)
        migrated = await run_job("migrate", environment)
        assert migrated.returncode == 0, migrated.stdout + migrated.stderr
        healthy = await _snapshot(target)

        superuser = target.superuser()
        async with superuser.connect() as connection:
            policy = (
                await connection.execute(text("SELECT policyname, tablename FROM pg_policies ORDER BY tablename, policyname LIMIT 1"))
            ).one()
            await connection.execute(text(f'DROP POLICY "{policy.policyname}" ON "{policy.tablename}"'))
            await connection.execute(text(f"REVOKE ALL ON ALL TABLES IN SCHEMA public FROM {APP_DB_USER}"))
            await connection.execute(text("ALTER TABLE currencies OWNER TO postgres"))
        await superuser.dispose()
        assert await _snapshot(target) != healthy, "the restored state differs from the healthy one"
        owner = "SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'currencies'"

        bootstrapped = await run_job("bootstrap", bootstrap_environment(target))

        assert bootstrapped.returncode == 0, bootstrapped.stdout + bootstrapped.stderr
        assert await query(target.superuser(), owner) == MIGRATOR_DB_USER, "bootstrap handed the table to the migrator"

        repaired = await run_job("migrate", environment)

        assert repaired.returncode == 0, repaired.stdout + repaired.stderr
        assert await _snapshot(target) == healthy, "migrate put back the policy and the app role's grants"


@pytest.mark.parametrize("missing", ["APP_ENCRYPTION_KEY", "BANK_TRANSACTION_HASH_KEY"])
async def test_migrate_refuses_to_run_without_a_key(provision_into, missing):
    """A job with no key stops with the key named, so it is never left to run without the key its secrets are under"""
    async with provision_into(SUPERUSER_LOGIN) as target:
        await run_bootstrap()
        environment = migrate_environment(target)
        environment[missing] = ""

        run = await run_job("migrate", environment)

        assert run.returncode != 0, "the job failed"
        assert missing in run.stderr, "and named the key it lacked"


async def test_migrate_with_another_encryption_key_refuses_before_it_seeds_anything(provision_into):
    """The key the stored secrets are under is recorded, and a different one stops the job before any seed runs"""
    async with provision_into(SUPERUSER_LOGIN) as target:
        await run_bootstrap()
        environment = migrate_environment(target)
        migrated = await run_job("migrate", environment)
        assert migrated.returncode == 0, migrated.stdout + migrated.stderr
        superuser = target.superuser()
        async with superuser.connect() as connection:
            await connection.execute(text("DELETE FROM currencies WHERE ctid = (SELECT ctid FROM currencies LIMIT 1)"))
        await superuser.dispose()

        run = await run_job("migrate", {**environment, "APP_ENCRYPTION_KEY": Fernet.generate_key().decode()})

        assert run.returncode != 0, "the job failed"
        assert "different key" in run.stderr, "and said the key is not the one the secrets are under"
        assert await query(target.superuser(), "SELECT count(*) FROM currencies") == len(CURRENCIES) - 1, "no seed ran"


@pytest.mark.parametrize("steps", [_MIGRATE_JOB, _IMAGE_START], ids=["migrate job", "image"])
async def test_migrating_under_another_hash_key_than_the_recorded_one_stops_before_any_saved_bank_id_is_hashed(provision_into, steps):
    """A migration under the wrong key would hash every saved bank sync ID under it and drop the IDs, past undoing"""
    async with provision_into(SUPERUSER_LOGIN) as target:
        await run_bootstrap()
        recorded_key, other_key = generate_key(), generate_key()
        environment = {**migrate_environment(target), "BANK_TRANSACTION_HASH_KEY": recorded_key}
        built = await asyncio.to_thread(run_module, "alembic", "upgrade", BEFORE_BANK_SYNC_ID_HASH_REVISION, environment=environment)
        assert built.returncode == 0, built.stdout + built.stderr
        superuser = target.superuser()
        async with superuser.connect() as connection:
            for statement in BANK_SYNC_SEED:
                await connection.execute(text(statement), BANK_SYNC_IDS)
        await superuser.dispose()
        before = await _bank_id_state(target)
        assert json.loads(before) == {
            "revisions": [BEFORE_BANK_SYNC_ID_HASH_REVISION],
            "ids": ["TRN-coffee", "TRN-refund"],
            "fingerprint": key_fingerprint(bytes.fromhex(recorded_key)),
        }, "the database records its key and still holds the bank's own IDs"

        environments = {
            "migrate": {**environment, "BANK_TRANSACTION_HASH_KEY": other_key},
            "ensure-key": bootstrap_environment(target, BANK_TRANSACTION_HASH_KEY=other_key),
        }
        for module, command in steps:
            run = await asyncio.to_thread(run_module, module, command, environment=environments[command])
            if run.returncode != 0:
                break

        assert run.returncode != 0, "the run stopped"
        assert "different key" in run.stderr, "and said the key is not the one the database recorded"
        for place in (KEY_ENV_VAR, str(KEY_FILE), RESET_COMMAND):
            assert place in run.stderr, f"and named {place}, where a key is read from or how to start over"
        assert await _bank_id_state(target) == before, "no migration ran, and the bank's IDs and the record are as they were"

        migrated = await run_job("migrate", environment)

        assert migrated.returncode == 0, migrated.stdout + migrated.stderr
        key = bytes.fromhex(recorded_key)
        assert (
            await query(target.superuser(), "SELECT string_agg(external_transaction_hash, ',' ORDER BY disposition) FROM bank_transactions")
            == f"{expected_bank_sync_hash(key, 'ACT-1', 'TRN-coffee')},{expected_bank_sync_hash(key, 'ACT-1', 'TRN-refund')}"
        ), "under the recorded key the migration runs and hashes each ID with it"


@pytest.mark.parametrize(
    ("job", "admin_login", "limited_login", "limits"),
    [
        (run_bootstrap, RESTRICTED_ADMIN_LOGIN, RESTRICTED_ADMIN_LOGIN, ("statement_timeout", "transaction_timeout")),
        (run_migrate, SUPERUSER_LOGIN, MIGRATOR_DB_USER, ("lock_timeout", "statement_timeout", "transaction_timeout")),
    ],
    ids=["bootstrap", "migrate"],
)
async def test_a_job_waits_for_a_set_up_run_going_and_then_does_its_work(
    provision_into, caplog, job: Callable[[], Awaitable[None]], admin_login, limited_login, limits
):
    """A second run says it waits, keeps waiting past each limit its login's settings put on a wait, then finishes

    The login cancels any statement, lock wait or transaction that lasts more than a few seconds, and a migration
    may hold the lock for as long as it takes. The restricted admin carries a lock limit from the server. The
    limits come off before the other run lets go, so only the wait is under them, and the job's steps, which
    open connections of their own, are not
    """
    caplog.set_level(logging.INFO, logger="app.db.jobs")
    async with provision_into(admin_login) as target:
        if job is run_migrate:
            await run_bootstrap()

        holder = target.engine(SUPERUSER_LOGIN, LOGIN_PASSWORD, autocommit=False)
        async with holder.connect() as connection, connection.begin():
            await connection.execute(text("SELECT pg_advisory_xact_lock(:id)"), {"id": SETUP_LOCK_ID})
            async with _limits_on(target, limited_login, {name: ADMIN_LOCK_TIMEOUT_SECONDS for name in limits}):
                run = asyncio.create_task(job())
                await _wait_until(lambda: "waits for it to finish" in caplog.text, "the job says another run is going", run)
                await asyncio.sleep(ADMIN_LOCK_TIMEOUT_SECONDS + 1)
                assert not run.done(), "the job is still waiting past the login's limits"
        await holder.dispose()

        await asyncio.wait_for(run, _JOB_TIMEOUT_SECONDS)

        if job is run_bootstrap:
            roles = await query(target.superuser(), f"SELECT count(*) FROM pg_roles WHERE rolname IN ('{MIGRATOR_DB_USER}', '{APP_DB_USER}')")  # noqa: S608
            assert roles == 2, "bootstrap created the roles once the other run let go"
        else:
            assert await query(target.superuser(), "SELECT count(*) FROM alembic_version") >= 1, "migrate ran once the other run let go"


@pytest.mark.parametrize(
    ("job", "admin_login", "limited_login", "step"),
    [
        (run_bootstrap, RESTRICTED_ADMIN_LOGIN, RESTRICTED_ADMIN_LOGIN, (provision, "transfer_schema_ownership")),
        (run_migrate, SUPERUSER_LOGIN, MIGRATOR_DB_USER, (seeds, "seed_reference_data")),
    ],
    ids=["bootstrap", "migrate"],
)
async def test_a_job_keeps_the_lock_through_a_long_step_under_an_idle_limit(
    provision_into, monkeypatch, job: Callable[[], Awaitable[None]], admin_login, limited_login, step
):
    """The connection holding the lock sits idle while the steps run on others, and no idle limit may end it

    A login whose settings end an idle transaction after a few seconds would otherwise drop the lock
    in the middle of a migration, letting a second run in beside it
    """
    observed: dict[str, bool] = {}
    async with provision_into(admin_login) as target:
        if job is run_migrate:
            await run_bootstrap()

        async def a_long_step(*_arguments, **_keywords) -> None:
            await asyncio.sleep(ADMIN_LOCK_TIMEOUT_SECONDS + 1)
            observed["lock_held"] = await query(target.superuser(), f"SELECT NOT pg_try_advisory_xact_lock({SETUP_LOCK_ID})")

        monkeypatch.setattr(*step, a_long_step)

        async with _limits_on(target, limited_login, {"idle_in_transaction_session_timeout": ADMIN_LOCK_TIMEOUT_SECONDS - 1}):
            await asyncio.wait_for(job(), _JOB_TIMEOUT_SECONDS)

    assert observed == {"lock_held": True}, "the lock was still held after the idle limit had passed"
