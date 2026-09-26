"""Actual Budget imports staged as a journal run and committed in one transaction

Rows take the shape the import screen compiles from an Actual Budget export: every imported account
named by its mapping source, amounts as magnitudes, and a transfer from an on-budget account to an
off-budget one carrying its budget category on the on-budget leg
"""

import pytest

from tests.routes.support import _create_user, _get_auth_header
from tests.routes.transactions._helpers import _get_system_category_id, _import_journal

_CHECKING = {"source": "Checking", "create": {"name": "Checking", "account_type": "checking", "currency": "CAD"}}
_OLD_SAVINGS = {"source": "Old Savings", "create": {"name": "Old Savings", "account_type": "savings", "currency": "CAD"}}
_CAR_LOAN = {"source": "Car Loan", "create": {"name": "Car Loan", "account_type": "loan", "currency": "CAD"}}
_FOOD = {"source": "Food", "create": {"name": "Food", "kind": "expense"}}
_PAYCHECK = {"source": "Paycheck", "create": {"name": "Paycheck", "kind": "income"}}
_CAR_PAYMENT = {"source": "Car Payment", "create": {"name": "Car Payment", "kind": "transfer"}}


def _actual_row(**overrides):
    """Build an Actual Budget journal row with withdrawal defaults

    Args:
        **overrides: Fields to override in the default payload

    Returns:
        Row payload dictionary for the import request
    """
    row = {
        "journal_id": "a1f0c7e2-0001",
        "type": "withdrawal",
        "dt": "2026-01-10",
        "amount": "45.67",
        "currency_code": "CAD",
        "description": "Weekly groceries",
        "source_account": "Checking",
        "destination_name": "Neighbourhood Grocer",
        "category": "Food",
        "tag_names": [],
    }
    row.update(overrides)
    return row


def _car_payment_row(**overrides):
    """Build the loan payment an Actual Budget export files under a budget category

    Args:
        **overrides: Fields to override in the default payload

    Returns:
        Row payload dictionary for the import request
    """
    return _actual_row(**{
        "journal_id": "a1f0c7e2-0006",
        "type": "transfer",
        "dt": "2026-02-01",
        "amount": "300.00",
        "description": "Car loan payment",
        "destination_account": "Car Loan",
        "destination_name": None,
        "category": "Car Payment",
        "category_leg": "source",
        **overrides,
    })


