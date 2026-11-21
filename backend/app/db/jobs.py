"""The two set-up jobs a deployment runs, each holding only the credentials its work needs

Bootstrap runs rarely, as the admin login, and creates the database roles and hands them the schema.
Migrate runs on every release, as the migrator, and brings the schema, the row-level security
policies, the encryption key's record and the reference data up to this release. Both are callable
from code with no shell, and `python -m app.db.jobs bootstrap|migrate` runs one, as the image's
start-up does

Either is safe to run again, since every step it takes leaves an up-to-date database as it is. Only
one run of either goes on at a time: a run that finds another going says so and waits for it, then
finds its work done
"""

import asyncio
import logging
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.config.database import admin_database_url, migration_database_url
from app.db import encryption_key, provision, seeds

logger = logging.getLogger(__name__)

# The database-wide lock every set-up run holds, so a bootstrap and a migration never interleave
# either. Any number works, and this one is only meant to be unlike the numbers other software picks
SETUP_LOCK_ID = 4_081_217_653

# Limits a role or database may set that would end a wait for the lock, or end the connection holding
# it while a migration runs. A migration may take as long as it needs, so none of them applies
_WAIT_LIMITS = (
    "SET LOCAL lock_timeout = 0",
    "SET LOCAL statement_timeout = 0",
    "SET LOCAL idle_in_transaction_session_timeout = 0",
)

# Found from this file, not the working directory, so the jobs run from wherever code imports them.
# Given with no ini file, since the migration environment would then reset the logging a caller set up
_ALEMBIC_DIRECTORY = Path(__file__).resolve().parents[2] / "alembic"


@asynccontextmanager
async def _one_run_at_a_time(engine: AsyncEngine, job: str) -> AsyncIterator[None]:
    """Hold the set-up lock for the length of the block, waiting for a run that holds it

    The lock belongs to a transaction this keeps open, so it is released when the block ends or when
    the connection is lost, however the run stopped

    Args:
        engine: Engine for the login the job runs as
        job: The job's name, for the log
    """
    async with engine.begin() as connection:
        for statement in _WAIT_LIMITS:
            await connection.execute(text(statement))
        if not await connection.scalar(text("SELECT pg_try_advisory_xact_lock(:id)"), {"id": SETUP_LOCK_ID}):
            logger.info("Another set-up run is going, so the %s job waits for it to finish", job)
            await connection.execute(text("SELECT pg_advisory_xact_lock(:id)"), {"id": SETUP_LOCK_ID})
        yield


async def _read_revisions(engine: AsyncEngine) -> frozenset[str]:
    """Return the migration revisions the database is at, none for a database never migrated"""
    async with engine.connect() as connection:
        if await connection.scalar(text("SELECT to_regclass('public.alembic_version')")) is None:
            return frozenset()
        return frozenset(await connection.scalars(text("SELECT version_num FROM public.alembic_version")))


def _upgrade_schema() -> None:
    """Apply every pending migration as the migrator, in the thread this runs in"""
    configuration = Config()
    configuration.set_main_option("script_location", str(_ALEMBIC_DIRECTORY))
    command.upgrade(configuration, "head")


async def run_bootstrap() -> None:
    """Create the migrator and app roles and hand them the schema, as the admin login

    Needs the admin login's `DB_USER` and `DB_PASSWORD`, the `DB_HOST`, `DB_PORT` and `DB_NAME` of the
    database, and the passwords the two roles are to have, `MIGRATOR_DB_PASSWORD` and
    `APP_DB_PASSWORD`. A run while another set-up run goes waits for it

    Raises:
        RuntimeError: A role no longer has the attributes it was created with, or the admin
            login could not give the roles their access
    """
    engine = create_async_engine(admin_database_url(), hide_parameters=True)
    try:
        async with _one_run_at_a_time(engine, "bootstrap"):
            await provision.ensure_roles()
            await provision.transfer_schema_ownership()
    finally:
        await engine.dispose()
    logger.info("The database roles are set up")


async def run_migrate() -> None:
    """Migrate the database to this release, as the migrator

    Applies the pending migrations, re-applies the row-level security policies and the app role's
    grants, records the encryption key the stored secrets are under, or refuses when the key in hand
    is another, and creates or updates the currencies, system categories and system merchants. Needs
    the migrator's password, `MIGRATOR_DB_PASSWORD`, the `DB_HOST`, `DB_PORT` and `DB_NAME` of the
    database, the encryption key and the bank transaction hash key, which the migrations that hash
    saved transactions read. It needs neither the admin login nor the app role's password. A run
    while another set-up run goes waits for it

    Raises:
        RuntimeError: A key is missing, or the encryption key is not the one the stored secrets are under
    """
    engine = create_async_engine(migration_database_url(), hide_parameters=True)
    try:
        async with _one_run_at_a_time(engine, "migrate"):
            before = await _read_revisions(engine)

            # In a thread of its own, since the migration environment runs its own event loop
            await asyncio.to_thread(_upgrade_schema)

            # A restored backup arrives at the latest revision with its grants stripped, and a policy
            # reading a column added after the first set-up needs this run to install it
            await provision.apply_row_level_security()
            await encryption_key.run_verify_fingerprint()
            await seeds.seed_reference_data()
            after = await _read_revisions(engine)
    finally:
        await engine.dispose()

    if before == after:
        logger.info("The database was already migrated to %s", ", ".join(sorted(after)))
    else:
        logger.info("Migrated the database from %s to %s", ", ".join(sorted(before)) or "no schema", ", ".join(sorted(after)))


_JOBS = {"bootstrap": run_bootstrap, "migrate": run_migrate}


def main() -> None:
    """Run the job named as the single command-line argument, logging what it does"""
    if len(sys.argv) != 2 or sys.argv[1] not in _JOBS:
        sys.exit(f"Usage: python -m app.db.jobs {{{'|'.join(_JOBS)}}}")

    # Run as a script this module is named __main__, outside the app's loggers, so it is named too
    seeds.log_command_progress("alembic", __name__)
    asyncio.run(_JOBS[sys.argv[1]]())


if __name__ == "__main__":
    main()
