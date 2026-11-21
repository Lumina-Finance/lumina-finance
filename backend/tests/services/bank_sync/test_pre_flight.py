"""The checks a runner makes before bank sync work, which the worker makes too

A runner on its own schedule calls them at the start of every run, so they pass again and again on a
database ready for work and leave jobs to run. They refuse at once, with the reason, when the database
is migrated to another release, such as during a migration, when the connection could bypass
row-level security, when a key isn't the one the database was made with, or when a bank provider
refuses a setting
"""

import asyncio
from collections.abc import AsyncIterator, Sequence
from pathlib import Path

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text

from app import database, extension
from app.config.bank_sync import provider_setting_key
from app.db import bank_transaction_key, database_keys, encryption_key, key_fingerprint
from app.encryption import generate_encryption_key
from app.encryption import key_fingerprint as encryption_key_fingerprint
from app.models.bank_sync_job import BankSyncJobKind
from app.services.bank_sync import worker
from app.services.bank_sync.providers.registry import load_adapters
from tests.conftest import engine as owner_engine
from tests.conftest import scoped_engine
from tests.routes.support.bank_sync_helpers import _job_states, _seed_job

pytestmark = pytest.mark.usefixtures("worker_sessions")

_SCRIPT = ScriptDirectory.from_config(Config(str(Path(__file__).resolve().parents[3] / "alembic.ini")))
_HEAD = _SCRIPT.get_current_head()
_EARLIER = _SCRIPT.get_revision(_HEAD).down_revision

# A revision no release ships, as a database migrated by a newer release records
_UNKNOWN_REVISION = "0123456789ab"

_NOT_MIGRATED = "Refusing to sync: the database isn't migrated to this release"

# Long enough for the worker to start and refuse, so a worker that skipped the checks fails rather than hangs
_WAIT_SECONDS = 10


async def _record_revisions(revisions: Sequence[str]) -> None:
    """Record the migration revisions the database is at, as Alembic does once a migration commits"""
    async with owner_engine.begin() as connection:
        await connection.execute(text("CREATE TABLE IF NOT EXISTS alembic_version (version_num varchar(32))"))
        await connection.execute(text("DELETE FROM alembic_version"))
        for revision in revisions:
            await connection.execute(text("INSERT INTO alembic_version VALUES (:revision)"), {"revision": revision})


@pytest.fixture(autouse=True)
async def migrated_to_this_release(monkeypatch) -> AsyncIterator[None]:
    """Point every check at this test run's database as the app role, migrated to exactly this release

    The suite builds its schema from the models, which records no revision, so the table Alembic keeps is
    added here and removed afterwards, since leaving it would make later tests see a migrated database
    """
    for module in (worker, database, database_keys):
        monkeypatch.setattr(module, "engine", scoped_engine)
    await _record_revisions([_HEAD])
    yield
    async with owner_engine.begin() as connection:
        await connection.execute(text("DROP TABLE IF EXISTS alembic_version"))


async def test_checks_pass_on_every_run_and_leave_jobs_to_run(connections, frozen_now):
    """A runner checks at the start of every run, and a database ready for work passes each time and its jobs run"""
    job = await _seed_job(connections[0], BankSyncJobKind.SCHEDULED)

    for _ in range(3):
        await extension.verify_ready_to_sync()

    async with owner_engine.connect() as connection:
        for table in (encryption_key.FINGERPRINT_TABLE, bank_transaction_key.FINGERPRINT_TABLE):
            assert await key_fingerprint.read_fingerprint(connection, table) is None, f"the checks wrote to {table}"
    assert await worker.run_jobs(1) == 1, "the job was not claimed after the checks passed"
    assert (await _job_states())[job.id][0] == "succeeded", "the job did not run after the checks passed"


