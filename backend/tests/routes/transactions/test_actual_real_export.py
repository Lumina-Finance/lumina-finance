"""Replaying a real Actual Budget export's upload against what Actual Budget reported for it

The upload is what the import screen builds for the envelope export a local Actual server wrote,
recorded by frontend/tests/pages/imports/actual/utils/replay.test.ts, which also says how to
refresh it. Every account and category in it is created, so it names no ids of its own
"""

import json
from collections import defaultdict
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo

from tests.routes.support import _create_user, _get_auth_header
from tests.routes.support.auth_helpers import SIGNUP_PAYLOAD

FIXTURE = json.loads(
    (Path(__file__).resolve().parents[2] / "fixtures" / "actual" / "envelope-upload.json").read_text(),
)


def _format_cents(minor_units):
    """Write CAD minor units the way the manifest writes amounts"""
    return f"{Decimal(minor_units).scaleb(-2):.2f}"


async def _list_transactions(client, headers):
    """Read every transaction the user has, a page at a time"""
    transactions = []
    while True:
        resp = await client.get(
            "/transactions",
            params={"sort_by": "dt", "sort_order": "asc", "limit": 50, "offset": len(transactions)},
            headers=headers,
        )
        page = resp.json()
        transactions.extend(page)
        if len(page) < 50:
            return transactions


async def test_a_real_actual_export_imports_to_the_balances_totals_and_budgets_actual_reports(client):
    """Every account's balance, every category's monthly total and every budget's months match Actual Budget."""
    headers = _get_auth_header(await _create_user(client))

    resp = await client.post("/transactions/import/runs", json={
        "expected_transaction_count": sum(len(batch["rows"]) for batch in FIXTURE["transactions"]),
        "source": "actual_budget",
    }, headers=headers)
    assert resp.status_code == 201, resp.text
    run_path = f"/transactions/import/runs/{resp.json()['id']}"

    for batch in FIXTURE["transactions"]:
        resp = await client.post(f"{run_path}/journal/rows", json=batch, headers=headers)
        assert resp.status_code == 204, resp.text
    resp = await client.put(f"{run_path}/budgets", json=FIXTURE["budgets"], headers=headers)
    assert resp.status_code == 204, resp.text
    resp = await client.put(f"{run_path}/archive", json={"account_sources": FIXTURE["archive"]}, headers=headers)
    assert resp.status_code == 204, resp.text
    resp = await client.post(f"{run_path}/journal/commit", headers=headers)
    assert resp.status_code == 201, resp.text

    expected = FIXTURE["expected"]
    as_of = expected["asOf"]
    transactions = await _list_transactions(client, headers)
    accounts = (await client.get("/accounts", headers=headers)).json()
    account_name_by_id = {account["id"]: account["name"] for account in accounts}

    # A balance counts rows up to the user's today, which moves on from the export date as time
    # passes, so rows dated after the export date that have since come due are added to Actual's figure
    today = datetime.now(ZoneInfo(SIGNUP_PAYLOAD["tz"])).date().isoformat()
    come_due = defaultdict(int)
    for transaction in transactions:
        if as_of < transaction["dt"][:10] <= today:
            come_due[account_name_by_id[transaction["account_id"]]] += transaction["amount"]
    assert sorted(
        (account["name"], _format_cents(account["current_balance"]), account["is_archived"]) for account in accounts
    ) == sorted(
        (account["name"], _format_cents(Decimal(account["balance"]).scaleb(2) + come_due[account["name"]]), account["closed"])
        for account in expected["accounts"]
    )

    # Actual counts a category's rows in the accounts on its budget only, while a Lumina budget counts
    # its category in every account, so each category's total across all accounts has to match.
    # What each category source became is read off the created names
    categories = {category["id"]: category["name"] for category in (await client.get("/categories", headers=headers)).json()}
    created_name_by_source = {
        mapping["source"]: mapping["create"]["name"]
        for batch in FIXTURE["transactions"]
        for mapping in batch["categories"]
    }

    # Rows dated after the export date are imported with their account and category like any other
    later = [
        (
            account_name_by_id[transaction["account_id"]],
            transaction["dt"][:10],
            _format_cents(transaction["amount"]),
            categories[transaction["category_id"]],
        )
        for transaction in transactions
        if transaction["dt"][:10] > as_of
    ]
    assert len(later) == len(expected["afterAsOf"])
    for row in expected["afterAsOf"]:
        # A row with no category is matched on its account, date and amount alone
        names = {created_name_by_source[source] for source in row["sources"]}
        key = (row["account"], row["date"], row["amount"])
        match = next((entry for entry in later if entry[:3] == key and (not names or entry[3] in names)), None)
        assert match, row
        later.remove(match)

    totals = defaultdict(int)
    for transaction in transactions:
        if transaction["dt"][:10] <= as_of:
            totals[(categories[transaction["category_id"]], transaction["dt"][:7])] += transaction["amount"]

    for month in expected["categoryMonths"]:
        names = {created_name_by_source[source] for source in month["sources"] if source in created_name_by_source}
        total = sum(totals[(name, month["month"])] for name in names)
        assert _format_cents(total) == month["total"], (sorted(names), month["month"])

    # A recurring budget can open a period for a month after the export, so only the imported months compare
    base_budgets = (await client.get("/base-budgets", headers=headers)).json()
    last_month = {budget["name"]: max(month["month"] for month in budget["months"]) for budget in expected["budgets"]}
    name_by_budget_id = {budget["id"]: budget["name"] for budget in base_budgets}
    periods = defaultdict(list)
    for period in (await client.get("/budgets", headers=headers)).json():
        month = period["period_start"][:7]
        if month <= last_month.get(name_by_budget_id[period["base_budget_id"]], month):
            periods[period["base_budget_id"]].append((month, _format_cents(period["overall_limit"])))
    assert {
        budget["name"]: {"archived": budget["is_archived"], "periods": sorted(periods[budget["id"]])}
        for budget in base_budgets
    } == {
        budget["name"]: {
            "archived": budget["hidden"],
            "periods": sorted((month["month"], month["budgeted"]) for month in budget["months"]),
        }
        for budget in expected["budgets"]
    }
