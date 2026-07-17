"""Route tests for budget utilization endpoints."""
import uuid
from datetime import date
from decimal import Decimal

from app.models.currency import Currency
from app.models.transaction import Transaction
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

# --- GET /base-budgets/{id}/utilizations — currency and scope filtering ---


async def test_get_budget_utilization_converts_foreign_account_transactions(client, monkeypatch):
    """A CAD budget converts tracked USD-account spending into CAD."""
    from app.services.fx import FrankfurterProvider

    async def fake_get_rates(self, base, quote, start_date, end_date):
        return {date(2026, 3, 15): Decimal("1.5")}

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    await _seed_usd_currency()

    cad_account_id = (await _create_account(client, headers)).json()["id"]
    usd_account_id = (
        await _create_account(client, headers, name="USD Chequing", currency="USD")
    ).json()["id"]
    groceries = await _create_category(client, headers, name="Test Groceries")

    base_id, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries],
    )

    # Same tracked category, two account currencies — the USD row is converted
    # before being added to the CAD budget's utilization.
    await _create_transaction(client, headers, cad_account_id, groceries, amount=-5000)
    await _create_transaction(client, headers, usd_account_id, groceries, amount=-3000, currency="USD")

    data = await _get_budget_utilization_entry(client, headers, base_id, budget_id)
    assert data["total_spent"] == 9500
    assert data["fx_status"] == {"state": "complete", "missing_pairs": []}
    by_id = {c["category_id"]: c["spent"] for c in data["categories"]}
    assert by_id[groceries] == 9500


async def test_get_budget_utilization_reports_incomplete_fx(client, monkeypatch):
    """Budget utilization skips unconverted foreign rows and reports missing pairs."""
    from app.services.fx import FrankfurterProvider, FxRateNotFoundError

    async def fake_get_rates(self, base, quote, start_date, end_date):
        if base == "USD":
            return {date(2026, 3, 15): Decimal("1.5")}
        raise FxRateNotFoundError()

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    async with TestSession() as session:
        session.add_all([
            Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2),
            Currency(id="ABC", name="Unsupported Test Currency", symbol="A", minor_unit_exponent=2),
        ])
        await session.commit()

    usd_account_id = (
        await _create_account(client, headers, name="USD Chequing", currency="USD")
    ).json()["id"]
    abc_account_id = (
        await _create_account(client, headers, name="ABC Chequing", currency="ABC")
    ).json()["id"]
    groceries = await _create_category(client, headers, name="Test Groceries")

    base_id, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries],
    )

    await _create_transaction(client, headers, usd_account_id, groceries, amount=-3000, currency="USD")
    await _create_transaction(client, headers, abc_account_id, groceries, amount=-9000, currency="ABC")

    data = await _get_budget_utilization_entry(client, headers, base_id, budget_id)
    assert data["total_spent"] == 4500
    assert data["categories"][0]["spent"] == 4500
    assert data["fx_status"] == {
        "state": "incomplete",
        "missing_pairs": [{"base": "ABC", "quote": "CAD"}],
    }


