"""What the transactions overview does when the installed check refuses converting between currencies

One case of the table the dashboard net worth tests hold in full, covering every panel of the overview
"""

from datetime import date
from decimal import Decimal

from app.allowance_hook import AllowanceKind
from tests.routes.support.allowance_helpers import ALLOWANCE_REASON, install_check
from tests.routes.transactions._helpers import (
    _create_account,
    _create_transaction,
    _seed_usd_currency,
    _setup_user_with_deps,
)

# The group's US dollars converted, so the conversions that did happen are complete beside the reason
_WITHHELD = {"state": "complete", "missing_pairs": [], "withheld_reason": ALLOWANCE_REASON}


async def test_transactions_overview_leaves_out_accounts_in_another_currency_the_check_refuses_converting(client, monkeypatch):
    """Spending of 50.00 Canadian, 30.00 US personal and 20.00 US in a group at 1.5 counts the personal US dollars out of every panel"""
    from app.services.fx import FrankfurterProvider

    async def fake_get_rates(self, base, quote, start_date, end_date):
        return {date(2026, 3, 14): Decimal("1.5"), date(2026, 3, 15): Decimal("1.5")}

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    await _seed_usd_currency()
    headers, cad_account_id, category_id = await _setup_user_with_deps(client)
    usd_account_id = (await _create_account(client, headers, name="USD Chequing", currency="USD")).json()["id"]
    group = await client.post("/groups", json={"name": "Household"}, headers=headers)
    group_account_id = (await _create_account(client, headers, name="USD Joint", currency="USD", group_id=group.json()["id"])).json()["id"]
    await _create_transaction(client, headers, cad_account_id, category_id, amount=-5_000, dt="2026-03-14")
    await _create_transaction(client, headers, usd_account_id, category_id, amount=-3_000, currency="USD", dt="2026-03-14")
    await _create_transaction(client, headers, group_account_id, category_id, amount=-2_000, currency="USD", dt="2026-03-15")
    install_check(refused={AllowanceKind.FOREIGN_CURRENCIES})

    response = await client.get("/transactions/overview", headers=headers)

    assert response.status_code == 200, response.text
    data = response.json()
    assert (data["total_inflow"], data["total_outflow"]) == (0, -8_000)
    assert [(row["category_id"], row["total"]) for row in data["top_categories"]] == [(category_id, -8_000)]
    assert [row["amount"] for row in data["outliers"]] == [-5_000, -2_000]
    for field in ("net_flow_fx_status", "top_categories_fx_status", "daily_cash_flow_fx_status", "outliers_fx_status"):
        assert data[field] == _WITHHELD, field
