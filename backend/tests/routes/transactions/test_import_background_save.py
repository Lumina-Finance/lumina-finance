"""An import is saved after the request for it is answered, and the page reads how the save went

The route tests install a starter that runs each save as the request ends. These install their own, so
the save runs when the test says, or leave the app's runner in place
"""

import asyncio
import logging
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime

import pytest
from sqlalchemy import event, select, text

from app.database import acting_as
from app.models.import_run import ImportRun
from app.services.importers import background_save
from app.services.importers.background_save import (
    MAX_CONCURRENT_SAVES,
    _record_save_error,
    _Refusal,
    run_import_save,
    run_in_app_saves,
)
from app.services.importers.shared import run_save
from app.services.importers.shared.run_save import set_import_save_starter
from app.statement_timeout import STATEMENT_TIMEOUT_DETAIL
from tests.conftest import ScopedSession, TestSession, scoped_engine
from tests.routes.support import _create_user, _get_auth_header
from tests.routes.transactions._helpers import _setup_user_with_deps
from tests.routes.transactions._import_helpers import _csv_batch, _list_transactions, _open_run, _open_staged_run, _stage_batch

# How long a statement may run before the database cancels it, short enough to keep the test quick
_STATEMENT_LIMIT = "1s"

# The most a test waits for the app's runner to finish a save or stop, far longer than either takes
_RUNNER_WAIT_SECONDS = 20


@pytest.fixture
def started_saves() -> list[tuple[uuid.UUID, uuid.UUID]]:
    """Each save the app is asked to start, recorded in place of running it, so the test runs it when it chooses"""
    started: list[tuple[uuid.UUID, uuid.UUID]] = []

    async def record(run_id: uuid.UUID, owner_id: uuid.UUID) -> None:
        started.append((run_id, owner_id))

    set_import_save_starter(record)
    return started


async def _sign_up(client) -> tuple[dict[str, str], uuid.UUID]:
    """Sign a user up and return their headers and id"""
    headers = _get_auth_header(await _create_user(client))
    return headers, uuid.UUID((await client.get("/test/me", headers=headers)).json()["id"])


def _save_path(run_id) -> str:
    return f"/transactions/import/runs/{run_id}/commit"


async def _read_run(run_id: str) -> ImportRun:
    """Read a run as the database holds it"""
    async with TestSession() as session:
        return (await session.execute(select(ImportRun).where(ImportRun.id == uuid.UUID(run_id)))).scalar_one()


async def test_a_save_is_answered_before_anything_is_written_and_then_gives_its_summary(client, started_saves):
    """The request answers that the save is going and writes nothing, and the summary comes once the save has run"""
    headers, owner_id = await _sign_up(client)
    run_id = await _open_staged_run(client, headers, _csv_batch(["-1.00", "-2.00"]))

    requested = await client.post(_save_path(run_id), headers=headers)
    saving = await client.get(_save_path(run_id), headers=headers)

    assert (requested.status_code, requested.json()) == (202, {"state": "saving"})
    assert started_saves == [(uuid.UUID(run_id), owner_id)]
    assert (saving.status_code, saving.json()) == (202, {"state": "saving"})
    assert await _list_transactions(client, headers) == [], "nothing is written before the save runs"

    await run_import_save(uuid.UUID(run_id), owner_id, ScopedSession)
    saved = await client.get(_save_path(run_id), headers=headers)

    assert saved.status_code == 200, saved.text
    assert saved.json()["transactions_created"] == 2
    assert len(await _list_transactions(client, headers)) == 2