async def test_get_budget_utilization_personal_budget_excludes_group_account_transactions(client):
    """A personal budget must not pick up transactions made on a group account.

    The transaction route allows a user's personal category to be used on a group
    account (an `OR` branch in `_check_category_access_or_422`), so without a
    scope filter a personal budget tracking that category would include group
    spending. The utilization query constrains accounts to those owned by the
    base budget's owner, blocking the leak.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    personal_account_id = (await _create_account(client, headers)).json()["id"]
    group_id = await _create_group(client, headers)
    group_account_id = (
        await _create_account(client, headers, name="Joint Chequing", group_id=group_id)
    ).json()["id"]

    # Personal category, used on both the personal account and the group account
    groceries = await _create_category(client, headers, name="Test Groceries")

    base_id, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries],
    )

    await _create_transaction(client, headers, personal_account_id, groceries, amount=-5000)
    await _create_transaction(client, headers, group_account_id, groceries, amount=-3000)

    data = await _get_budget_utilization_entry(client, headers, base_id, budget_id)
    assert data["total_spent"] == 5000
    by_id = {c["category_id"]: c["spent"] for c in data["categories"]}
    assert by_id[groceries] == 5000


async def test_get_budget_utilization_group_budget_excludes_personal_account_transactions(client):
    """The utilization query keeps personal-account spend out of a group budget even if upstream validators are bypassed.

    Two checks normally make this impossible to construct via the public API:
    `_validate_category_ids` rejects personal categories on group base budgets, and
    `_check_category_access_or_422` rejects group categories on personal-account
    txns. If either ever loosens — say, a future bulk-import endpoint skips the
    validators — the `Account.group_id == base_budget.group_id` filter on the
    utilization query is the backstop. This test bypasses both validators by
    inserting the row directly via TestSession and asserts the query still
    filters it out.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = uuid.UUID(signup_resp.json()["user"]["id"])

    group_id = await _create_group(client, headers)
    group_account_id = uuid.UUID(
        (await _create_account(client, headers, name="Joint", group_id=group_id)).json()["id"],
    )
    personal_account_id = uuid.UUID(
        (await _create_account(client, headers, name="Personal Chequing")).json()["id"],
    )
    group_groceries = uuid.UUID(
        await _create_category(client, headers, name="Test Groceries", group_id=group_id),
    )

    base_id, budget_id = await _create_base_with_instance(
        client, headers,
        category_ids=[str(group_groceries)],
        base_overrides={"group_id": group_id},
    )

    # Legitimate group account txn — should be counted
    await _create_transaction(
        client, headers, str(group_account_id), str(group_groceries), amount=-3000,
    )

    # Direct DB insert: personal-account txn referencing the group category.
    # Bypasses _check_category_access_or_422 which would normally block it.
    async with TestSession() as session:
        session.add(Transaction(
            created_by_user_id=user_id,
            account_id=personal_account_id,
            category_id=group_groceries,
            dt=date(2026, 3, 15),
            amount=-9999,
            currency="CAD",
        ))
        await session.commit()

    data = await _get_budget_utilization_entry(client, headers, base_id, budget_id)
    # 3000 from the group account, NOT 12999 — the personal-account row is filtered out
    assert data["total_spent"] == 3000
    assert data["categories"][0]["spent"] == 3000


async def test_get_budget_utilization_non_base_currency_converts_other_currencies(client, monkeypatch):
    """A USD budget converts CAD-account spending into USD."""
    from app.services.fx import FrankfurterProvider

    async def fake_get_rates(self, base, quote, start_date, end_date):
        return {date(2026, 3, 15): Decimal("0.75")}

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    await _seed_usd_currency()

    cad_account_id = (await _create_account(client, headers)).json()["id"]
    usd_account_id = (
        await _create_account(client, headers, name="USD Chequing", currency="USD")
    ).json()["id"]
    groceries = await _create_category(client, headers, name="Test Groceries")

    base_id, usd_budget_id = await _create_base_with_instance(
        client, headers,
        category_ids=[groceries],
        base_overrides={"name": "USD Groceries", "currency": "USD"},
    )

    # 4000 CAD converts to 3000 USD, then adds to 7000 USD same-currency spend.
    await _create_transaction(client, headers, cad_account_id, groceries, amount=-4000)
    await _create_transaction(client, headers, usd_account_id, groceries, amount=-7000, currency="USD")

    data = await _get_budget_utilization_entry(client, headers, base_id, usd_budget_id)
    assert data["total_spent"] == 10000
    assert data["categories"][0]["spent"] == 10000
    assert data["fx_status"] == {"state": "complete", "missing_pairs": []}


async def test_get_budget_utilization_converts_when_no_account_matches_budget_currency(client, monkeypatch):
    """A USD budget can still count CAD-account spending through FX conversion."""
    from app.services.fx import FrankfurterProvider

    async def fake_get_rates(self, base, quote, start_date, end_date):
        return {date(2026, 3, 15): Decimal("0.75")}

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    await _seed_usd_currency()

    # Only a CAD account exists, but the budget is in USD
    cad_account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers, name="Test Groceries")

    base_id, budget_id = await _create_base_with_instance(
        client, headers,
        category_ids=[groceries],
        base_overrides={"name": "USD Vacation", "currency": "USD"},
    )

    # CAD spending exists and is converted into the USD budget currency.
    await _create_transaction(client, headers, cad_account_id, groceries, amount=-5000)

    data = await _get_budget_utilization_entry(client, headers, base_id, budget_id)
    assert data["total_spent"] == 3750
    assert data["categories"][0]["category_id"] == groceries
    assert data["categories"][0]["spent"] == 3750
    assert data["fx_status"] == {"state": "complete", "missing_pairs": []}
