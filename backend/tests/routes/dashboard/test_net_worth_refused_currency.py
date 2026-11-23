"""What the dashboard net worth does when the installed check refuses converting between currencies

The full table of cases every other total repeats one case of: a personal account in another currency
is left out and the status says why, a group-owned one converts, and with no check everything converts
"""

from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

import pytest

from app.allowance_hook import AllowanceKind
from app.models.account import AccountBalanceSnapshot
from tests.conftest import TestSession
from tests.routes.dashboard._helpers import _FixedClock
from tests.routes.support import _create_account, _create_user, _get_auth_header
from tests.routes.support.allowance_helpers import ALLOWANCE_REASON, install_check, seed_usd_currency

_RATE = Decimal("1.5")
_TODAY = date(2026, 3, 20)


@pytest.mark.parametrize(
    ("refused", "has_personal_usd", "has_group_usd", "net_worth", "fx_status"),
    [
        pytest.param(
            True,
            True,
            False,
            100_00,
            {"state": "none", "missing_pairs": [], "withheld_reason": ALLOWANCE_REASON},
            id="refused-leaves-the-personal-account-out",
        ),
        pytest.param(
            True,
            True,
            True,
            175_00,
            {"state": "complete", "missing_pairs": [], "withheld_reason": ALLOWANCE_REASON},
            id="refused-still-converts-the-group-account",
        ),
        pytest.param(
            True,
            False,
            True,
            175_00,
            {"state": "complete", "missing_pairs": [], "withheld_reason": None},
            id="refused-with-nothing-to-leave-out-gives-no-reason",
        ),
        pytest.param(
            False, True, True, 475_00, {"state": "complete", "missing_pairs": [], "withheld_reason": None}, id="no-check-converts-both"
        ),
    ],
)
async def test_dashboard_net_worth_leaves_out_accounts_in_another_currency_the_check_refuses_converting(
    client, monkeypatch, refused, has_personal_usd, has_group_usd, net_worth, fx_status
):
    """A 100.00 Canadian, a 200.00 US personal and a 50.00 US group account at 1.5 lose only the personal one to the refusal"""
    from app.routes import dashboard as dashboard_routes
    from app.services.fx import FrankfurterProvider

    async def fake_get_rates(self, base, quote, start_date, end_date):
        return {_TODAY: _RATE}

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 3, 20, 16, 0, tzinfo=UTC)))
    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    headers = _get_auth_header(await _create_user(client))
    await seed_usd_currency()
    balances = {(await _create_account(client, headers, name="CAD Cash")).json()["id"]: 100_00}
    if has_personal_usd:
        balances[(await _create_account(client, headers, name="USD Cash", currency="USD")).json()["id"]] = 200_00
    if has_group_usd:
        group = await client.post("/groups", json={"name": "Household"}, headers=headers)
        shared = await _create_account(client, headers, name="USD Joint", currency="USD", group_id=group.json()["id"])
        balances[shared.json()["id"]] = 50_00
    async with TestSession() as session:
        session.add_all(
            AccountBalanceSnapshot(account_id=UUID(account_id), dt=_TODAY, balance=balance) for account_id, balance in balances.items()
        )
        await session.commit()
    if refused:
        install_check(refused={AllowanceKind.FOREIGN_CURRENCIES})

    response = await client.get("/dashboard/net-worth", params={"window_days": 2}, headers=headers)

    assert response.status_code == 200, response.text
    assert response.json()["current_net_worth"] == net_worth
    assert response.json()["net_worth_history"] == [0, net_worth], "the series leaves out the same amounts as the total"
    assert response.json()["fx_status"] == fx_status