async def _open_run(client, headers, source="actual_budget", expected_transaction_count=1):
    """Open a run and return its id"""
    resp = await client.post(
        "/transactions/import/runs",
        json={"expected_transaction_count": expected_transaction_count, "source": source},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def test_an_actual_run_commits_a_journal_with_a_categorized_loan_payment_and_its_budget(client):
    """Every row shape an Actual Budget export compiles to lands, with the loan payment counted once."""
    headers = _get_auth_header(await _create_user(client))
    transfer_category_id = await _get_system_category_id(client, headers, "Transfer")

    resp = await _import_journal(client, headers, {
        "accounts": [_CHECKING, _OLD_SAVINGS, _CAR_LOAN],
        "categories": [
            _FOOD,
            _PAYCHECK,
            _CAR_PAYMENT,

            # Actual Budget files a transfer to a deleted account as a payee under this category
            {"source": "Closed account", "category_id": transfer_category_id},
        ],
        "rows": [
            _actual_row(
                journal_id="a1f0c7e2-0001",
                type="opening balance",
                dt="2026-01-01",
                amount="5000.00",
                description="Starting balance",
                source_account=None,
                source_name="Starting Balance",
                destination_account="Checking",
                destination_name=None,
                category=None,
            ),
            _actual_row(
                journal_id="a1f0c7e2-0002",
                type="opening balance",
                dt="2026-01-01",
                amount="10000.00",
                description="Loan principal",
                source_account="Car Loan",
                destination_name=None,
                category=None,
            ),
            _actual_row(
                journal_id="a1f0c7e2-0003",
                type="opening balance",
                dt="2025-12-31",
                amount="100.00",
                description="Old savings balance",
                source_account=None,
                source_name="Starting Balance",
                destination_account="Old Savings",
                destination_name=None,
                category=None,
            ),
            _actual_row(
                journal_id="a1f0c7e2-0004",
                type="transfer",
                dt="2026-01-05",
                amount="100.00",
                description="Close old savings",
                source_account="Old Savings",
                destination_account="Checking",
                destination_name=None,
                category=None,
            ),
            _actual_row(journal_id="a1f0c7e2-0005"),
            _actual_row(
                journal_id="a1f0c7e2-0007",
                type="deposit",
                dt="2026-01-15",
                amount="2000.00",
                description="Salary",
                source_account=None,
                source_name="Employer",
                destination_account="Checking",
                destination_name=None,
                category="Paycheck",
            ),
            _car_payment_row(),
            _actual_row(
                journal_id="a1f0c7e2-0008",
                dt="2026-02-05",
                amount="250.00",
                description="Move to closed brokerage",
                destination_name="Closed Brokerage",
                category="Closed account",
            ),
        ],
    }, budgets={
        "categories": [_CAR_PAYMENT],
        "budgets": [{
            "name": "Car Payment",
            "currency": "CAD",
            "category_sources": ["Car Payment"],

            # March is missing, as it is for a month Actual Budget budgeted nothing in
            "limits": [
                {"start": "2026-01-01", "end": "2026-01-31", "amount": "300.00"},
                {"start": "2026-02-01", "end": "2026-02-28", "amount": "300.00"},
                {"start": "2026-04-01", "end": "2026-04-30", "amount": "300.00"},
            ],
            "recurrence": None,
        }],
    }, source="actual_budget", archive={"account_sources": ["Old Savings"]})

    assert resp.status_code == 201, resp.text
    summary = resp.json()
    assert {key: summary[key] for key in (
        "rows_imported", "transactions_created", "accounts_created", "budgets_created", "accounts_archived",
        "archive_adjustments_created",
    )} == {
        "rows_imported": 8,
        "transactions_created": 10,
        "accounts_created": 3,
        "budgets_created": 1,
        "accounts_archived": 1,

        # The transfer out left the closed account at zero, so archiving it needs no adjustment
        "archive_adjustments_created": 0,
    }
    checking_id = summary["account_source_ids"]["Checking"]
    loan_id = summary["account_source_ids"]["Car Loan"]
    old_savings_id = summary["account_source_ids"]["Old Savings"]
    car_payment_id = summary["category_source_ids"]["Car Payment"]

    checking = (await client.get(f"/accounts/{checking_id}", headers=headers)).json()
    loan = (await client.get(f"/accounts/{loan_id}", headers=headers)).json()
    old_savings = (await client.get(f"/accounts/{old_savings_id}", headers=headers)).json()
    assert checking["current_balance"] == 500000 + 10000 - 4567 + 200000 - 30000 - 25000
    assert loan["current_balance"] == -1000000 + 30000
    assert (old_savings["current_balance"], old_savings["is_archived"]) == (0, True)

    transactions = (await client.get(
        "/transactions",
        params={"account_id": [checking_id, loan_id]},
        headers=headers,
    )).json()
    by_notes_and_account = {(transaction["notes"], transaction["account_id"]): transaction for transaction in transactions}

    # Only the checking leg carries the budget category, so the loan leg cannot cancel it out
    payment = by_notes_and_account[("Car loan payment", checking_id)]
    loan_leg = by_notes_and_account[("Car loan payment", loan_id)]
    assert (payment["amount"], payment["category_id"], payment["counterparty_account_id"], payment["counterparty_account_scope"]) == (
        -30000, car_payment_id, loan_id, "tracked",
    )
    assert (loan_leg["amount"], loan_leg["category_id"], loan_leg["counterparty_account_id"], loan_leg["counterparty_account_scope"]) == (
        30000, transfer_category_id, checking_id, "tracked",
    )

    closed_payment = by_notes_and_account[("Move to closed brokerage", checking_id)]
    assert (
        closed_payment["amount"],
        closed_payment["category_id"],
        closed_payment["counterparty_account_id"],
        closed_payment["counterparty_account_scope"],
    ) == (-25000, transfer_category_id, None, "outside")

    plain_transfer = by_notes_and_account[("Close old savings", checking_id)]
    assert (plain_transfer["amount"], plain_transfer["category_id"], plain_transfer["counterparty_account_id"]) == (
        10000, transfer_category_id, old_savings_id,
    )

    [budget] = (await client.get("/base-budgets", headers=headers)).json()
    assert (budget["name"], budget["category_ids"], budget["recurs"]) == ("Car Payment", [car_payment_id], False)
    utilizations = (await client.get(f"/base-budgets/{budget['id']}/utilizations", headers=headers)).json()
    assert [
        (utilization["period_start"], utilization["period_end"], utilization["overall_limit"], utilization["total_spent"])
        for utilization in utilizations
    ] == [
        ("2026-01-01", "2026-01-31", 30000, 0),
        ("2026-02-01", "2026-02-28", 30000, 30000),
        ("2026-04-01", "2026-04-30", 30000, 0),
    ]
    assert utilizations[1]["categories"] == [{"category_id": car_payment_id, "spent": 30000}]


@pytest.mark.parametrize("overrides", [
    {"type": "withdrawal", "destination_account": None, "destination_name": "Car Dealer"},
    {"category": None},
])
async def test_an_actual_row_naming_a_category_leg_off_a_categorized_transfer_is_refused_by_the_schema(client, overrides):
    """A category leg only means something on a transfer that carries a category."""
    headers = _get_auth_header(await _create_user(client))
    run_id = await _open_run(client, headers)

    resp = await client.post(f"/transactions/import/runs/{run_id}/journal/rows", json={
        "accounts": [_CHECKING, _CAR_LOAN],
        "categories": [_CAR_PAYMENT],
        "rows": [_car_payment_row(**overrides)],
        "start_row_index": 0,
    }, headers=headers)

    # Request validation answers with a list of field errors, where a refusal later on names a reason
    assert resp.status_code == 422
    assert isinstance(resp.json()["detail"], list)


@pytest.mark.parametrize(("mapping", "mapped_name"), [
    (_FOOD | {"source": "Car Payment"}, "Food"),
    (None, "Balance Adjustment"),
])
async def test_an_actual_categorized_transfer_needs_a_category_that_records_the_other_account(client, mapping, mapped_name):
    """The categorized leg keeps its counterparty, so a category that cannot record one is refused."""
    headers = _get_auth_header(await _create_user(client))
    if mapping is None:
        mapping = {"source": "Car Payment", "category_id": await _get_system_category_id(client, headers, mapped_name)}

    resp = await _import_journal(client, headers, {
        "accounts": [_CHECKING, _CAR_LOAN],
        "categories": [mapping],
        "rows": [_car_payment_row()],
    }, source="actual_budget")

    assert resp.status_code == 422
    assert resp.json()["detail"] == (
        "Actual Budget transaction a1f0c7e2-0006: The source leg of a transfer needs a transfer category that "
        f"records the other account, and category source Car Payment maps to {mapped_name}"
    )


async def test_an_actual_categorized_transfer_can_name_its_destination_leg(client):
    """The destination leg takes the category when the row names it, and the source keeps Transfer."""
    headers = _get_auth_header(await _create_user(client))
    transfer_category_id = await _get_system_category_id(client, headers, "Transfer")

    resp = await _import_journal(client, headers, {
        "accounts": [_CHECKING, _CAR_LOAN],
        "categories": [_CAR_PAYMENT],
        "rows": [_car_payment_row(category_leg="destination")],
    }, source="actual_budget")

    assert resp.status_code == 201, resp.text
    summary = resp.json()
    categories_by_account = {
        transaction["account_id"]: transaction["category_id"]
        for transaction in (await client.get("/transactions", headers=headers)).json()
    }
    assert categories_by_account == {
        summary["account_source_ids"]["Checking"]: transfer_category_id,
        summary["account_source_ids"]["Car Loan"]: summary["category_source_ids"]["Car Payment"],
    }


@pytest.mark.parametrize(("source", "method", "path", "body", "detail"), [
    (
        "generic",
        "post",
        "journal/rows",
        {"accounts": [_CHECKING], "categories": [_FOOD], "rows": [_actual_row()], "start_row_index": 0},
        "This import run is a CSV import",
    ),
    ("generic", "post", "journal/commit", None, "This import run is a CSV import"),
    (
        "actual_budget",
        "post",
        "rows",
        {
            "accounts": [_CHECKING],
            "categories": [_FOOD],
            "rows": [{"account_source": "Checking", "category_source": "Food", "dt": "2026-01-10", "amount": "-1.00"}],
            "start_row_index": 0,
        },
        "This import run is an Actual Budget import",
    ),
    ("actual_budget", "post", "commit", None, "This import run is an Actual Budget import"),
])
async def test_journal_and_generic_endpoints_refuse_each_other_s_runs(client, source, method, path, body, detail):
    """An Actual Budget run takes journal rows, and a generic run is refused on the journal endpoints."""
    headers = _get_auth_header(await _create_user(client))
    run_id = await _open_run(client, headers, source=source)

    resp = await client.request(method, f"/transactions/import/runs/{run_id}/{path}", json=body, headers=headers)
    assert (resp.status_code, resp.json()["detail"]) == (422, detail)
