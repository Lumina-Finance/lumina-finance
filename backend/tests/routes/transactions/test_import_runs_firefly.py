"""Firefly III imports staged as a run and committed in one transaction

Rows take the shape the import screen sends for a real export: amounts already unescaped, the
transaction currency and any foreign amount as the export states them, and every imported
account named by its mapping source
"""

from datetime import UTC, datetime, timedelta

import pytest

from tests.routes.support import _create_user, _get_auth_header
from tests.routes.transactions._helpers import _create_account, _seed_usd_currency
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
    resp = await client.post(f"/transactions/import/runs/{run_id}/firefly/rows", json={
        "accounts": accounts or [_chequing_mapping()],
        "categories": [_GROCERIES] if categories is None else categories,
        "rows": rows,
        "start_row_index": start_row_index,
    }, headers=headers)
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

    await _stage(client, headers, run_id, 0, [
        _firefly_row(),
        _firefly_row(
            journal_id="2",
            type="Opening balance",
            dt="2023-12-31",
            amount="4250.00",
            description='Initial balance for "Everyday Chequing"',
            source_account=None,
            source_name='Initial balance for "Everyday Chequing"',
            destination_account="Everyday Chequing",
            destination_name=None,
            category=None,
        ),
    ])

    # The savings account is declared only here, and this batch reads no category
    await _stage(client, headers, run_id, 2, [_firefly_row(
        journal_id="3",
        type="Transfer",
        dt="2026-04-12",
        amount="243.95",
        foreign_currency_code="USD",
        foreign_amount="176.07",
        description="Move funds to US dollar savings",
        destination_account="US Dollar Savings",
        destination_name=None,
        category=None,
    )], accounts=[_chequing_mapping(), _US_SAVINGS], categories=[])

    # Each PUT replaces what the one before it sent, so a second send is what the commit writes
    await _put(client, headers, run_id, "budgets", {"budgets": [_budget(name="Dropped")]})
    await _put(client, headers, run_id, "archive", {"account_sources": ["Everyday Chequing"]})

    # Books is used by no row, so only the budgets declare it, and a source is matched trimmed
    await _put(client, headers, run_id, "budgets", {
        "categories": [_GROCERIES, {"source": "Books", "create": {"name": "Books", "kind": "expense"}}],
        "budgets": [_budget(category_sources=("Groceries", " Books "))],
    })
    await _put(client, headers, run_id, "archive", {"account_sources": ["US Dollar Savings"]})

    resp = await client.post(f"/transactions/import/runs/{run_id}/firefly/commit", headers=headers)
    assert resp.status_code == 201, resp.text
    summary = resp.json()
    assert {key: summary[key] for key in (
        "rows_imported", "transactions_created", "accounts_created", "categories_created", "categories_reused",
        "budgets_created", "accounts_archived", "archive_adjustments_created",
    )} == {
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
    repeat = await client.post(f"/transactions/import/runs/{run_id}/firefly/commit", headers=headers)
    assert repeat.status_code == 201
    assert repeat.json() == summary
    assert await _snapshot(client, headers) == before


async def test_a_firefly_run_commits_more_rows_than_one_batch_carries(client):
    """The commit writes every staged row in one write, past the most one request may carry."""
    headers = _get_auth_header(await _create_user(client))
    run_id = await _open_run(client, headers, 5001)

    await _stage(client, headers, run_id, 0, [_firefly_row(journal_id=str(index)) for index in range(5000)])
    await _stage(client, headers, run_id, 5000, [_firefly_row(journal_id="5000")])

    resp = await client.post(f"/transactions/import/runs/{run_id}/firefly/commit", headers=headers)
    assert resp.status_code == 201, resp.text
    assert (resp.json()["rows_imported"], resp.json()["transactions_created"]) == (5001, 5001)


def _future_date():
    """A date well past anyone's today, whatever their time zone"""
    return (datetime.now(UTC).date() + timedelta(days=30)).isoformat()


@pytest.mark.parametrize(("case", "detail"), [
    (
        "row",
        "Row 2 (Firefly III journal 2): Neither the amount nor the foreign amount is in the account's currency (CAD)",
    ),
    ("row-unmapped", "Row 2 (Firefly III journal 2): Category source is not mapped: Dining"),
    ("budget", "Travel: category source Travel has no category mapping in this import"),
    ("archive-unmapped", "Account source Holiday Fund is not an account this import creates, so it can't be archived"),
    ("archive-existing", "Account source Old Chequing is not an account this import creates, so it can't be archived"),
    ("archive-future", "Account source Everyday Chequing: This account can't be archived because it has future dated transactions."),
])
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
    await _stage(client, headers, run_id, 0, rows, accounts=[
        _chequing_mapping(),
        {"source": "Old Chequing", "account_id": old_account["id"]},
    ])

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

    resp = await client.post(f"/transactions/import/runs/{run_id}/firefly/commit", headers=headers)
    assert resp.status_code == 422
    assert resp.json()["detail"].startswith(detail)
    assert await _snapshot(client, headers) == before

    # Still open, so the same commit answers the same way rather than from a stored summary
    again = await client.post(f"/transactions/import/runs/{run_id}/firefly/commit", headers=headers)
    assert (again.status_code, again.json()["detail"]) == (422, resp.json()["detail"])


_GENERIC_BATCH = {
    "accounts": [{"source": "Main Chequing", "create": {"name": "Main Chequing", "account_type": "checking", "currency": "CAD"}}],
    "categories": [_GROCERIES],
    "rows": [{"account_source": "Main Chequing", "category_source": "Groceries", "dt": "2026-04-10", "amount": "-1.00"}],
    "start_row_index": 0,
}


@pytest.mark.parametrize(("source", "method", "path", "body", "detail"), [
    (
        "generic",
        "post",
        "firefly/rows",
        {"accounts": [_chequing_mapping()], "rows": [_firefly_row()], "start_row_index": 0},
        "This import run is a CSV import",
    ),
    ("firefly", "post", "rows", _GENERIC_BATCH, "This import run is a Firefly III import"),
    ("firefly", "post", "commit", None, "This import run is a Firefly III import"),
    ("generic", "post", "firefly/commit", None, "This import run is a CSV import"),
    ("generic", "put", "budgets", {"budgets": [_budget()]}, "A CSV import has no budgets"),
    ("generic", "put", "archive", {"account_sources": ["Main Chequing"]}, "A CSV import archives no accounts"),
])
async def test_a_run_takes_requests_only_from_the_importer_that_opened_it(client, source, method, path, body, detail):
    """Each importer's rows are read by its own commit, so another importer's requests are refused."""
    headers = _get_auth_header(await _create_user(client))
    run_id = await _open_run(client, headers, 1, source=source)

    resp = await client.request(method, f"/transactions/import/runs/{run_id}/{path}", json=body, headers=headers)
    assert (resp.status_code, resp.json()["detail"]) == (422, detail)