@pytest.mark.parametrize(
    ("revisions", "found"),
    [
        ([_EARLIER], _EARLIER),
        ([_UNKNOWN_REVISION], _UNKNOWN_REVISION),
        ([_HEAD, _UNKNOWN_REVISION], ", ".join(sorted([_HEAD, _UNKNOWN_REVISION]))),
        ([], "no revision"),
    ],
    ids=["migration_not_finished", "newer_release_migrated", "this_release_and_another_branch", "never_migrated"],
)
async def test_checks_refuse_at_once_on_a_database_at_another_release(revisions, found):
    """A run during a migration, or after another release migrated, refuses without waiting and names both revisions"""
    await _record_revisions(revisions)

    with pytest.raises(RuntimeError) as refusal:
        await extension.verify_ready_to_sync()

    assert str(refusal.value) == f"{_NOT_MIGRATED}. This release ships revision {_HEAD}, and the database is at {found}"


async def test_checks_refuse_a_database_too_old_to_say_its_revision(monkeypatch):
    """A database migrated by a release older than the function reading the revisions is refused as not migrated, with the database's reason"""
    monkeypatch.setattr(worker, "MIGRATION_REVISIONS", "public.migration_revisions_not_yet_added")

    with pytest.raises(RuntimeError) as refusal:
        await extension.verify_ready_to_sync()

    assert str(refusal.value).startswith(f"{_NOT_MIGRATED}. This release ships revision {_HEAD}, and the database's revision can't be read: ")
    assert "migration_revisions_not_yet_added" in str(refusal.value), "the refusal leaves out the database's reason"


async def test_checks_refuse_a_connection_that_could_bypass_row_level_security(monkeypatch):
    """Work run as the table owner would skip the isolation between users, so it is refused"""
    monkeypatch.setattr(database, "engine", owner_engine)

    with pytest.raises(RuntimeError, match="must use the unprivileged role"):
        await extension.verify_ready_to_sync()


@pytest.mark.parametrize(
    ("table", "refused"),
    [
        (encryption_key.FINGERPRINT_TABLE, "the stored secrets"),
        (bank_transaction_key.FINGERPRINT_TABLE, "the bank transaction hashes were made with a different key"),
    ],
    ids=["encryption_key", "bank_transaction_hash_key"],
)
async def test_checks_refuse_a_key_the_database_was_not_made_with(table, refused):
    """A wrong encryption key would mix two keys in stored secrets, and a wrong hash key brings back transactions already saved"""
    async with owner_engine.begin() as connection:
        await key_fingerprint.record_fingerprint(connection, table, encryption_key_fingerprint(generate_encryption_key()))

    with pytest.raises(RuntimeError, match=refused):
        await extension.verify_ready_to_sync()


async def test_checks_refuse_a_bank_provider_setting_the_provider_refuses(monkeypatch):
    """A switch that is neither true nor false stops the run, as it stops the worker and the app"""
    switch = provider_setting_key(min(load_adapters()), "ENABLED")
    monkeypatch.setenv(switch, "maybe")

    with pytest.raises(RuntimeError, match=f"Invalid {switch}='maybe'"):
        await extension.verify_ready_to_sync()


async def test_worker_refuses_to_start_when_the_checks_refuse(monkeypatch):
    """The worker makes the same checks after its wait for the database, so a refusal stops it before it scans"""
    await _record_revisions([_EARLIER])

    async def migrated(*_) -> None:
        """Stand in for the wait, as though the database were migrated just before it changed again"""

    async def refuse_scan() -> None:
        """Stand in for the scan, which a worker refused at start-up never reaches"""
        raise AssertionError("the worker scanned for due work")

    monkeypatch.setattr(worker, "_wait_for_database", migrated)
    monkeypatch.setattr(worker, "enqueue_due_work", refuse_scan)

    # A worker that skipped the checks would keep running, so the limit turns that into a failure
    async with asyncio.timeout(_WAIT_SECONDS):
        with pytest.raises(RuntimeError, match=_NOT_MIGRATED):
            await worker.run_worker()
