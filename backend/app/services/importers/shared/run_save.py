"""Asking for an import run to be saved, and reading how the save went

A file can take longer to write than a request can wait, so the request to save a run only records
that it was made and starts the save, and the page asks for the outcome until it has one. The save
itself holds the run's row lock for its whole transaction and is in app.services.importers.background_save
"""

import uuid
from collections.abc import Awaitable, Callable, Collection, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime

from fastapi import HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.import_run import ImportRun, ImportRunSource
from app.models.user import User
from app.schemas.import_run import ImportRunSaveResponse
from app.services.importers.shared.run_staging import require_run_not_abandoned, require_run_source

# Starts the save of a run for its owner, once the request that asked for it has committed. It returns
# when the save has been started, not when it has finished
ImportSaveStarter = Callable[[uuid.UUID, uuid.UUID], Awaitable[None]]

# The keys a refusal is stored under. The poll for the outcome reads them back as the answer's status and detail
_STATUS_CODE = "status_code"
_DETAIL = "detail"

# Set by code built on the app that runs the save itself
_custom_starter: ImportSaveStarter | None = None

# Set while the app's own runner is running, and used only when no starter of the code built on the app is set
_default_starter: ImportSaveStarter | None = None


def set_import_save_starter(starter: ImportSaveStarter) -> None:
    """Replace what starts a run's save, for code that runs the save somewhere other than this process

    The starter is called with the run's id and its owner's id after the request to save has
    committed, and must make run_import_save(run_id, owner_id) run once, wherever it runs. Without
    one, the app's own runner runs each save as a task of its own while the app serves

    Args:
        starter: Coroutine function starting one save
    """
    global _custom_starter
    _custom_starter = starter


def has_custom_import_save_starter() -> bool:
    """Whether code built on the app has replaced the app's own runner"""
    return _custom_starter is not None


@contextmanager
def use_default_import_save_starter(starter: ImportSaveStarter) -> Iterator[None]:
    """Offer the app's own runner as the starter for the length of the block"""
    global _default_starter
    _default_starter = starter
    try:
        yield
    finally:
        _default_starter = None


def _saving_response() -> JSONResponse:
    """Answer 202 while the save is going, and the page answers that by asking again"""
    return JSONResponse(status_code=status.HTTP_202_ACCEPTED, content=ImportRunSaveResponse(state="saving").model_dump())


async def request_run_save[Summary: BaseModel](
    db: AsyncSession,
    user: User,
    run_id: uuid.UUID,
    sources: Collection[ImportRunSource],
    summary_type: type[Summary],
) -> Summary | JSONResponse:
    """Record a request to save a run and start the save, answering at once

    A run already committed answers with the summary it returned the first time, so a request whose
    answer was lost can be repeated without importing the file twice. A run another transaction holds
    is being saved, or staged to, so a request for it starts nothing and answers that it is saving

    Args:
        db: Active database session
        user: Authenticated user running the import
        run_id: Run to save
        sources: Importers whose runs the asking request saves, one of which must have opened the run
        summary_type: The summary the importer returns, and a repeated request is answered with it

    Returns:
        The summary of a run already saved, or the 202 answer that its save is going

    Raises:
        HTTPException: Raised with 404 for a run that is absent or not the caller's, and 422 when an
            importer outside the sources opened the run or it was abandoned before it was committed
    """
    # Skipping a held run is what tells a save in progress apart from one to start, without waiting
    # behind it for as long as the whole file takes to write
    query = select(ImportRun).where(ImportRun.id == run_id).with_for_update(skip_locked=True)
    run = (await db.execute(query)).scalar_one_or_none()
    if run is None:
        if await db.scalar(select(ImportRun.id).where(ImportRun.id == run_id)) is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Import run not found")
        return _saving_response()

    require_run_source(run, sources)
    if run.committed_at is not None:
        return summary_type.model_validate(run.summary)
    require_run_not_abandoned(run)

    run.save_requested_at = datetime.now(UTC)
    run.save_error = None
    await db.commit()

    starter = _custom_starter or _default_starter
    if starter is None:
        raise RuntimeError("No import save starter is installed")
    await starter(run.id, user.id)
    return _saving_response()


async def read_run_save[Summary: BaseModel](
    db: AsyncSession,
    run_id: uuid.UUID,
    sources: Collection[ImportRunSource],
    summary_type: type[Summary],
) -> Summary | JSONResponse:
    """Say how the save of a run is going, without waiting for it

    Args:
        db: Active database session
        run_id: Run whose save is read
        sources: Importers whose runs the asking request reads, one of which must have opened the run
        summary_type: The summary the importer returns

    Returns:
        The summary of a saved run, or the 202 answer that its save is going

    Raises:
        HTTPException: Raised with 404 for a run that is absent or not the caller's, 409 for a run no
            save was requested for, 422 when an importer outside the sources opened it, and the
            status and detail the last attempt to save it was refused with
    """
    run = (await db.execute(select(ImportRun).where(ImportRun.id == run_id))).scalar_one_or_none()
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Import run not found")
    require_run_source(run, sources)

    if run.committed_at is not None:
        return summary_type.model_validate(run.summary)
    if run.save_error is not None:
        raise HTTPException(status_code=run.save_error[_STATUS_CODE], detail=run.save_error[_DETAIL])
    if run.save_requested_at is not None:
        return _saving_response()
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This import hasn't been saved")


def build_save_error(status_code: int, detail: str) -> dict[str, int | str]:
    """Write a refusal as the run stores it"""
    return {_STATUS_CODE: status_code, _DETAIL: detail}
