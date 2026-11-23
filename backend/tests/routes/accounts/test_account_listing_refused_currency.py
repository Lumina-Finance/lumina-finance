"""What account balances do when the installed check refuses converting between currencies

One case of the table the dashboard net worth tests hold in full: each account carries its own status
"""

import importlib
from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import update

from app.allowance_hook import AllowanceKind
from app.models.account import AccountBalanceSnapshot
from tests.conftest import TestSession
from tests.routes.accounts._account_helpers import _FixedClock
from tests.routes.support import _create_account, _create_user, _get_auth_header
from tests.routes.support.allowance_helpers import ALLOWANCE_REASON, install_check, seed_usd_currency


async def test_list_accounts_leaves_out_a_personal_account_in_another_currency_the_check_refuses_converting(client, monkeypatch):
    """A personal US account has no converted balance and says why, while a group's converts and a Canadian one needs no conversion"""
    account_routes = importlib.import_module("app.routes.accounts.router")
    from app.services.fx import FrankfurterProvider

    async def fake_get_rates(self, base, quote, start_date, end_date):
        return {end_date: Decimal("1.5")}

    monkeypatch.setattr(account_routes, "datetime", _FixedClock(datetime(2026, 3, 20, 16, 0, tzinfo=UTC)))
    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    headers = _get_auth_header(await _create_user(client))
    await seed_usd_currency()
    group = await client.post("/groups", json={"name": "Household"}, headers=headers)
    created = {
        "CAD Cash": (await _create_account(client, headers, name="CAD Cash")).json(),
        "USD Cash": (await _create_account(client, headers, name="USD Cash", currency="USD")).json(),
        "USD Joint": (await _create_account(client, headers, name="USD Joint", currency="USD", group_id=group.json()["id"])).json(),
    }
    async with TestSession() as session:
        for account in created.values():
            await session.execute(
                update(AccountBalanceSnapshot)
                .where(AccountBalanceSnapshot.account_id == UUID(account["id"]))
                .values(balance=200_00, dt=date(2026, 3, 20)),
            )
        await session.commit()
    install_check(refused={AllowanceKind.FOREIGN_CURRENCIES})

    response = await client.get("/accounts", headers=headers)

    assert response.status_code == 200, response.text
    rows = {row["name"]: row for row in response.json()}
    assert {name: (row["base_currency_current_balance"], row["current_balance_fx_status"]) for name, row in rows.items()} == {
        "CAD Cash": (200_00, {"state": "none", "missing_pairs": [], "withheld_reason": None}),
        "USD Cash": (0, {"state": "none", "missing_pairs": [], "withheld_reason": ALLOWANCE_REASON}),
        "USD Joint": (300_00, {"state": "complete", "missing_pairs": [], "withheld_reason": None}),
    }
