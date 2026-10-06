"""Undoing a saved import deletes everything it wrote, while nothing has changed since"""

import asyncio
import json
import uuid
from datetime import datetime, timedelta

import pytest
from sqlalchemy import func, select, text

from app.models.tag import TransactionTag
from app.services.importers.shared import run_history as run_history_module
from app.services.importers.shared.run_staging import IMPORT_UNDO_WINDOW
from tests.conftest import TestSession
from tests.routes.support import _create_account, _create_user, _get_auth_header, _wait_until_blocked
from tests.routes.transactions._helpers import _create_transaction, _get_system_category_id, _setup_user_with_deps
from tests.routes.transactions._import_helpers import (
    _GROCERIES,
    _chequing_mapping,
    _firefly_row,
    _import_run,
    _list_transactions,
    _open_run,
    _open_staged_run,
)

_LAST = "/transactions/import/last"

# Just either side of how long after saving an import it can be undone
_PAST_UNDO_WINDOW = IMPORT_UNDO_WINDOW + timedelta(minutes=1)
_SHORT_OF_UNDO_WINDOW = IMPORT_UNDO_WINDOW - timedelta(minutes=1)

_COFFEE = {"source": "Coffee", "create": {"name": "Coffee", "kind": "expense"}}

_EVERYDAY = {"source": "Everyday", "create": {"name": "Everyday", "account_type": "checking", "currency": "CAD"}}


def _csv_payload(amounts):
    """Build a CSV import of one row per amount into a new account, a new category, payee and tag"""
    return {
        "accounts": [_EVERYDAY],
        "categories": [_COFFEE],
        "rows": [
            {
                "account_source": "Everyday",
                "category_source": "Coffee",
                "merchant_name": "Corner Roastery",
                "dt": "2026-04-10",
                "amount": amount,
                "tag_names": ["Trip"],
            }
            for amount in amounts
        ],
    }


async def _undo(client, headers, run_id):
    return await client.post(f"/transactions/import/runs/{run_id}/undo", headers=headers)


