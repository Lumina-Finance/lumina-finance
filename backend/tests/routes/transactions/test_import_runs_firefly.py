"""Firefly III imports staged as a run and committed in one transaction

Rows take the shape the import screen sends for a real export: amounts already unescaped, the
transaction currency and any foreign amount as the export states them, and every imported
account named by its mapping source
"""

import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from app.routes.auth import token_helpers
from tests.conftest import TestSession
from tests.routes.support import _create_user, _get_auth_header
from tests.routes.transactions._helpers import (
    _PAST_ABANDONMENT,
    _age_run,
    _create_account,
    _seed_usd_currency,
    _setup_user_with_deps,
)
from tests.routes.transactions.test_firefly_imports import _chequing_mapping, _firefly_row

_GROCERIES = {"source": "Groceries", "create": {"name": "Groceries", "kind": "expense"}}
_US_SAVINGS = {
    "source": "US Dollar Savings",
    "create": {"name": "US Dollar Savings", "account_type": "savings", "currency": "USD"},
}


def _budget(name="Food", category_sources=("Groceries",)):
    """Build a budget draft with one April limit, written the way the budgets export writes it"""
    return {
        "name": name,
        "currency": "CAD",
        "category_sources": list(category_sources),
        "limits": [{"start": "2026-04-01", "end": "2026-04-30", "amount": "300.000000000000"}],
        "recurrence": None,
    }