async def test_a_refused_save_answers_with_its_refusal_until_the_save_is_asked_for_again(client, started_saves):
    """The refusal a save recorded is what the poll answers, and asking again clears it and saves once the file is whole"""
    headers, owner_id = await _sign_up(client)
    run_id = await _open_run(client, headers, 2)
    assert (await _stage_batch(client, headers, run_id, _csv_batch(["-1.00"]))).status_code == 204
    await client.post(_save_path(run_id), headers=headers)

    await run_import_save(uuid.UUID(run_id), owner_id, ScopedSession)
    refused = await client.get(_save_path(run_id), headers=headers)

    assert (refused.status_code, refused.json()["detail"]) == (422, "This import has 1 of its 2 rows staged")
    assert await _list_transactions(client, headers) == []

    assert (await _stage_batch(client, headers, run_id, _csv_batch(["-2.00"], start_row_index=1))).status_code == 204
    again = await client.post(_save_path(run_id), headers=headers)
    waiting = await client.get(_save_path(run_id), headers=headers)

    assert (again.status_code, waiting.status_code) == (202, 202), "asking again clears the earlier refusal"
    await run_import_save(uuid.UUID(run_id), owner_id, ScopedSession)
    saved = await client.get(_save_path(run_id), headers=headers)
    assert (saved.status_code, saved.json()["transactions_created"]) == (200, 2)


async def test_a_run_nobody_asked_to_save_says_so(client, started_saves):
    """Reading a run's save before it was asked for is a conflict the page never causes, and not a save going"""
    headers, _ = await _sign_up(client)
    run_id = await _open_staged_run(client, headers, _csv_batch(["-1.00"]))

    unasked = await client.get(_save_path(run_id), headers=headers)

    assert (unasked.status_code, unasked.json()["detail"]) == (409, "This import hasn't been saved")


async def test_a_request_while_another_transaction_holds_the_run_starts_nothing(client, started_saves):
    """A run held by a save, or by a batch, is answered as saving without a second save started for it"""
    headers, _ = await _sign_up(client)
    run_id = await _open_staged_run(client, headers, _csv_batch(["-1.00"]))

    async with TestSession() as holder:
        await holder.execute(text("SELECT id FROM import_runs WHERE id = :id FOR UPDATE"), {"id": run_id})
        async with asyncio.timeout(_RUNNER_WAIT_SECONDS):
            held = await client.post(_save_path(run_id), headers=headers)
        await holder.rollback()

    assert (held.status_code, held.json()) == (202, {"state": "saving"})
    assert started_saves == []
    assert (await _read_run(run_id)).save_requested_at is None, "a request that starts nothing records nothing"


async def test_a_save_of_a_run_another_save_holds_leaves_it_to_that_save(client, started_saves):
    """A second save returns at once, without writing or recording a refusal, while the first holds the run"""
    headers, owner_id = await _sign_up(client)
    run_id = await _open_staged_run(client, headers, _csv_batch(["-1.00"]))
    await client.post(_save_path(run_id), headers=headers)

    async with TestSession() as holder:
        await holder.execute(text("SELECT id FROM import_runs WHERE id = :id FOR UPDATE"), {"id": run_id})
        async with asyncio.timeout(_RUNNER_WAIT_SECONDS):
            await run_import_save(uuid.UUID(run_id), owner_id, ScopedSession)
        await holder.rollback()

    run = await _read_run(run_id)
    assert (run.committed_at, run.save_error) == (None, None)
    assert await _list_transactions(client, headers) == []


async def test_two_saves_of_one_run_at_once_write_the_import_once(client, started_saves):
    """The second of two saves started together finds the run held or saved, so the file is written one time"""
    headers, owner_id = await _sign_up(client)
    run_id = await _open_staged_run(client, headers, _csv_batch(["-1.00", "-2.00"]))
    await client.post(_save_path(run_id), headers=headers)

    await asyncio.gather(*(run_import_save(uuid.UUID(run_id), owner_id, ScopedSession) for _ in range(2)))

    saved = await client.get(_save_path(run_id), headers=headers)
    assert (saved.status_code, saved.json()["transactions_created"]) == (200, 2)
    assert len(await _list_transactions(client, headers)) == 2


async def test_a_save_acts_only_for_the_owner_of_the_run(client, started_saves):
    """Another user can neither read nor ask for the save of a run, nor have a save run for it as themselves"""
    headers, _owner_id = await _sign_up(client)
    other, _, _ = await _setup_user_with_deps(client, email="other@example.com", name_prefix="Other")
    other_id = uuid.UUID((await client.get("/test/me", headers=other)).json()["id"])
    run_id = await _open_staged_run(client, headers, _csv_batch(["-1.00"]))
    await client.post(_save_path(run_id), headers=headers)

    read = await client.get(_save_path(run_id), headers=other)
    asked = await client.post(_save_path(run_id), headers=other)
    await run_import_save(uuid.UUID(run_id), other_id, ScopedSession)

    assert [(read.status_code, read.json()["detail"]), (asked.status_code, asked.json()["detail"])] == [(404, "Import run not found")] * 2
    assert (await _read_run(run_id)).committed_at is None, "a save run as another user writes nothing"
    assert await _list_transactions(client, headers) == []


