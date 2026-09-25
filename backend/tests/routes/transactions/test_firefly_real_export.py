"""Replaying a real Firefly III export's upload against what Firefly III reported for it

The upload is what the import screen sent, as the Firefly III import check (e2e/firefly-check)
captured it. How to refresh it is written at the top of the frontend test that reads the same
run's export, frontend/tests/pages/imports/firefly/utils/realExport.test.ts

The fixture's ids were replaced by category names when it was captured, since they belonged to the
user that run signed up, so this test maps them back to its own user's categories
"""

import json
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

from app.models.currency import Currency
from tests.conftest import TestSession
from tests.routes.support import _create_user, _get_auth_header

FIXTURE = json.loads(
    (Path(__file__).resolve().parents[2] / "fixtures" / "firefly" / "real-export-upload.json").read_text(),
)

# The currencies the seeded Firefly III keeps its accounts in, and the decimal places each holds
CURRENCY_EXPONENTS = {"EUR": 2, "USD": 2, "JPY": 0}

# What rows with no Firefly III category are filed under, standing for the manifest's empty category
NO_CATEGORY_SOURCE = "(no category)"


async def _seed_currencies():
    """Insert the currencies the fixture's accounts and budgets use"""
    async with TestSession() as session:
        session.add_all([
            Currency(id=code, name=code, symbol=code, minor_unit_exponent=exponent)
            for code, exponent in CURRENCY_EXPONENTS.items()
        ])
        await session.commit()


async def _get_category_ids_by_name(client, headers):
    """Return the user's category ids by name"""
    resp = await client.get("/categories", headers=headers)
    return {category["name"]: category["id"] for category in resp.json()}


def _format_minor_units(minor_units, currency):
    """Write minor units the way the manifest writes amounts"""
    exponent = CURRENCY_EXPONENTS[currency]
    return f"{Decimal(minor_units).scaleb(-exponent):.{exponent}f}"


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


async def test_a_real_firefly_export_imports_to_the_balances_and_totals_firefly_reports(client):
    """Every account balance, every category's monthly total and every budget's periods match Firefly III."""
    await _seed_currencies()
    headers = _get_auth_header(await _create_user(client))
    category_ids = await _get_category_ids_by_name(client, headers)

    # What each Firefly III category became in Lumina, an existing category or one the import creates
    lumina_category_by_source = {}
    for batch in FIXTURE["transactions"]:
        categories = []
        for mapping in batch["categories"]:
            if "category_name" in mapping:
                lumina_category_by_source[mapping["source"]] = mapping["category_name"]
                categories.append({"source": mapping["source"], "category_id": category_ids[mapping["category_name"]]})
            else:
                lumina_category_by_source[mapping["source"]] = mapping["create"]["name"]
                categories.append(mapping)

        resp = await client.post("/transactions/import/firefly", json={**batch, "categories": categories}, headers=headers)
        assert resp.status_code == 201, resp.text
        assert resp.json()["skipped"] == []

    # Budgets name categories the transactions import may have just created
    category_ids = await _get_category_ids_by_name(client, headers)
    budgets = [
        {key: value for key, value in budget.items() if key != "category_names"}
        | {"category_ids": [category_ids[name] for name in budget["category_names"]]}
        for budget in FIXTURE["budgets"]
    ]
    resp = await client.post("/transactions/import/firefly/budgets", json={"budgets": budgets}, headers=headers)
    assert resp.status_code == 201, resp.text

    expected = FIXTURE["expected"]
    accounts = (await client.get("/accounts", headers=headers)).json()
    assert {account["name"]: _format_minor_units(account["current_balance"], account["currency"]) for account in accounts} == {
        account["name"]: account["balance"] for account in expected["accounts"]
    }

    # Only rows with a payee of their own carry the category Firefly III gave them. Transfer legs
    # and balance rows take a system category
    currency_by_account_id = {account["id"]: account["currency"] for account in accounts}
    category_names = {category_id: name for name, category_id in category_ids.items()}
    totals = defaultdict(int)
    for transaction in await _list_transactions(client, headers):
        category = category_names[transaction["category_id"]]
        if transaction["counterparty_account_id"] or category == "Balance Adjustment":
            continue
        currency = currency_by_account_id[transaction["account_id"]]
        amount = transaction["amount"] if transaction["account_amount"] is None else transaction["account_amount"]
        totals[(category, transaction["dt"][:7], currency)] += amount
    assert {key: _format_minor_units(total, key[2]) for key, total in totals.items()} == {
        (lumina_category_by_source[month["category"] or NO_CATEGORY_SOURCE], month["month"], month["currency"]): month["total"]
        for month in expected["categoryMonths"]
    }

    # The limits Firefly III writes with twelve decimal places land as the same amounts
    base_budgets = (await client.get("/base-budgets", headers=headers)).json()
    currency_by_budget_id = {budget["id"]: budget["currency"] for budget in base_budgets}
    periods = defaultdict(list)
    for period in (await client.get("/budgets", headers=headers)).json():
        currency = currency_by_budget_id[period["base_budget_id"]]
        periods[period["base_budget_id"]].append(
            (period["period_start"], period["period_end"], _format_minor_units(period["overall_limit"], currency), currency),
        )
    assert {
        budget["name"]: {
            "archived": budget["is_archived"],
            "categories": sorted(category_names[category_id] for category_id in budget["category_ids"]),
            "periods": sorted(periods[budget["id"]]),
        }
        for budget in base_budgets
    } == {
        budget["name"]: {
            "archived": not budget["active"],
            "categories": sorted(lumina_category_by_source[category] for category in budget["categories"]),
            "periods": sorted((limit["start"], limit["end"], limit["amount"], limit["currency"]) for limit in budget["limits"]),
        }
        for budget in expected["budgets"]
    }
