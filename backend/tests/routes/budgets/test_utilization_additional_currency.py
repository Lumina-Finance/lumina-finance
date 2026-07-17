"""Route tests for budget utilization endpoints."""
from datetime import date
from decimal import Decimal

from app.models.currency import Currency
from tests.conftest import TestSession
from tests.routes.budgets._utilization_helpers import (
    _create_base_with_instance,
    _create_category,
    _create_group,
    _create_transaction,
    _get_budget_utilization_entry,
    _seed_usd_currency,
)
from tests.routes.support import _create_account, _create_user, _get_auth_header

# --- GET /base-budgets/{id}/utilizations — more scope and currency coverage ---


async def test_get_budget_utilization_personal_budget_excludes_single_member_group_account(client):
    """A personal budget excludes spending on a group account the user solely owns.

    Even when the user is the only admin of their own single-member group, the
    group account's transactions must stay out of a personal base budget. Pins
    the personal scope filter `Account.owner_id = base_budget.owner_id` — the
    group account has `owner_id IS NULL`, so it cannot match.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    personal_account_id = (await _create_account(client, headers)).json()["id"]
    group_id = await _create_group(client, headers)
    group_account_id = (
        await _create_account(client, headers, name="Joint", group_id=group_id)
    ).json()["id"]

    groceries = await _create_category(client, headers, name="Test Groceries")

    base_id, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries],
    )

    await _create_transaction(client, headers, personal_account_id, groceries, amount=-5000)
    await _create_transaction(client, headers, group_account_id, groceries, amount=-3000)

    data = await _get_budget_utilization_entry(client, headers, base_id, budget_id)
    # Only the 5000 from the personal account — the 3000 on the group account is excluded
    assert data["total_spent"] == 5000
    assert data["categories"][0]["spent"] == 5000


async def test_get_budget_utilization_personal_budget_aggregates_multiple_personal_accounts_excludes_group(client):
    """A personal budget sums across all personal accounts in the currency but excludes a group account.

    Strengthens the single-account scope test: with two personal CAD accounts
    and one group CAD account all tracking the same category, the response
    must sum the two personal-account spends and exclude the group-account
    spend entirely. A regression that keyed the filter off a single account
    (rather than `owner_id == base_budget.owner_id`) would fail this.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    chequing_id = (await _create_account(client, headers, name="Chequing")).json()["id"]
    savings_id = (
        await _create_account(client, headers, name="Savings", account_type="savings")
    ).json()["id"]
    group_id = await _create_group(client, headers)
    group_account_id = (
        await _create_account(client, headers, name="Joint", group_id=group_id)
    ).json()["id"]

    groceries = await _create_category(client, headers, name="Test Groceries")

    base_id, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries],
    )

    await _create_transaction(client, headers, chequing_id, groceries, amount=-3000)
    await _create_transaction(
        client, headers, savings_id, groceries,
        dt="2026-03-20", amount=-2500,
    )
    # Group-account spend must not leak in
    await _create_transaction(
        client, headers, group_account_id, groceries,
        dt="2026-03-22", amount=-9999,
    )

    data = await _get_budget_utilization_entry(client, headers, base_id, budget_id)
    assert data["total_spent"] == 5500
    assert len(data["categories"]) == 1
    assert data["categories"][0]["spent"] == 5500


async def test_get_budget_utilization_three_currency_user_converts_all_account_currencies(client, monkeypatch):
    """A USD budget converts CAD and EUR account spend before summing."""
    from app.services.fx import FrankfurterProvider

    async def fake_get_rates(self, base, quote, start_date, end_date):
        if base == "CAD":
            return {date(2026, 3, 15): Decimal("0.75")}
        return {date(2026, 3, 20): Decimal("1.1")}

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    await _seed_usd_currency()
    async with TestSession() as session:
        session.add(Currency(id="EUR", name="Euro", symbol="€", minor_unit_exponent=2))
        await session.commit()

    cad_account_id = (await _create_account(client, headers)).json()["id"]
    usd_account_id = (
        await _create_account(client, headers, name="USD Chequing", currency="USD")
    ).json()["id"]
    eur_account_id = (
        await _create_account(client, headers, name="EUR Chequing", currency="EUR")
    ).json()["id"]
    groceries = await _create_category(client, headers, name="Test Groceries")

    base_id, usd_budget_id = await _create_base_with_instance(
        client, headers,
        category_ids=[groceries],
        base_overrides={"name": "USD Budget", "currency": "USD"},
    )

    await _create_transaction(client, headers, cad_account_id, groceries, amount=-4000)
    await _create_transaction(
        client, headers, usd_account_id, groceries,
        amount=-7000, currency="USD",
    )
    await _create_transaction(
        client, headers, eur_account_id, groceries,
        dt="2026-03-20", amount=-3500, currency="EUR",
    )

    data = await _get_budget_utilization_entry(client, headers, base_id, usd_budget_id)
    # 4000 CAD -> 3000 USD, 3500 EUR -> 3850 USD, plus 7000 USD.
    assert data["total_spent"] == 13850
    assert data["categories"][0]["spent"] == 13850
    assert data["fx_status"] == {"state": "complete", "missing_pairs": []}