async def test_a_statement_past_the_timeout_records_the_server_took_too_long_and_writes_nothing(client, started_saves, caplog):
    """A save the database cancelled is refused with the app's timeout answer, and the import can be asked for again"""
    headers, owner_id = await _sign_up(client)
    run_id = await _open_staged_run(client, headers, _csv_batch(["-1.00"]))
    await client.post(_save_path(run_id), headers=headers)

    def limit_statements(connection) -> None:
        connection.exec_driver_sql(f"SET LOCAL statement_timeout = '{_STATEMENT_LIMIT}'")

    # A transaction holding the accounts table makes the save's read of them wait past the limit
    async with TestSession() as holder:
        await holder.execute(text("LOCK TABLE accounts IN ACCESS EXCLUSIVE MODE"))
        event.listen(scoped_engine.sync_engine, "begin", limit_statements)
        try:
            with caplog.at_level(logging.WARNING):
                await run_import_save(uuid.UUID(run_id), owner_id, ScopedSession)
        finally:
            event.remove(scoped_engine.sync_engine, "begin", limit_statements)
        await holder.rollback()

    refused = await client.get(_save_path(run_id), headers=headers)
    assert (refused.status_code, refused.json()["detail"]) == (503, STATEMENT_TIMEOUT_DETAIL)
    assert "ran past the statement timeout" in caplog.text
    assert await _list_transactions(client, headers) == []


async def test_an_older_saves_refusal_never_replaces_a_newer_request(client, started_saves):
    """A save stopped while the save is asked for again leaves the newer request standing, and its own save answers for it"""
    headers, owner_id = await _sign_up(client)
    run_id = await _open_run(client, headers, 2)
    assert (await _stage_batch(client, headers, run_id, _csv_batch(["-1.00"]))).status_code == 204
    await client.post(_save_path(run_id), headers=headers)
    first_request = (await _read_run(run_id)).save_requested_at

    class _SessionAfterANewerRequest:
        """Opens the session recording a refusal only after the save has been asked for again"""

        def __init__(self) -> None:
            self.opened = 0
            self.session = None

        def __call__(self):
            return self

        async def __aenter__(self):
            self.opened += 1
            if self.opened == 2:
                assert (await client.post(_save_path(run_id), headers=headers)).status_code == 202
            self.session = ScopedSession()
            return await self.session.__aenter__()

        async def __aexit__(self, *error):
            return await self.session.__aexit__(*error)

    await run_import_save(uuid.UUID(run_id), owner_id, _SessionAfterANewerRequest())

    run = await _read_run(run_id)
    assert run.save_error is None, "the older save's refusal is not recorded over the newer request"
    assert run.save_requested_at > first_request
    assert len(started_saves) == 2, "the newer request started its own save"
    waiting = await client.get(_save_path(run_id), headers=headers)
    assert (waiting.status_code, waiting.json()) == (202, {"state": "saving"})


@pytest.fixture
async def in_app_runner(monkeypatch) -> AsyncIterator[None]:
    """The app's own runner, saving on the test database as the app role"""
    original = background_save.run_import_save

    async def run_on_the_test_database(run_id, owner_id) -> None:
        await original(run_id, owner_id, ScopedSession)

    monkeypatch.setattr(run_save, "_custom_starter", None)
    monkeypatch.setattr(background_save, "run_import_save", run_on_the_test_database)
    async with run_in_app_saves():
        yield


