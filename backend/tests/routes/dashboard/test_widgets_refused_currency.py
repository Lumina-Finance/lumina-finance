"""What the dashboard widgets do when the installed check refuses converting between currencies

One case each of the table the net worth tests hold in full: a personal account in another currency is left
out of the widget's figures and the status says why, while the Canadian account's figures stay
"""

from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

import pytest
from sqlalchemy import update

from app.allowance_hook import AllowanceKind
from app.models.account import AccountBalanceSnapshot
from tests.conftest import TestSession
from tests.routes.dashboard._helpers import _create_category, _create_transaction, _FixedClock
from tests.routes.support import _create_account, _create_user, _get_auth_header
from tests.routes.support.allowance_helpers import ALLOWANCE_REASON, install_check, seed_usd_currency

_TODAY = date(2026, 3, 20)


@pytest.mark.parametrize(
    ("path", "params", "figures", "expected"),
    [
        pytest.param("/dashboard/credit", {}, lambda data: (data["credit_limit_total"], data["credit_used"]), (100_000, 30_000), id="credit"),
        pytest.param("/dashboard/spending-breakdown", {"range": "MTD"}, lambda data: data["expense_total"], 10_000, id="spending-breakdown"),
        pytest.param("/dashboard/spending-comparison", {"range": "MTD"}, lambda data: data["current"][-1], 10_000, id="spending-comparison"),
        pytest.param(
            "/dashboard/savings-rate",
            {},
            lambda data: data["savings_rate_history"][-1],
            {"month": "2026-03-01", "income": 50_000, "expenses": 10_000},
            id="savings-rate",
        ),
    ],
)
async def test_dashboard_widgets_leave_out_accounts_in_another_currency_the_check_refuses_converting(
    client, monkeypatch, path, params, figures, expected
):
    """A Canadian and a US account at 1.5 give a widget the Canadian figures alone, saying why the US ones are left out"""
    from app.routes import dashboard as dashboard_routes
    from app.services.fx import FrankfurterProvider

    async def fake_get_rates(self, base, quote, start_date, end_date):
        return {_TODAY: Decimal("1.5")}

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 3, 20, 16, 0, tzinfo=UTC)))
    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    headers = _get_auth_header(await _create_user(client))
    await seed_usd_currency()
    cad_account_id = (await _create_account(client, headers, name="CAD Cash")).json()["id"]
    usd_account_id = (await _create_account(client, headers, name="USD Cash", currency="USD")).json()["id"]
    cards = {}
    for currency, limit in (("CAD", 100_000), ("USD", 20_000)):
        card = await _create_account(
            client,
            headers,
            account_kind="revolving",
            account_type="credit_card",
            name=f"{currency} Card",
            currency=currency,
            credit_limit=limit,
        )
        cards[card.json()["id"]] = -30_000 if currency == "CAD" else -5_000
    income_id = (await _create_category(client, headers, name="Test Salary", kind="income")).json()["id"]
    expense_id = (await _create_category(client, headers, name="Test Groceries", kind="expense")).json()["id"]
    for account_id, currency in ((cad_account_id, "CAD"), (usd_account_id, "USD")):
        await _create_transaction(client, headers, account_id, income_id, dt="2026-03-15", amount=50_000, currency=currency)
        await _create_transaction(client, headers, account_id, expense_id, dt="2026-03-15", amount=-10_000, currency=currency)
    async with TestSession() as session:
        for account_id, balance in cards.items():
            await session.execute(
                update(AccountBalanceSnapshot).where(AccountBalanceSnapshot.account_id == UUID(account_id)).values(balance=balance, dt=_TODAY),
            )
        await session.commit()
    install_check(refused={AllowanceKind.FOREIGN_CURRENCIES})

    response = await client.get(path, params=params, headers=headers)

    assert response.status_code == 200, response.text
    data = response.json()
    assert figures(data) == expected
    assert data["fx_status"] == {"state": "none", "missing_pairs": [], "withheld_reason": ALLOWANCE_REASON}


@pytest.mark.parametrize("path", ["/dashboard/credit", "/dashboard/credit-utilization"])
@pytest.mark.parametrize(
    ("usd_limit", "limit_withheld"),
    [
        pytest.param(20_000, True, id="a-us-limit-is-left-out"),
        pytest.param(0, False, id="only-us-credit-used-is-left-out"),
    ],
)
async def test_dashboard_credit_says_whether_a_limit_was_left_out(client, monkeypatch, path, usd_limit, limit_withheld):
    """A Canadian card with no limit beside a US card with 50.00 used says a limit was left out only when the US card has one"""
    from app.routes import dashboard as dashboard_routes

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 3, 20, 16, 0, tzinfo=UTC)))
    headers = _get_auth_header(await _create_user(client))
    await seed_usd_currency()
    cards = {}
    for currency, limit, used in (("CAD", 0, 0), ("USD", usd_limit, 50_00)):
        card = await _create_account(
            client,
            headers,
            account_kind="revolving",
            account_type="credit_card",
            name=f"{currency} Card",
            currency=currency,
            credit_limit=limit,
        )
        cards[card.json()["id"]] = -used
    async with TestSession() as session:
        for account_id, balance in cards.items():
            await session.execute(
                update(AccountBalanceSnapshot).where(AccountBalanceSnapshot.account_id == UUID(account_id)).values(balance=balance, dt=_TODAY),
            )
        await session.commit()
    install_check(refused={AllowanceKind.FOREIGN_CURRENCIES})

    response = await client.get(path, headers=headers)

    assert response.status_code == 200, response.text
    data = response.json()
    assert (data["credit_limit_total"], data["credit_used"]) == (0, 0)
    assert data["limit_withheld"] is limit_withheld
    assert data["fx_status"]["withheld_reason"] == ALLOWANCE_REASON