async def _last(client, headers):
    resp = await client.get(_LAST, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _age_commit(run_id, age):
    """Move an import's save back, with the change marker it was stamped with, as if saved that long ago"""
    async with TestSession() as session:
        await session.execute(
            text("""
                UPDATE user_cache_states SET changed_at = changed_at - CAST(:age AS interval)
                WHERE user_id = (SELECT owner_id FROM import_runs WHERE id = :id)
            """),
            {"age": age, "id": run_id},
        )
        await session.execute(
            text("UPDATE import_runs SET committed_at = committed_at - CAST(:age AS interval) WHERE id = :id"),
            {"age": age, "id": run_id},
        )
        await session.commit()


async def _count(table, record_id):
    """Return whether a record is still there, read past row-level security"""
    async with TestSession() as session:
        return await session.scalar(text(f"SELECT count(*) FROM {table} WHERE id = :id"), {"id": record_id})  # noqa: S608


async def _count_unlinked_rows(account_id):
    """Return how many of an account's transactions are linked to no import"""
    async with TestSession() as session:
        return await session.scalar(
            text("SELECT count(*) FROM transactions WHERE account_id = :id AND import_run_id IS NULL"), {"id": account_id},
        )


async def _import_everyday(client, headers, amounts=("-4.50", "-3.25", "-6.00")):
    """Import a CSV into a new account Everyday, returning the run and its summary"""
    committed = await _import_run(client, headers, _csv_payload(list(amounts)), file_name="everyday-test.csv")
    assert committed.status_code == 201, committed.text
    return (await _last(client, headers))["id"], committed.json()


async def test_undo_deletes_everything_the_import_wrote_and_keeps_what_it_reused(client):
    """Undo would leave the records the import created behind, or take an account that existed before it"""
    headers, main_id, _ = await _setup_user_with_deps(client)
    main_before = (await client.get(f"/accounts/{main_id}", headers=headers)).json()["current_balance"]
    payload = _csv_payload(["-4.50", "-3.25"])
    payload["accounts"] = [_EVERYDAY, {"source": "Main", "account_id": main_id}]
    payload["rows"][1]["account_source"] = "Main"
    committed = await _import_run(client, headers, payload, file_name="everyday-test.csv")
    assert committed.status_code == 201, committed.text
    summary = committed.json()

    entry = await _last(client, headers)
    assert (entry["source"], entry["file_name"], entry["transaction_count"]) == ("generic", "everyday-test.csv", 2)
    counts = ("account_count", "category_count", "merchant_count", "tag_count", "budget_count")
    assert tuple(entry[key] for key in counts) == (1, 1, 1, 1, 0)

    resp = await _undo(client, headers, entry["id"])
    assert resp.status_code == 200, resp.text
    assert resp.json()["transactions_deleted"] == 2

    for table, field in (
        ("accounts", "created_account_ids"), ("categories", "created_category_ids"),
        ("merchants", "created_merchant_ids"), ("tags", "created_tag_ids"),
    ):
        for record_id in summary[field]:
            assert await _count(table, record_id) == 0, table
    async with TestSession() as session:
        assert await session.scalar(select(func.count()).select_from(TransactionTag)) == 0
    main = (await client.get(f"/accounts/{main_id}", headers=headers)).json()
    assert main["current_balance"] == main_before

    # The run goes with it, so a second undo finds nothing
    assert await _last(client, headers) is None
    again = await _undo(client, headers, entry["id"])
    assert (again.status_code, again.json()["detail"]) == (404, "Import not found")


async def test_another_user_cannot_see_or_undo_an_import(client):
    """Another user's list leaves the import out, and their undo finds nothing and deletes nothing"""
    headers, _, _ = await _setup_user_with_deps(client)
    other_headers, _, _ = await _setup_user_with_deps(client, email="other@example.com", name_prefix="Other")
    run_id, summary = await _import_everyday(client, headers)

    assert await _last(client, other_headers) is None
    resp = await _undo(client, other_headers, run_id)
    assert (resp.status_code, resp.json()["detail"]) == (404, "Import not found")

    everyday_id = summary["created_account_ids"][0]
    assert len([t for t in await _list_transactions(client, headers) if t["account_id"] == everyday_id]) == 3


async def test_undo_deletes_a_provider_import_with_the_accounts_it_archived_and_its_budgets(client):
    """Undo would be refused by the accounts the import archived, or leave its budgets behind"""
    headers, _, _ = await _setup_user_with_deps(client)
    savings = {"source": "Savings", "create": {"name": "Savings", "account_type": "savings", "currency": "CAD"}}
    payload = {
        "accounts": [_chequing_mapping(), savings],
        "categories": [_GROCERIES],
        "rows": [
            _firefly_row(journal_id="1"),
            _firefly_row(journal_id="2", source_account="Savings", amount="10.00"),
        ],
    }
    budgets = {
        "categories": [_GROCERIES],
        "budgets": [{
            "name": "Groceries",
            "currency": "CAD",
            "category_sources": ["Groceries"],
            "limits": [{"start": "2026-04-01", "end": "2026-04-30", "amount": "300.00"}],
            "recurrence": None,
        }],
    }
    committed = await _import_run(
        client, headers, payload, source="firefly", budgets=budgets,
        archive={"account_sources": ["Everyday Chequing", "Savings"]}, file_name="firefly-export.csv",
    )
    assert committed.status_code == 201, committed.text
    summary = committed.json()

    # Both rows and both archive adjustments are the import's
    entry = await _last(client, headers)
    assert (entry["transaction_count"], entry["account_count"], entry["budget_count"]) == (4, 2, 1)
    resp = await _undo(client, headers, entry["id"])
    assert resp.status_code == 200, resp.text
    assert resp.json()["transactions_deleted"] == 4
    for account_id in summary["created_account_ids"]:
        assert await _count("accounts", account_id) == 0
    assert await _count("base_budgets", summary["budgets"][0]["base_budget_id"]) == 0


@pytest.mark.parametrize("change", ["edit_imported_row", "create_unrelated_tag"])
async def test_any_change_after_the_import_makes_it_permanent(client, change):
    """Undo would delete records the user has since used or changed"""
    headers, _, _ = await _setup_user_with_deps(client)
    run_id, summary = await _import_everyday(client, headers)
    everyday_id = summary["created_account_ids"][0]
    if change == "edit_imported_row":
        imported = [t for t in await _list_transactions(client, headers) if t["account_id"] == everyday_id]
        resp = await client.patch(f"/transactions/{imported[0]['id']}", json={"notes": "Edited"}, headers=headers)
    else:
        resp = await client.post("/tags", json={"name": "Holiday"}, headers=headers)
    assert resp.status_code in (200, 201), resp.text

    assert await _last(client, headers) is None
    refused = await _undo(client, headers, run_id)
    assert (refused.status_code, refused.json()["detail"]) == (409, "This import can no longer be undone")
    assert await _count("accounts", everyday_id) == 1


async def test_a_change_landing_during_an_undo_makes_it_permanent(client, monkeypatch):
    """Undo would read the marker before a change landed and delete the records that change used"""
    headers, _, _ = await _setup_user_with_deps(client)
    run_id, summary = await _import_everyday(client, headers)

    original = run_history_module.load_locked_change_marker
    undo_pid = []

    async def record_pid(db, user_id):
        undo_pid.append(await db.scalar(text("SELECT pg_backend_pid()")))
        return await original(db, user_id)

    monkeypatch.setattr(run_history_module, "load_locked_change_marker", record_pid)
    async with asyncio.timeout(10), TestSession() as writer:
        # A write marks the user's data changed as it finishes, and holds the marker until it commits
        writer_pid = await writer.scalar(text("SELECT pg_backend_pid()"))
        await writer.execute(
            text("""
                UPDATE user_cache_states SET changed_at = clock_timestamp()
                WHERE user_id = (SELECT owner_id FROM import_runs WHERE id = :id)
            """),
            {"id": run_id},
        )
        undo = asyncio.create_task(_undo(client, headers, run_id))
        while not undo_pid:
            await asyncio.sleep(0.01)
        await _wait_until_blocked(writer_pid, undo_pid[0])
        await writer.commit()
        resp = await undo

    assert (resp.status_code, resp.json()["detail"]) == (409, "This import can no longer be undone")
    assert await _count("accounts", summary["created_account_ids"][0]) == 1


async def test_two_undos_at_once_delete_the_import_once(client, monkeypatch):
    """A second undo queued behind the first finds the import gone rather than undoing it twice"""
    headers, _, _ = await _setup_user_with_deps(client)
    run_id, _ = await _import_everyday(client, headers)

    original = run_history_module.load_locked_run
    first_locked = asyncio.Event()
    release_first = asyncio.Event()
    pids = []

    # Holds the first request once it has the run, then lets the second queue behind it
    async def hold_first(db, locked_run_id):
        pids.append(await db.scalar(text("SELECT pg_backend_pid()")))
        run = await original(db, locked_run_id)
        if len(pids) == 1:
            first_locked.set()
            await release_first.wait()
        return run

    monkeypatch.setattr(run_history_module, "load_locked_run", hold_first)
    async with asyncio.timeout(10):
        first = asyncio.create_task(_undo(client, headers, run_id))
        await first_locked.wait()
        second = asyncio.create_task(_undo(client, headers, run_id))
        while len(pids) < 2:
            await asyncio.sleep(0.01)
        await _wait_until_blocked(pids[0], pids[1])
        release_first.set()
        responses = await asyncio.gather(first, second)

    assert [response.status_code for response in responses] == [200, 404]
    assert responses[0].json()["transactions_deleted"] == 3


async def test_saving_an_import_removes_the_previous_one_and_keeps_its_rows(client):
    """An earlier import would stay undoable, its run and links kept for good, or a staged upload lost"""
    headers, _, _ = await _setup_user_with_deps(client)
    older, older_summary = await _import_everyday(client, headers, amounts=("-1.00",))
    # A file staged in another tab while the next import saves is not a saved import, so it stays
    staged = await _open_staged_run(client, headers, _csv_payload(["-2.00"]))
    newer, _ = await _import_everyday(client, headers)

    assert (await _last(client, headers))["id"] == newer
    gone = await _undo(client, headers, older)
    assert (gone.status_code, gone.json()["detail"]) == (404, "Import not found")
    assert await _count("import_runs", older) == 0
    assert await _count_unlinked_rows(older_summary["created_account_ids"][0]) == 1
    assert await _count("import_runs", staged) == 1


async def test_an_import_is_offered_for_the_whole_undo_window(client):
    """A window cut short would take undo away early, and the card would show the wrong end"""
    headers, _, _ = await _setup_user_with_deps(client)
    run_id, _ = await _import_everyday(client, headers)
    await _age_commit(run_id, _SHORT_OF_UNDO_WINDOW)

    # Cleanup, which runs when an upload is opened, keeps it too
    await _open_run(client, headers, file_name="second.csv")
    entry = await _last(client, headers)
    assert entry["id"] == run_id
    committed_at = datetime.fromisoformat(entry["committed_at"])
    assert datetime.fromisoformat(entry["undo_until"]) - committed_at == IMPORT_UNDO_WINDOW
    resp = await _undo(client, headers, run_id)
    assert resp.status_code == 200, resp.text


async def test_an_import_past_the_undo_window_is_refused_then_deleted_with_its_links(client):
    """An old import would stay undoable, and its run and links would be kept for good"""
    headers, _, _ = await _setup_user_with_deps(client)
    run_id, summary = await _import_everyday(client, headers)
    await _age_commit(run_id, _PAST_UNDO_WINDOW)

    assert await _last(client, headers) is None
    refused = await _undo(client, headers, run_id)
    assert (refused.status_code, refused.json()["detail"]) == (409, "This import can no longer be undone")

    # Opening the next upload clears what has expired
    await _open_run(client, headers)
    assert await _count("import_runs", run_id) == 0
    assert await _count_unlinked_rows(summary["created_account_ids"][0]) == 3


async def test_an_import_a_change_made_permanent_is_kept_for_the_undo_window(client):
    """A cleanup straight away would turn a lost commit response into a second save of the same file"""
    headers, _, _ = await _setup_user_with_deps(client)
    run_id, _ = await _import_everyday(client, headers)
    resp = await client.post("/tags", json={"name": "Holiday"}, headers=headers)
    assert resp.status_code == 201, resp.text
    await _age_commit(run_id, _SHORT_OF_UNDO_WINDOW)

    await _open_run(client, headers)
    assert await _count("import_runs", run_id) == 1


async def test_undo_deletes_more_created_records_than_one_statement_can_bind(client):
    """A run that created tens of thousands of merchants would make the card or the undo fail"""
    headers, _, _ = await _setup_user_with_deps(client)
    run_id, _ = await _import_everyday(client, headers)
    created = [str(uuid.uuid4()) for _ in range(40_000)]
    async with TestSession() as session:
        await session.execute(
            text("UPDATE import_runs SET summary = jsonb_set(summary, '{created_merchant_ids}', CAST(:ids AS jsonb)) WHERE id = :id"),
            {"ids": json.dumps(created), "id": run_id},
        )
        await session.commit()

    assert (await _last(client, headers))["merchant_count"] == 40_000
    resp = await _undo(client, headers, run_id)
    assert resp.status_code == 200, resp.text


async def test_an_import_into_a_group_account_cannot_be_undone(client):
    """Undo would delete rows in an account other members share"""
    signup = await _create_user(client)
    headers = _get_auth_header(signup)
    group = await client.post("/groups", json={"name": "Smith Family"}, headers=headers)
    assert group.status_code == 201, group.text
    joint = await _create_account(client, headers, name="Joint Checking", group_id=group.json()["id"])
    payload = {**_csv_payload(["-4.50"]), "accounts": [{"source": "Everyday", "account_id": joint.json()["id"]}]}
    committed = await _import_run(client, headers, payload, file_name="joint.csv")
    assert committed.status_code == 201, committed.text

    # It is never offered, and asked for directly it is refused with its row kept
    assert await _last(client, headers) is None
    async with TestSession() as session:
        run_id = await session.scalar(text("SELECT id FROM import_runs WHERE file_name = 'joint.csv'"))
    refused = await _undo(client, headers, run_id)
    assert (refused.status_code, refused.json()["detail"]) == (422, "Imports into group accounts can't be undone")
    assert len([t for t in await _list_transactions(client, headers) if t["account_id"] == joint.json()["id"]]) == 1


@pytest.mark.parametrize("reference", ["transfer_counterparty", "category"])
async def test_a_group_transaction_referencing_what_the_import_created_makes_undo_refuse(client, reference):
    """A group change marks only the group, so undo would fail with a server error on the record it names"""
    signup = await _create_user(client)
    headers = _get_auth_header(signup)
    group = await client.post("/groups", json={"name": "Smith Family"}, headers=headers)
    assert group.status_code == 201, group.text
    joint_id = (await _create_account(client, headers, name="Joint Checking", group_id=group.json()["id"])).json()["id"]
    run_id, summary = await _import_everyday(client, headers)
    everyday_id = summary["created_account_ids"][0]

    if reference == "category":
        group_row = await _create_transaction(client, headers, joint_id, summary["created_category_ids"][0])
    else:
        transfer_category = await _get_system_category_id(client, headers, "Transfer")
        group_row = await _create_transaction(
            client, headers, joint_id, transfer_category,
            counterparty_account_id=everyday_id, counterparty_account_scope="tracked",
        )
    assert group_row.status_code == 201, group_row.text

    resp = await _undo(client, headers, run_id)
    assert (resp.status_code, resp.json()["detail"]) == (409, "This import can no longer be undone")

    # Nothing of it was deleted
    assert await _count("accounts", everyday_id) == 1
    assert await _count("categories", summary["created_category_ids"][0]) == 1
    async with TestSession() as session:
        rows = await session.scalar(text("SELECT count(*) FROM transactions WHERE import_run_id = :id"), {"id": run_id})
    assert rows == 3
