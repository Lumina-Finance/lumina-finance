"""What budget utilization does when the installed check refuses converting between currencies

One case of the table the dashboard net worth tests hold in full, for a personal budget and for a group's
"""

from datetime import date
from decimal import Decimal

import pytest

from app.allowance_hook import AllowanceKind
from tests.routes.budgets._utilization_helpers import (
    _create_base_with_instance,
    _create_category,
    _create_group,
    _create_transaction,
    _get_budget_utilization_entry,
    _seed_usd_currency,
)
from tests.routes.support import _create_account, _create_user, _get_auth_header
from tests.routes.support.allowance_helpers import ALLOWANCE_REASON, install_check


@pytest.mark.parametrize(
    ("in_group", "total_spent", "fx_status"),
    [
        pytest.param(
            False, 5000, {"state": "none", "missing_pairs": [], "withheld_reason": ALLOWANCE_REASON}, id="personal-budget-leaves-out-us-dollars"
        ),
        pytest.param(True, 9500, {"state": "complete", "missing_pairs": [], "withheld_reason": None}, id="group-budget-converts"),
    ],
)
async def test_budget_utilization_leaves_out_spending_in_another_currency_the_check_refuses_converting(
    client, monkeypatch, in_group, total_spent, fx_status
):
    """Spending of 50.00 Canadian and 30.00 US dollars at 1.5 counts the Canadian alone for a personal budget, and both for a group's"""
    from app.services.fx import FrankfurterProvider

    async def fake_get_rates(self, base, quote, start_date, end_date):
        return {date(2026, 3, 15): Decimal("1.5")}

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    headers = _get_auth_header(await _create_user(client))
    await _seed_usd_currency()
    group_id = await _create_group(client, headers) if in_group else None
    scope = {"group_id": group_id} if in_group else {}
    cad_account_id = (await _create_account(client, headers, name="CAD Chequing", **scope)).json()["id"]
    usd_account_id = (await _create_account(client, headers, name="USD Chequing", currency="USD", **scope)).json()["id"]
    groceries = await _create_category(client, headers, name="Test Groceries", **scope)
    base_id, budget_id = await _create_base_with_instance(client, headers, category_ids=[groceries], base_overrides=scope)
    await _create_transaction(client, headers, cad_account_id, groceries, amount=-5000)
    await _create_transaction(client, headers, usd_account_id, groceries, amount=-3000, currency="USD")
    install_check(refused={AllowanceKind.FOREIGN_CURRENCIES})

    data = await _get_budget_utilization_entry(client, headers, base_id, budget_id)

    assert data["total_spent"] == total_spent
    assert data["fx_status"] == fx_status
