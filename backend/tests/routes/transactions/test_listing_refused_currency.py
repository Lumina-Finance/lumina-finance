"""What the transaction list does when the installed check refuses converting between currencies

A row whose amount in the user's main currency is left out carries the check's sentence, so the list can
say why, and a row on a group's account converts as it always did
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


async def test_list_transactions_gives_the_reason_for_an_amount_left_unconverted_by_a_refused_conversion(client, monkeypatch):
    """A 10.00 US dollar row on a personal account has no Canadian amount and says why, while one on a group's account converts at 1.5"""
    from app.services.fx import FrankfurterProvider

    async def fake_get_rates(self, base, quote, start_date, end_date):
        return {date(2026, 3, 15): Decimal("1.5")}

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    await _seed_usd_currency()
    headers, cad_account_id, category_id = await _setup_user_with_deps(client)
    usd_account_id = (await _create_account(client, headers, name="USD Chequing", currency="USD")).json()["id"]
    group = await client.post("/groups", json={"name": "Household"}, headers=headers)
    group_account_id = (await _create_account(client, headers, name="USD Joint", currency="USD", group_id=group.json()["id"])).json()["id"]
    for account_id, currency in ((cad_account_id, "CAD"), (usd_account_id, "USD"), (group_account_id, "USD")):
        await _create_transaction(client, headers, account_id, category_id, amount=-10_00, currency=currency, dt="2026-03-15")
    install_check(refused={AllowanceKind.FOREIGN_CURRENCIES})

    response = await client.get("/transactions", headers=headers)

    assert response.status_code == 200, response.text
    rows = {row["account_id"]: row for row in response.json()}
    assert {account_id: (row["base_currency_amount"], row["withheld_reason"]) for account_id, row in rows.items()} == {
        cad_account_id: (-10_00, None),
        usd_account_id: (None, ALLOWANCE_REASON),
        group_account_id: (-15_00, None),
    }