async def _open_run(client, headers, expected_transaction_count, source="firefly"):
    """Open a run and return its id"""
    resp = await client.post(
        "/transactions/import/runs",
        json={"expected_transaction_count": expected_transaction_count, "source": source},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _stage(client, headers, run_id, start_row_index, rows, accounts=None, categories=None):
    """Stage one batch of Firefly III rows"""
    resp = await client.post(
        f"/transactions/import/runs/{run_id}/journal/rows",
        json={
            "accounts": accounts or [_chequing_mapping()],
            "categories": [_GROCERIES] if categories is None else categories,
            "rows": rows,
            "start_row_index": start_row_index,
        },
        headers=headers,
    )
    assert resp.status_code == 204, resp.text


async def _put(client, headers, run_id, part, body):
    """Replace a run's budgets or accounts to archive"""
    resp = await client.put(f"/transactions/import/runs/{run_id}/{part}", json=body, headers=headers)
    assert resp.status_code == 204, resp.text


async def _snapshot(client, headers):
    """Return what the user holds that an import could have written"""
    return {
        "accounts": sorted(account["name"] for account in (await client.get("/accounts", headers=headers)).json()),
        "categories": sorted(category["name"] for category in (await client.get("/categories", headers=headers)).json()),
        "transactions": len((await client.get("/transactions", headers=headers)).json()),
        "budgets": len((await client.get("/base-budgets", headers=headers)).json()),
    }


async def test_a_firefly_run_commits_rows_budgets_and_archiving_from_every_batch_together(client):
    """Mappings a later batch or the budgets declare are all in place when the one commit writes."""
    await _seed_usd_currency()
    headers = _get_auth_header(await _create_user(client))
    run_id = await _open_run(client, headers, 3)

    await _stage(
        client,
        headers,
        run_id,
        0,
        [
            _firefly_row(),
            _firefly_row(
                journal_id="2",
                type="opening balance",
                dt="2023-12-31",
                amount="4250.00",
                description='Initial balance for "Everyday Chequing"',
                source_account=None,
                source_name='Initial balance for "Everyday Chequing"',
                destination_account="Everyday Chequing",
                destination_name=None,
                category=None,
            ),
        ],
    )

    # The savings account is declared only here, and this batch reads no category
    await _stage(
        client,
        headers,
        run_id,
        2,
        [
            _firefly_row(
                journal_id="3",
                type="transfer",
                dt="2026-04-12",
                amount="243.95",
                foreign_currency_code="USD",
                foreign_amount="176.07",
                description="Move funds to US dollar savings",
                destination_account="US Dollar Savings",
                destination_name=None,
                category=None,
            )
        ],
        accounts=[_chequing_mapping(), _US_SAVINGS],
        categories=[],
    )

    # Each PUT replaces what the one before it sent, so a second send is what the commit writes
    await _put(client, headers, run_id, "budgets", {"budgets": [_budget(name="Dropped")]})
    await _put(client, headers, run_id, "archive", {"account_sources": ["Everyday Chequing"]})

    # Books is used by no row, so only the budgets declare it
    await _put(
        client,
        headers,
        run_id,
        "budgets",
        {
            "categories": [_GROCERIES, {"source": "Books", "create": {"name": "Books", "kind": "expense"}}],
            "budgets": [_budget(category_sources=("Groceries", "Books"))],
        },
    )
    await _put(client, headers, run_id, "archive", {"account_sources": ["US Dollar Savings"]})

    resp = await client.post(f"/transactions/import/runs/{run_id}/journal/commit", headers=headers)
    assert resp.status_code == 201, resp.text
    summary = resp.json()
    assert {
        key: summary[key]
        for key in (
            "rows_imported",
            "transactions_created",
            "accounts_created",
            "categories_created",
            "categories_reused",
            "budgets_created",
            "accounts_archived",
            "archive_adjustments_created",
        )
    } == {
        "rows_imported": 3,
        "transactions_created": 4,
        "accounts_created": 2,
        # A new user already has Groceries, so only Books is created
        "categories_created": 1,
        "categories_reused": 1,
        "budgets_created": 1,
        "accounts_archived": 1,
        "archive_adjustments_created": 1,
    }

    chequing = (await client.get(f"/accounts/{summary['account_source_ids']['Everyday Chequing']}", headers=headers)).json()
    savings = (await client.get(f"/accounts/{summary['account_source_ids']['US Dollar Savings']}", headers=headers)).json()
    assert (chequing["current_balance"], chequing["is_archived"]) == (425000 - 4567 - 24395, False)

    # Archiving took the savings account's 176.07 back to zero, as archiving it by hand would
    assert (savings["current_balance"], savings["is_archived"]) == (0, True)

    [budget] = (await client.get("/base-budgets", headers=headers)).json()
    assert budget["name"] == "Food"
    assert sorted(budget["category_ids"]) == sorted(summary["category_source_ids"][source] for source in ("Groceries", "Books"))
    periods = [period for period in (await client.get("/budgets", headers=headers)).json() if period["base_budget_id"] == budget["id"]]
    assert [(period["period_start"], period["period_end"], period["overall_limit"]) for period in periods] == [
        ("2026-04-01", "2026-04-30", 30000),
    ]

    # A commit whose response was lost is answered from the first, writing nothing again
    before = await _snapshot(client, headers)
    repeat = await client.post(f"/transactions/import/runs/{run_id}/journal/commit", headers=headers)
    assert repeat.status_code == 201
    assert repeat.json() == summary
    assert await _snapshot(client, headers) == before


async def test_a_firefly_run_commits_more_rows_than_one_batch_carries(client):
    """The commit writes every staged row in one write, past the most one request may carry."""
    headers = _get_auth_header(await _create_user(client))
    run_id = await _open_run(client, headers, 5001)

    await _stage(client, headers, run_id, 0, [_firefly_row(journal_id=str(index)) for index in range(5000)])
    await _stage(client, headers, run_id, 5000, [_firefly_row(journal_id="5000")])

    resp = await client.post(f"/transactions/import/runs/{run_id}/journal/commit", headers=headers)
    assert resp.status_code == 201, resp.text
    assert (resp.json()["rows_imported"], resp.json()["transactions_created"]) == (5001, 5001)


def _future_date():
    """A date well past anyone's today, whatever their time zone"""
    return (datetime.now(UTC).date() + timedelta(days=30)).isoformat()


@pytest.mark.parametrize(
    ("case", "detail"),
    [
        (
            "row",
            "Firefly III journal 2: Neither the amount nor the foreign amount is in the account's currency (CAD)",
        ),
        ("row-unmapped", "Firefly III journal 2: Category source is not mapped: Dining"),
        ("budget", "Travel: category source Travel has no category mapping in this import"),
        ("archive-unmapped", "Account source Holiday Fund is not an account this import creates, so it can't be archived"),
        ("archive-existing", "Account source Old Chequing is not an account this import creates, so it can't be archived"),
        ("archive-future", "Account source Everyday Chequing: This account can't be archived because it has future dated transactions."),
    ],
)
async def test_a_firefly_run_failing_at_any_stage_saves_nothing(client, case, detail):
    """A row, budget or archive that cannot be written leaves the user as they were, and the run open."""
    headers = _get_auth_header(await _create_user(client))
    old_account = (await _create_account(client, headers, name="Old Chequing", currency="CAD")).json()
    before = await _snapshot(client, headers)

    rows = [_firefly_row()]
    if case == "row":
        rows.append(_firefly_row(journal_id="2", amount="12.00", currency_code="EUR"))
    if case == "row-unmapped":
        rows.append(_firefly_row(journal_id="2", category="Dining"))
    if case == "archive-future":
        rows.append(_firefly_row(journal_id="2", dt=_future_date()))
    run_id = await _open_run(client, headers, len(rows))
    await _stage(
        client,
        headers,
        run_id,
        0,
        rows,
        accounts=[
            _chequing_mapping(),
            {"source": "Old Chequing", "account_id": old_account["id"]},
        ],
    )

    budgets = [_budget()]
    if case == "budget":
        budgets.append(_budget(name="Travel", category_sources=("Travel",)))
    await _put(client, headers, run_id, "budgets", {"budgets": budgets})
    archive = {
        "archive-unmapped": ["Holiday Fund"],
        "archive-existing": ["Old Chequing"],
        "archive-future": ["Everyday Chequing"],
    }.get(case, [])
    await _put(client, headers, run_id, "archive", {"account_sources": archive})

    resp = await client.post(f"/transactions/import/runs/{run_id}/journal/commit", headers=headers)
    assert resp.status_code == 422
    assert resp.json()["detail"].startswith(detail)
    assert await _snapshot(client, headers) == before

    # Still open, so the same commit answers the same way rather than from a stored summary
    again = await client.post(f"/transactions/import/runs/{run_id}/journal/commit", headers=headers)
    assert (again.status_code, again.json()["detail"]) == (422, resp.json()["detail"])


_GENERIC_BATCH = {
    "accounts": [{"source": "Main Chequing", "create": {"name": "Main Chequing", "account_type": "checking", "currency": "CAD"}}],
    "categories": [_GROCERIES],
    "rows": [{"account_source": "Main Chequing", "category_source": "Groceries", "dt": "2026-04-10", "amount": "-1.00"}],
    "start_row_index": 0,
}


@pytest.mark.parametrize(
    ("source", "method", "path", "body", "detail"),
    [
        (
            "generic",
            "post",
            "journal/rows",
            {"accounts": [_chequing_mapping()], "rows": [_firefly_row()], "start_row_index": 0},
            "This import run is a CSV import",
        ),
        ("firefly", "post", "rows", _GENERIC_BATCH, "This import run is a Firefly III import"),
        ("firefly", "post", "commit", None, "This import run is a Firefly III import"),
        ("generic", "post", "journal/commit", None, "This import run is a CSV import"),
        ("generic", "put", "budgets", {"budgets": [_budget()]}, "A CSV import has no budgets"),
        ("generic", "put", "archive", {"account_sources": ["Main Chequing"]}, "A CSV import archives no accounts"),
    ],
)
async def test_a_run_takes_requests_only_from_the_importer_that_opened_it(client, source, method, path, body, detail):
    """Each importer's rows are read by its own commit, so another importer's requests are refused."""
    headers = _get_auth_header(await _create_user(client))
    run_id = await _open_run(client, headers, 1, source=source)

    resp = await client.request(method, f"/transactions/import/runs/{run_id}/{path}", json=body, headers=headers)
    assert (resp.status_code, resp.json()["detail"]) == (422, detail)


async def test_another_users_firefly_run_is_out_of_reach(client):
    """Every Firefly III run endpoint answers another user as if the run did not exist."""
    owner_headers, _, _ = await _setup_user_with_deps(client)
    other_headers, _, _ = await _setup_user_with_deps(client, email="other@example.com", name_prefix="Other")
    run_id = await _open_run(client, owner_headers, 1)
    base = f"/transactions/import/runs/{run_id}"

    responses = [
        await client.post(
            f"{base}/journal/rows",
            json={
                "accounts": [_chequing_mapping()],
                "categories": [_GROCERIES],
                "rows": [_firefly_row()],
                "start_row_index": 0,
            },
            headers=other_headers,
        ),
        await client.put(f"{base}/budgets", json={"categories": [_GROCERIES], "budgets": [_budget()]}, headers=other_headers),
        await client.put(f"{base}/archive", json={"account_sources": ["Everyday Chequing"]}, headers=other_headers),
        await client.post(f"{base}/journal/commit", headers=other_headers),
    ]

    assert [(resp.status_code, resp.json()["detail"]) for resp in responses] == [(404, "Import run not found")] * 4


async def test_a_firefly_run_refuses_an_outside_account_when_staged_and_takes_the_corrected_answer(client):
    """An outside answer is refused before it is kept, so the same run commits once the answer is fixed."""
    headers = _get_auth_header(await _create_user(client))
    run_id = await _open_run(client, headers, 1)
    brokerage_row = _firefly_row(source_account="Brokerage elsewhere")

    refused = await client.post(
        f"/transactions/import/runs/{run_id}/journal/rows",
        json={
            "accounts": [{"source": "Brokerage elsewhere", "outside": True}],
            "categories": [_GROCERIES],
            "rows": [brokerage_row],
            "start_row_index": 0,
        },
        headers=headers,
    )
    assert (refused.status_code, refused.json()["detail"]) == (
        422,
        "Account source cannot be outside the tracked accounts: Brokerage elsewhere",
    )

    brokerage = {"source": "Brokerage elsewhere", "create": {"name": "Brokerage", "account_type": "checking", "currency": "CAD"}}
    await _stage(client, headers, run_id, 0, [brokerage_row], accounts=[brokerage])
    committed = await client.post(f"/transactions/import/runs/{run_id}/journal/commit", headers=headers)
    assert committed.status_code == 201, committed.text
    assert committed.json()["transactions_created"] == 1


@pytest.mark.parametrize(
    ("part", "body"),
    [
        ("budgets", {"categories": [_GROCERIES], "budgets": [{**_budget(), "name": " Food"}]}),
        ("budgets", {"categories": [_GROCERIES], "budgets": [{**_budget(), "currency": "cad"}]}),
        ("budgets", {"categories": [_GROCERIES], "budgets": [_budget(category_sources=("Groceries ",))]}),
        *[
            (
                "budgets",
                {
                    "categories": [_GROCERIES],
                    "budgets": [
                        {
                            **_budget(),
                            "limits": [{"start": "2026-04-01", "end": "2026-04-30", "amount": amount}],
                        }
                    ],
                },
            )
            for amount in ("+300.00", "-1.00", "not-a-number", " 300.00", "1,300.00")
        ],
        ("archive", {"account_sources": ["Everyday Chequing "]}),
        ("archive", {"account_sources": ["Everyday Chequing", "Everyday Chequing"]}),
    ],
)
async def test_a_firefly_run_refuses_budgets_or_archiving_the_import_screen_would_have_cleaned(client, part, body):
    """Budgets and accounts to archive arrive in their one canonical form, so any other form is refused."""
    headers = _get_auth_header(await _create_user(client))
    run_id = await _open_run(client, headers, 1)

    # Request validation answers with a list of field errors, where a refusal later on names a reason
    resp = await client.put(f"/transactions/import/runs/{run_id}/{part}", json=body, headers=headers)
    assert resp.status_code == 422
    assert isinstance(resp.json()["detail"], list)


async def _open_staged_run(client, headers):
    """Open a one-row run and stage its row, leaving it ready to commit"""
    run_id = await _open_run(client, headers, 1)
    await _stage(client, headers, run_id, 0, [_firefly_row()])
    return run_id


async def _count_run_rows(run_id):
    """Return how many rows are left of a run and of what it staged, read past row-level security"""
    async with TestSession() as session:
        runs = (await session.execute(text("SELECT count(*) FROM import_runs WHERE id = :id"), {"id": run_id})).scalar_one()
        staged = (
            await session.execute(
                text("SELECT count(*) FROM import_staged_rows WHERE import_run_id = :id"),
                {"id": run_id},
            )
        ).scalar_one()
    return runs, staged


async def test_opening_a_run_deletes_the_users_abandoned_runs_and_keeps_committed_and_recent_ones(client):
    """A run left uncommitted goes once the user imports again, and a committed one still answers its commit."""
    headers = _get_auth_header(await _create_user(client))
    other_headers, _, _ = await _setup_user_with_deps(client, email="other@example.com", name_prefix="Other")
    others = await _open_staged_run(client, other_headers)
    await _age_run(others, _PAST_ABANDONMENT)
    committed = await _open_staged_run(client, headers)
    summary = (await client.post(f"/transactions/import/runs/{committed}/journal/commit", headers=headers)).json()
    abandoned = await _open_staged_run(client, headers)
    recent = await _open_staged_run(client, headers)
    await _age_run(committed, _PAST_ABANDONMENT)
    await _age_run(abandoned, _PAST_ABANDONMENT)

    await _open_run(client, headers, 1)

    replayed, gone, fresh = [
        await client.post(f"/transactions/import/runs/{run_id}/journal/commit", headers=headers) for run_id in (committed, abandoned, recent)
    ]
    assert (replayed.status_code, replayed.json()) == (201, summary)
    assert (gone.status_code, gone.json()["detail"]) == (404, "Import run not found")
    assert fresh.status_code == 201, fresh.text
    assert await _count_run_rows(abandoned) == (0, 0)

    # Only the importing user's runs are cleared, however long another user has left theirs
    assert await _count_run_rows(others) == (1, 1)


async def test_opening_a_run_passes_over_an_abandoned_run_another_request_holds(client):
    """A run a commit still holds is left for that commit to settle, rather than waited on or deleted."""
    headers = _get_auth_header(await _create_user(client))
    held = await _open_staged_run(client, headers)
    await _age_run(held, _PAST_ABANDONMENT)

    # Bounded so that waiting on the held run fails this test rather than hanging it
    async with TestSession() as holder:
        await holder.execute(text("SELECT id FROM import_runs WHERE id = :id FOR UPDATE"), {"id": held})
        async with asyncio.timeout(5):
            await _open_run(client, headers, 1)
        await holder.rollback()

    assert await _count_run_rows(held) == (1, 1)


async def test_an_abandoned_run_is_refused_rather_than_saved(client):
    """A run left uncommitted past the cutoff never lands, so an import brought in again since cannot double."""
    headers = _get_auth_header(await _create_user(client))
    before = await _snapshot(client, headers)
    run_id = await _open_staged_run(client, headers)
    await _age_run(run_id, _PAST_ABANDONMENT)

    resp = await client.post(f"/transactions/import/runs/{run_id}/journal/commit", headers=headers)

    assert (resp.status_code, resp.json()["detail"]) == (422, "This import expired before it was saved")
    assert await _snapshot(client, headers) == before


async def test_renewing_a_sign_in_deletes_the_users_abandoned_runs(client):
    """A run left uncommitted goes even when its user never imports again, so nothing is kept for good."""
    signup = await _create_user(client)
    abandoned = await _open_staged_run(client, _get_auth_header(signup))
    await _age_run(abandoned, _PAST_ABANDONMENT)
    client.cookies.set("refresh_token", signup.cookies["refresh_token"])

    resp = await client.post("/auth/refresh")

    assert resp.status_code == 200, resp.text
    assert await _count_run_rows(abandoned) == (0, 0)


async def test_renewing_a_sign_in_succeeds_when_its_import_cleanup_fails(client, monkeypatch):
    """The cleanup is only housekeeping, so its failure leaves the user signed in."""
    signup = await _create_user(client)

    async def fail_cleanup(db, _user):
        # A real failure comes mid-statement, so the cleanup has a transaction open to roll back
        await db.execute(text("SELECT 1"))
        raise RuntimeError("cleanup failed")

    monkeypatch.setattr(token_helpers, "delete_abandoned_import_runs", fail_cleanup)
    client.cookies.set("refresh_token", signup.cookies["refresh_token"])

    resp = await client.post("/auth/refresh")

    assert resp.status_code == 200, resp.text
    assert resp.json()["user"]["id"] == signup.json()["user"]["id"]
    assert "refresh_token" in resp.cookies
