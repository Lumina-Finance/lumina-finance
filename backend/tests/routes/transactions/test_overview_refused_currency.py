"""What the transactions overview does when the installed check refuses converting between currencies

One case of the table the dashboard net worth tests hold in full, covering every panel of the overview
"""

import uuid
from datetime import date
from decimal import Decimal

from app.allowance_hook import AllowanceKind
from app.models.transaction import Transaction
from tests.conftest import TestSession
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


def _row_id(number: int) -> uuid.UUID:
    """Return an identifier that sorts by its number"""
    return uuid.UUID(f"00000000-0000-0000-0000-{number:012d}")


async def test_transactions_overview_ranks_outliers_among_the_group_rows_alone_when_personal_rows_are_left_out(client, monkeypatch):
    """Eight US dollar rows on one date with a personal 9 cent row above them rank among the group's four, ties included

    At 0.4 a 3 or 2 cent amount converts to 1 Canadian cent, so the group's rows all tie at the panel's last place
    and the lowest identifiers win. The personal rows, left out, neither take a place in the per-date ranking nor
    fill the places read for ties
    """
    from app.services.fx import FrankfurterProvider

    async def fake_get_rates(self, base, quote, start_date, end_date):
        return {date(2026, 3, 15): Decimal("0.4")}

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    await _seed_usd_currency()
    headers, _cad_account_id, category_id = await _setup_user_with_deps(client)
    user_id = uuid.UUID((await client.get("/me", headers=headers)).json()["id"])
    personal_id = (await _create_account(client, headers, name="USD Chequing", currency="USD")).json()["id"]
    group = await client.post("/groups", json={"name": "Household"}, headers=headers)
    joint_id = (await _create_account(client, headers, name="USD Joint", currency="USD", group_id=group.json()["id"])).json()["id"]
    personal_rows = {_row_id(1): -9, _row_id(2): -2, _row_id(3): -2, _row_id(4): -2}
    group_rows = {_row_id(10): -2, _row_id(11): -3, _row_id(12): -3, _row_id(13): -3}
    async with TestSession() as session:
        session.add_all(
            Transaction(
                id=transaction_id,
                created_by_user_id=user_id,
                account_id=uuid.UUID(account_id),
                category_id=uuid.UUID(category_id),
                dt=date(2026, 3, 15),
                amount=amount,
                currency="USD",
            )
            for account_id, rows in ((personal_id, personal_rows), (joint_id, group_rows))
            for transaction_id, amount in rows.items()
        )
        await session.commit()
    install_check(refused={AllowanceKind.FOREIGN_CURRENCIES})

    response = await client.get("/transactions/overview", headers=headers)

    assert response.status_code == 200, response.text
    assert [(row["id"], row["amount"]) for row in response.json()["outliers"]] == [
        (str(_row_id(10)), -2),
        (str(_row_id(11)), -3),
        (str(_row_id(12)), -3),
    ]
