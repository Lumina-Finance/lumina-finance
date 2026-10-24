from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import update

from app.models.account import AccountBalanceSnapshot
from app.models.currency import Currency
from tests.conftest import TestSession
from tests.routes.dashboard._helpers import (
    _FixedClock,
    _owner_local_creation_day,
)
from tests.routes.support import _create_account, _create_user, _get_auth_header
from tests.routes.support.clock_helpers import PROFILE_TOMORROW, freeze_profile_clock


async def test_dashboard_counts_archived_accounts_in_net_worth_but_not_credit(client, monkeypatch):
    """Net worth includes archived accounts, while credit leaves out an archived card, which no longer lends anything."""
    from app.routes import dashboard as dashboard_routes

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 3, 20, 16, 0, tzinfo=UTC)))

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    visible_asset = (await _create_account(client, headers, name="Visible Cash")).json()
    archived_asset = (await _create_account(client, headers, name="Archived Cash", is_archived=True)).json()
    visible_credit = (
        await _create_account(
            client,
            headers,
            account_kind="revolving",
            account_type="credit_card",
            name="Visible Card",
            credit_limit=200_000,
        )
    ).json()
    archived_credit = (
        await _create_account(
            client,
            headers,
            account_kind="revolving",
            account_type="credit_card",
            name="Archived Card",
            credit_limit=900_000,
            is_archived=True,
        )
    ).json()

    async with TestSession() as session:
        session.add_all(
            [
                AccountBalanceSnapshot(account_id=UUID(visible_asset["id"]), dt=date(2026, 3, 20), balance=100_000),
                AccountBalanceSnapshot(account_id=UUID(archived_asset["id"]), dt=date(2026, 3, 20), balance=500_000),
                AccountBalanceSnapshot(account_id=UUID(visible_credit["id"]), dt=date(2026, 3, 20), balance=-30_000),
                AccountBalanceSnapshot(account_id=UUID(archived_credit["id"]), dt=date(2026, 3, 20), balance=-70_000),
            ]
        )
        for account, balance in [
            (visible_asset, 100_000),
            (archived_asset, 500_000),
            (visible_credit, -30_000),
            (archived_credit, -70_000),
        ]:
            await session.execute(
                update(AccountBalanceSnapshot)
                .where(
                    AccountBalanceSnapshot.account_id == UUID(account["id"]),
                    AccountBalanceSnapshot.dt == _owner_local_creation_day(account),
                )
                .values(balance=balance),
            )
        await session.commit()

    resp = await client.get("/dashboard/net-worth", params={"window_days": 3}, headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["current_net_worth"] == 500_000
    assert data["net_worth_history"][-1] == 500_000
    assert data["fx_status"] == {"state": "none", "missing_pairs": []}

    credit_resp = await client.get("/dashboard/credit", headers=headers)

    assert credit_resp.status_code == 200
    credit_data = credit_resp.json()
    assert credit_data["credit_limit_total"] == 200_000
    assert credit_data["credit_used"] == 30_000
    assert credit_data["fx_status"] == {"state": "none", "missing_pairs": []}


async def test_dashboard_net_worth_converts_foreign_currency_accounts(client, monkeypatch):
    """Net worth includes visible foreign-currency accounts converted to the user's base currency."""
    from app.routes import dashboard as dashboard_routes
    from app.services.fx import FrankfurterProvider

    calls = []

    async def fake_get_rates(self, base, quote, start_date, end_date):
        calls.append((base, quote, start_date, end_date))
        return {date(2026, 3, 20): Decimal("1.5")}

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 3, 20, 16, 0, tzinfo=UTC)))
    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()

    cad_account = (await _create_account(client, headers, name="CAD Cash")).json()
    usd_account = (await _create_account(client, headers, name="USD Cash", currency="USD")).json()

    async with TestSession() as session:
        session.add_all(
            [
                AccountBalanceSnapshot(account_id=UUID(cad_account["id"]), dt=date(2026, 3, 20), balance=100_00),
                AccountBalanceSnapshot(account_id=UUID(usd_account["id"]), dt=date(2026, 3, 20), balance=200_00),
            ]
        )
        await session.commit()

    resp = await client.get("/dashboard/net-worth", params={"window_days": 2}, headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["current_net_worth"] == 400_00
    assert data["net_worth_history"] == [0, 400_00]
    assert data["fx_status"] == {"state": "complete", "missing_pairs": []}
    assert calls == [("USD", "CAD", date(2026, 3, 12), date(2026, 3, 20))]


async def test_dashboard_net_worth_reports_incomplete_fx_with_missing_pairs(client, monkeypatch):
    """Net worth skips unconverted foreign accounts and reports the missing pair."""
    from app.routes import dashboard as dashboard_routes
    from app.services.fx import FrankfurterProvider, FxRateNotFoundError

    async def fake_get_rates(self, base, quote, start_date, end_date):
        if base == "USD":
            return {date(2026, 3, 20): Decimal("1.5")}
        raise FxRateNotFoundError()

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 3, 20, 16, 0, tzinfo=UTC)))
    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    async with TestSession() as session:
        session.add_all(
            [
                Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2),
                Currency(id="ABC", name="Unsupported Test Currency", symbol="A", minor_unit_exponent=2),
            ]
        )
        await session.commit()

    cad_account = (await _create_account(client, headers, name="CAD Cash")).json()
    usd_account = (await _create_account(client, headers, name="USD Cash", currency="USD")).json()
    abc_account = (await _create_account(client, headers, name="ABC Cash", currency="ABC")).json()

    async with TestSession() as session:
        session.add_all(
            [
                AccountBalanceSnapshot(account_id=UUID(cad_account["id"]), dt=date(2026, 3, 20), balance=100_00),
                AccountBalanceSnapshot(account_id=UUID(usd_account["id"]), dt=date(2026, 3, 20), balance=200_00),
                AccountBalanceSnapshot(account_id=UUID(abc_account["id"]), dt=date(2026, 3, 20), balance=900_00),
            ]
        )
        await session.commit()

    resp = await client.get("/dashboard/net-worth", params={"window_days": 1}, headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["current_net_worth"] == 400_00
    assert data["fx_status"] == {
        "state": "incomplete",
        "missing_pairs": [
            {
                "base": "ABC",
                "quote": "CAD",
            },
        ],
    }


async def test_dashboard_net_worth_reports_unavailable_fx(client, monkeypatch):
    """Net worth reports unavailable FX when every provider lookup fails."""
    from app.routes import dashboard as dashboard_routes
    from app.services.fx import FrankfurterProvider, FxProviderUnavailableError

    async def fake_get_rates(self, base, quote, start_date, end_date):
        raise FxProviderUnavailableError()

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 3, 20, 16, 0, tzinfo=UTC)))
    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()

    usd_account = (await _create_account(client, headers, name="USD Cash", currency="USD")).json()

    async with TestSession() as session:
        session.add(AccountBalanceSnapshot(account_id=UUID(usd_account["id"]), dt=date(2026, 3, 20), balance=200_00))
        await session.commit()

    resp = await client.get("/dashboard/net-worth", params={"window_days": 1}, headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["current_net_worth"] == 0
    assert data["fx_status"] == {
        "state": "unavailable",
        "missing_pairs": [
            {
                "base": "USD",
                "quote": "CAD",
            },
        ],
    }


async def test_dashboard_net_worth_leaves_out_balances_after_the_profile_date(client, freeze_now):
    """A balance that starts after the profile's today stays out of the history, though it is already today in UTC."""
    freeze_profile_clock(freeze_now)
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    account = (await _create_account(client, headers, name="Main Cash")).json()

    async with TestSession() as session:
        rows = [
            AccountBalanceSnapshot(account_id=UUID(account["id"]), dt=date(2026, 6, 8), balance=100_000),
            AccountBalanceSnapshot(account_id=UUID(account["id"]), dt=PROFILE_TOMORROW, balance=140_000),
        ]
        session.add_all(rows)
        await session.commit()

    resp = await client.get("/dashboard/net-worth", params={"window_days": 3}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["net_worth_history"] == [0, 100_000, 100_000]
    assert resp.json()["current_net_worth"] == 100_000


async def test_dashboard_net_worth_gives_each_request_its_own_fx_budget(client, monkeypatch):
    """A request that spent its whole rate budget leaves the next request a full one"""
    from app.routes import dashboard as dashboard_routes
    from app.services.fx import FxProviderUnavailableError, frankfurter_provider

    clock = 0.0
    calls = 0

    def fake_monotonic() -> float:
        """Read the test's clock"""
        return clock

    async def slow_failing_request(*args, **kwargs):
        """Fail as a timeout would, after using more than the whole budget"""
        nonlocal clock, calls
        calls += 1
        clock += 10.0
        raise FxProviderUnavailableError("FX provider request failed")

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 3, 20, 16, 0, tzinfo=UTC)))
    monkeypatch.setattr(frankfurter_provider, "monotonic", fake_monotonic)
    monkeypatch.setattr(frankfurter_provider, "request_frankfurter_rates_response", slow_failing_request)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()

    usd_account = (await _create_account(client, headers, name="USD Cash", currency="USD")).json()
    async with TestSession() as session:
        session.add(AccountBalanceSnapshot(account_id=UUID(usd_account["id"]), dt=date(2026, 3, 20), balance=200_00))
        await session.commit()

    first = await client.get("/dashboard/net-worth", params={"window_days": 1}, headers=headers)
    second = await client.get("/dashboard/net-worth", params={"window_days": 1}, headers=headers)

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["fx_status"]["state"] == "unavailable"

    # One attempt each: the first spends its budget, and the second starts with a fresh one
    assert calls == 2