async def test_the_apps_own_runner_saves_an_import_after_the_request_is_answered(client, in_app_runner):
    """With no starter of its own installed, the app saves the import itself, and the page's poll gives the summary"""
    headers, _ = await _sign_up(client)
    run_id = await _open_staged_run(client, headers, _csv_batch(["-1.00", "-2.00"]))

    requested = await client.post(_save_path(run_id), headers=headers)
    async with asyncio.timeout(_RUNNER_WAIT_SECONDS):
        saved = await client.get(_save_path(run_id), headers=headers)
        while saved.status_code == 202:
            await asyncio.sleep(0.05)
            saved = await client.get(_save_path(run_id), headers=headers)

    assert requested.status_code == 202
    assert (saved.status_code, saved.json()["transactions_created"]) == (200, 2)


async def test_stopping_the_app_cancels_saves_waiting_for_a_slot_and_lets_running_ones_finish(client, monkeypatch):
    """A save writing when the app stops is finished as a request in flight is, and one that has not started never does"""
    headers, _ = await _sign_up(client)
    run_ids = [await _open_staged_run(client, headers, _csv_batch(["-1.00"])) for _ in range(MAX_CONCURRENT_SAVES + 1)]
    started: list[uuid.UUID] = []
    finished: list[uuid.UUID] = []
    both_running = asyncio.Event()
    release = asyncio.Event()

    async def slow_save(run_id, owner_id) -> None:
        started.append(run_id)
        if len(started) == MAX_CONCURRENT_SAVES:
            both_running.set()
        await release.wait()
        finished.append(run_id)

    monkeypatch.setattr(run_save, "_custom_starter", None)
    monkeypatch.setattr(background_save, "run_import_save", slow_save)
    runner = run_in_app_saves()
    await runner.__aenter__()
    for run_id in run_ids:
        assert (await client.post(_save_path(run_id), headers=headers)).status_code == 202
    async with asyncio.timeout(_RUNNER_WAIT_SECONDS):
        await both_running.wait()

    stopping = asyncio.create_task(runner.__aexit__(None, None, None))
    await asyncio.sleep(0)
    assert not stopping.done(), "stopping waits for the saves that are writing"
    release.set()
    async with asyncio.timeout(_RUNNER_WAIT_SECONDS):
        await stopping

    assert sorted(finished) == sorted(started) == sorted(uuid.UUID(run_id) for run_id in run_ids[:MAX_CONCURRENT_SAVES])


async def test_with_a_starter_installed_the_app_runs_no_saves_of_its_own(client, started_saves):
    """The starter code built on the app installed gets the save, and entering the app's runner starts none"""
    headers, owner_id = await _sign_up(client)
    run_id = await _open_staged_run(client, headers, _csv_batch(["-1.00"]))

    async with run_in_app_saves():
        assert run_save._default_starter is None, "the app's runner is not offered as a starter"
        requested = await client.post(_save_path(run_id), headers=headers)

    assert requested.status_code == 202
    assert started_saves == [(uuid.UUID(run_id), owner_id)]


@pytest.fixture
def commits(monkeypatch) -> list[uuid.UUID]:
    """The runs a save goes on to write, recorded as the real save writes them"""
    written: list[uuid.UUID] = []

    for name in ("commit_import_run", "commit_journal_run"):
        original = getattr(background_save, name)

        async def record(db, user, run_id, _original=original):
            written.append(run_id)
            return await _original(db, user, run_id)

        monkeypatch.setattr(background_save, name, record)
    return written


async def test_a_save_of_a_run_nobody_asked_to_save_writes_and_records_nothing(client, started_saves, commits):
    """A save that finds a staged run with no request to save leaves it as it is"""
    headers, owner_id = await _sign_up(client)
    run_id = await _open_staged_run(client, headers, _csv_batch(["-1.00"]))

    await run_import_save(uuid.UUID(run_id), owner_id, ScopedSession)

    run = await _read_run(run_id)
    assert (run.committed_at, run.save_requested_at, run.save_error) == (None, None, None)
    assert commits == []
    assert await _list_transactions(client, headers) == []


