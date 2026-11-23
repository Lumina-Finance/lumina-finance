"""Saving an import run on its own, after the request that asked for it has been answered

The save writes the whole file in one transaction, holding the run's row lock until it ends, and the
app's own runner starts each one as a task while the app serves. Code that runs the save somewhere
else installs its own starter, as run_save describes, and calls run_import_save there
"""

import asyncio
import logging
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime
from typing import NamedTuple

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.database import acting_as, async_session
from app.models.import_run import ImportRun
from app.models.user import User
from app.services.importers.generic.run import commit_import_run
from app.services.importers.journal.constants import JOURNAL_RUN_SOURCES
from app.services.importers.journal.run import commit_journal_run
from app.services.importers.shared.run_save import (
    build_save_error,
    has_custom_import_save_starter,
    use_default_import_save_starter,
)
from app.statement_timeout import STATEMENT_TIMEOUT_DETAIL, is_statement_timeout

logger = logging.getLogger(__name__)

# How many saves the app runs at once. Each holds a database connection and its file's rows in
# memory until it ends, and a server for one household has no use for more. A save beyond these
# waits for a slot, and its page keeps asking until it has an answer
MAX_CONCURRENT_SAVES = 2

# What a save that stopped for a reason of the server's own, rather than the file's, answers
_SAVE_FAILED_DETAIL = "The import couldn't be saved"


async def run_import_save(
    run_id: uuid.UUID,
    owner_id: uuid.UUID,
    session_factory: async_sessionmaker[AsyncSession] = async_session,
) -> None:
    """Save a run whose save was requested, as its owner, and record why when it is refused

    Does nothing when another save holds the run, since that save finishes it, or when the run is
    gone, already saved, never requested or already refused. A save refused or stopped by an error is
    rolled back whole and recorded on the run for the page to read. When a later request to save
    the run has been made, nothing is recorded, since that request's own save answers for it

    Args:
        run_id: Run to save
        owner_id: User the run belongs to, whose identity row-level security reads
        session_factory: Opens the sessions the save runs in. Its engine must stamp the identity
            the save runs as on each transaction, as the app's own engine does, since row-level
            security otherwise hides the run from the save
    """
    with acting_as(owner_id):
        # The session ends before the refusal is recorded. That rolls back the save and so releases
        # the run, and recording it waits for the run
        async with session_factory() as db:
            refusal = await _save_held_run(db, run_id, owner_id)
        if refusal is not None:
            async with session_factory() as db:
                await _record_save_error(db, run_id, refusal)


class _Refusal(NamedTuple):
    """Why a save stopped, and the request it was made for"""

    requested_at: datetime
    status_code: int
    detail: str


async def _save_held_run(db: AsyncSession, run_id: uuid.UUID, owner_id: uuid.UUID) -> _Refusal | None:
    """Save the run when its save is this one's to make, returning why it stopped, or None when it was saved or left alone"""
    run = await _hold_requested_run(db, run_id)
    if run is None:
        return None
    requested_at = run.save_requested_at

    try:
        user = await db.get(User, owner_id)
        commit = commit_journal_run if run.source in JOURNAL_RUN_SOURCES else commit_import_run
        await commit(db, user, run_id)
    except Exception as exc:
        # Best-effort boundary: whatever stops the save is recorded for the page to show, since a
        # failure left unrecorded would have it waiting out its whole time for an answer
        return _Refusal(requested_at, *_describe_failure(run_id, exc))
    return None


async def _hold_requested_run(db: AsyncSession, run_id: uuid.UUID) -> ImportRun | None:
    """Return the run when its save is this one's to make, held for the rest of the transaction

    Returns:
        The run, or None when another transaction holds it, or when it is gone, saved, refused or never
        requested
    """
    query = select(ImportRun).where(ImportRun.id == run_id).with_for_update(skip_locked=True)
    run = (await db.execute(query)).scalar_one_or_none()
    if run is None or run.committed_at is not None or run.save_requested_at is None or run.save_error is not None:
        return None
    return run


def _describe_failure(run_id: uuid.UUID, exc: Exception) -> tuple[int, str]:
    """Return the status and detail a save stopped by an error answers with, logging what the server needs of it"""
    if isinstance(exc, HTTPException):
        return exc.status_code, str(exc.detail)
    if isinstance(exc, DBAPIError) and is_statement_timeout(exc):
        logger.warning("A statement for saving import run %s ran past the statement timeout: %s", run_id, exc.statement)
        return status.HTTP_503_SERVICE_UNAVAILABLE, STATEMENT_TIMEOUT_DETAIL
    logger.error("Saving import run %s failed", run_id, exc_info=exc)
    return status.HTTP_500_INTERNAL_SERVER_ERROR, _SAVE_FAILED_DETAIL


async def _record_save_error(db: AsyncSession, run_id: uuid.UUID, refusal: _Refusal) -> None:
    """Record why a save was refused, unless the run was saved or asked to be saved again meanwhile

    The run is the one this save was requested for only while its request time is still the one the
    save started from, and a refusal of an older attempt never replaces a newer request
    """
    run = (await db.execute(select(ImportRun).where(ImportRun.id == run_id).with_for_update())).scalar_one_or_none()
    if run is None or run.committed_at is not None or run.save_requested_at != refusal.requested_at:
        return
    run.save_error = build_save_error(refusal.status_code, refusal.detail)
    await db.commit()


class _InAppRunner:
    """Runs each save as a task of this process, at most MAX_CONCURRENT_SAVES at once"""

    def __init__(self) -> None:
        self._slots = asyncio.Semaphore(MAX_CONCURRENT_SAVES)

        # Held so a task is not collected while it runs, and so stopping the app can tell the saves
        # still waiting for a slot, having written nothing, from those writing now
        self._waiting: set[asyncio.Task[None]] = set()
        self._running: set[asyncio.Task[None]] = set()

    async def start(self, run_id: uuid.UUID, owner_id: uuid.UUID) -> None:
        """Start a save as a task that waits for a slot first"""
        task = asyncio.create_task(self._save(run_id, owner_id))
        self._waiting.add(task)
        task.add_done_callback(self._waiting.discard)
        task.add_done_callback(self._running.discard)

    async def _save(self, run_id: uuid.UUID, owner_id: uuid.UUID) -> None:
        """Wait for a slot and save the run"""
        task = asyncio.current_task()
        async with self._slots:
            self._waiting.discard(task)
            self._running.add(task)
            try:
                await run_import_save(run_id, owner_id)
            except Exception:
                # Best-effort boundary: a save already records its own refusals, so what reaches here is
                # a failure to record one, and it leaves the run for its page's wait to give up on
                logger.exception("Saving import run %s stopped before its outcome was recorded", run_id)

    async def stop(self) -> None:
        """Cancel the saves still waiting for a slot and wait for the ones writing to finish"""
        tasks = [*self._waiting, *self._running]
        for task in list(self._waiting):
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


@asynccontextmanager
async def run_in_app_saves() -> AsyncIterator[None]:
    """Run the saves of imports as tasks of this process while the block runs

    When the block ends, saves still waiting for a slot are cancelled and the ones writing are
    waited for, as a request in flight is. A save stopped any other way rolls back, and its page
    shows that the save was interrupted once its time runs out. With a starter installed by code
    built on the app, the app runs no saves of its own
    """
    if has_custom_import_save_starter():
        logger.info("The import save starter was replaced, so the app runs no saves of its own")
        yield
        return

    runner = _InAppRunner()
    with use_default_import_save_starter(runner.start):
        try:
            yield
        finally:
            await runner.stop()
