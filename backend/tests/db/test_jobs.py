"""The bootstrap and migrate jobs against a real PostgreSQL server

Each job's credentials, its repeat and its refusal to run beside another run of itself are shown
against a server of its own (tests/db/conftest.py), since bootstrap creates roles for the whole server
"""

import asyncio
import logging
import secrets
from collections.abc import Awaitable, Callable

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import text

from app.config.database import APP_DB_USER, MIGRATOR_DB_USER
from app.db.jobs import SETUP_LOCK_ID, run_bootstrap, run_migrate
from app.services.categories.defaults import SYSTEM_CATEGORY_DEFAULTS
from app.services.currencies.defaults import CURRENCIES
from app.services.merchants.defaults import SYSTEM_MERCHANT_NAMES
from tests.db.support import (
    ADMIN_LOCK_TIMEOUT_SECONDS,
    APP_PASSWORD,
    LOGIN_PASSWORD,
    MIGRATOR_PASSWORD,
    RESTRICTED_ADMIN_LOGIN,
    SUPERUSER_LOGIN,
    Target,
    query,
    run_module,
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


def _migrate_environment(target: Target) -> dict[str, str]:
    """Return what the migrate job is given and nothing more: the migrator's password and the two keys"""
    return target.environment(
        MIGRATOR_DB_PASSWORD=MIGRATOR_PASSWORD,
        APP_ENCRYPTION_KEY=Fernet.generate_key().decode(),
        BANK_TRANSACTION_HASH_KEY=secrets.token_hex(32),
    )


async def _snapshot(target: Target) -> str:
    """Return the database's state after a run of migrate"""
    return await query(target.superuser(), _SNAPSHOT.format(app_role=APP_DB_USER))


async def _wait_until(condition: Callable[[], bool], what: str) -> None:
    """Return once the condition holds, failing naming what was waited for"""
    async with asyncio.timeout(_JOB_TIMEOUT_SECONDS):
        while not condition():
            await asyncio.sleep(0.05)
    assert condition(), what


async def test_migrate_runs_with_only_the_migrators_password_and_the_keys_and_a_second_run_changes_nothing(provision_into):
    """A deployment gives the migrate job no admin login and no app password, and each release runs it again"""
    async with provision_into(SUPERUSER_LOGIN) as target:
        await run_bootstrap()
        environment = _migrate_environment(target)

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
        environment = _migrate_environment(target)

        runs = await asyncio.gather(*(asyncio.to_thread(run_module, "app.db.jobs", "migrate", environment=environment) for _ in range(2)))

        for run in runs:
            assert run.returncode == 0, run.stdout + run.stderr
        reports = sorted("migrated" if "from no schema" in run.stderr else "already migrated" for run in runs)
        assert reports == ["already migrated", "migrated"], "one run migrated and the other found it done"
        after_both = await _snapshot(target)

        await asyncio.to_thread(run_module, "app.db.jobs", "migrate", environment=environment)

        assert await _snapshot(target) == after_both, "a later run changes nothing the two did not"


@pytest.mark.parametrize(
    ("job", "admin_login"),
    [(run_bootstrap, RESTRICTED_ADMIN_LOGIN), (run_migrate, SUPERUSER_LOGIN)],
    ids=["bootstrap", "migrate"],
)
async def test_a_job_waits_for_a_set_up_run_going_and_then_does_its_work(
    provision_into, caplog, job: Callable[[], Awaitable[None]], admin_login
):
    """A second run says it waits, keeps waiting past a limit the login's own settings put on a lock wait, then finishes

    The restricted admin cancels any statement that waits for a lock longer than a few seconds, and
    a migration may hold the lock for as long as it takes
    """
    caplog.set_level(logging.INFO, logger="app.db.jobs")
    async with provision_into(admin_login) as target:
        if job is run_migrate:
            await run_bootstrap()

        holder = target.engine(SUPERUSER_LOGIN, LOGIN_PASSWORD, autocommit=False)
        async with holder.connect() as connection, connection.begin():
            await connection.execute(text("SELECT pg_advisory_xact_lock(:id)"), {"id": SETUP_LOCK_ID})
            run = asyncio.create_task(job())
            await _wait_until(lambda: "waits for it to finish" in caplog.text, "the job says another run is going")
            await asyncio.sleep(ADMIN_LOCK_TIMEOUT_SECONDS + 1)
            assert not run.done(), "the job is still waiting past the login's lock timeout"
        await holder.dispose()

        await asyncio.wait_for(run, _JOB_TIMEOUT_SECONDS)

        if job is run_bootstrap:
            roles = await query(target.superuser(), f"SELECT count(*) FROM pg_roles WHERE rolname IN ('{MIGRATOR_DB_USER}', '{APP_DB_USER}')")  # noqa: S608
            assert roles == 2, "bootstrap created the roles once the other run let go"
        else:
            assert await query(target.superuser(), "SELECT count(*) FROM alembic_version") >= 1, "migrate ran once the other run let go"