async def test_a_refused_run_is_not_saved_again_by_a_save_that_finds_it_refused(client, started_saves, commits):
    """The refusal a run holds stays until the save is asked for again, even if the file is whole by then"""
    headers, owner_id = await _sign_up(client)
    run_id = await _open_run(client, headers, 2)
    assert (await _stage_batch(client, headers, run_id, _csv_batch(["-1.00"]))).status_code == 204
    await client.post(_save_path(run_id), headers=headers)
    await run_import_save(uuid.UUID(run_id), owner_id, ScopedSession)
    assert (await _stage_batch(client, headers, run_id, _csv_batch(["-2.00"], start_row_index=1))).status_code == 204
    refused = (await _read_run(run_id)).save_error

    await run_import_save(uuid.UUID(run_id), owner_id, ScopedSession)

    run = await _read_run(run_id)
    assert (run.committed_at, run.save_error) == (None, refused)
    assert len(commits) == 1, "only the first save went on to write"
    assert await _list_transactions(client, headers) == []


async def test_a_run_already_saved_is_not_saved_again(client, started_saves, commits):
    """A second save of a saved run does no work and leaves the saved import as it was"""
    headers, owner_id = await _sign_up(client)
    run_id = await _open_staged_run(client, headers, _csv_batch(["-1.00"]))
    await client.post(_save_path(run_id), headers=headers)
    await run_import_save(uuid.UUID(run_id), owner_id, ScopedSession)
    saved_at = (await _read_run(run_id)).committed_at

    await run_import_save(uuid.UUID(run_id), owner_id, ScopedSession)

    assert (await _read_run(run_id)).committed_at == saved_at
    assert len(commits) == 1
    assert len(await _list_transactions(client, headers)) == 1


async def test_a_run_dropped_while_its_save_waited_is_left_quietly(client, started_saves, commits, caplog):
    """A save whose run is gone returns without writing and without logging an error"""
    headers, owner_id = await _sign_up(client)
    run_id = await _open_staged_run(client, headers, _csv_batch(["-1.00"]))
    await client.post(_save_path(run_id), headers=headers)
    assert (await client.delete(f"/transactions/import/runs/{run_id}", headers=headers)).status_code == 204

    with caplog.at_level(logging.WARNING):
        await run_import_save(uuid.UUID(run_id), owner_id, ScopedSession)

    assert commits == []
    assert [record for record in caplog.records if record.levelno >= logging.WARNING] == []


async def test_a_refusal_is_not_recorded_on_a_run_that_is_gone(client, started_saves):
    """Recording a refusal for a run dropped in the meantime does nothing"""
    _headers, owner_id = await _sign_up(client)

    with acting_as(owner_id):
        async with ScopedSession() as db:
            await _record_save_error(db, uuid.uuid4(), _Refusal(datetime.now(UTC), 422, "No"))


async def test_a_refusal_is_not_recorded_on_a_run_that_was_saved_meanwhile(client, started_saves):
    """A run saved before its refusal was recorded keeps no refusal"""
    headers, owner_id = await _sign_up(client)
    run_id = await _open_staged_run(client, headers, _csv_batch(["-1.00"]))
    await client.post(_save_path(run_id), headers=headers)
    await run_import_save(uuid.UUID(run_id), owner_id, ScopedSession)
    requested_at = (await _read_run(run_id)).save_requested_at

    with acting_as(owner_id):
        async with ScopedSession() as db:
            await _record_save_error(db, uuid.UUID(run_id), _Refusal(requested_at, 422, "No"))

    run = await _read_run(run_id)
    assert (run.committed_at is not None, run.save_error) == (True, None)


async def test_saves_beyond_the_ones_at_once_run_when_a_slot_frees(client, in_app_runner):
    """With more saves asked for than the app runs at once, each waits for a slot and every one finishes"""
    headers, _ = await _sign_up(client)
    run_ids = [await _open_staged_run(client, headers, _csv_batch(["-1.00"])) for _ in range(MAX_CONCURRENT_SAVES + 1)]

    for run_id in run_ids:
        assert (await client.post(_save_path(run_id), headers=headers)).status_code == 202
    async with asyncio.timeout(_RUNNER_WAIT_SECONDS):
        for run_id in run_ids:
            while (await client.get(_save_path(run_id), headers=headers)).status_code == 202:
                await asyncio.sleep(0.05)

    for run_id in run_ids:
        assert (await client.get(_save_path(run_id), headers=headers)).status_code == 200
