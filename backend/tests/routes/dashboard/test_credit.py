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


async def test_dashboard_credit_converts_foreign_currency_accounts(client, monkeypatch):
    """Credit usage includes foreign-currency cards converted to the user's base currency."""
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

    cad_card = (await _create_account(
        client,
        headers,
        account_kind="revolving",
        account_type="credit_card",
        name="CAD Card",
        credit_limit=100_000,
    )).json()
    usd_card = (await _create_account(
        client,
        headers,
        account_kind="revolving",
        account_type="credit_card",
        name="USD Card",
        currency="USD",
        credit_limit=20_000,
    )).json()

    async with TestSession() as session:
        for account, balance in [(cad_card, -30_000), (usd_card, -5_000)]:
            await session.execute(
                update(AccountBalanceSnapshot)
                .where(
                    AccountBalanceSnapshot.account_id == UUID(account["id"]),
                    AccountBalanceSnapshot.dt == _owner_local_creation_day(account),
                )
                .values(balance=balance),
            )
        await session.commit()

    resp = await client.get("/dashboard/credit", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["credit_limit_total"] == 130_000
    assert data["credit_used"] == 37_500
    assert data["fx_status"] == {"state": "complete", "missing_pairs": []}
    assert calls == [("USD", "CAD", date(2026, 3, 20), date(2026, 3, 20))]


async def test_dashboard_credit_reports_incomplete_fx_with_missing_pairs(client, monkeypatch):
    """Credit usage skips unconverted foreign cards and reports the missing pair."""
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
        session.add_all([
            Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2),
            Currency(id="ABC", name="Unsupported Test Currency", symbol="A", minor_unit_exponent=2),
        ])
        await session.commit()

    cad_card = (await _create_account(
        client,
        headers,
        account_kind="revolving",
        account_type="credit_card",
        name="CAD Card",
        credit_limit=100_000,
    )).json()
    usd_card = (await _create_account(
        client,
        headers,
        account_kind="revolving",
        account_type="credit_card",
        name="USD Card",
        currency="USD",
        credit_limit=20_000,
    )).json()
    abc_card = (await _create_account(
        client,
        headers,
        account_kind="revolving",
        account_type="credit_card",
        name="ABC Card",
        currency="ABC",
        credit_limit=90_000,
    )).json()

    async with TestSession() as session:
        for account, balance in [(cad_card, -30_000), (usd_card, -5_000), (abc_card, -10_000)]:
            await session.execute(
                update(AccountBalanceSnapshot)
                .where(
                    AccountBalanceSnapshot.account_id == UUID(account["id"]),
                    AccountBalanceSnapshot.dt == _owner_local_creation_day(account),
                )
                .values(balance=balance),
            )
        await session.commit()

    resp = await client.get("/dashboard/credit", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["credit_limit_total"] == 130_000
    assert data["credit_used"] == 37_500
    assert data["fx_status"] == {
        "state": "incomplete",
        "missing_pairs": [
            {
                "base": "ABC",
                "quote": "CAD",
            },
        ],
    }


async def test_dashboard_credit_reports_unavailable_fx(client, monkeypatch):
    """Credit usage reports unavailable FX when every provider lookup fails."""
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

    usd_card = (await _create_account(
        client,
        headers,
        account_kind="revolving",
        account_type="credit_card",
        name="USD Card",
        currency="USD",
        credit_limit=20_000,
    )).json()

    async with TestSession() as session:
        await session.execute(
            update(AccountBalanceSnapshot)
            .where(
                AccountBalanceSnapshot.account_id == UUID(usd_card["id"]),
                AccountBalanceSnapshot.dt == _owner_local_creation_day(usd_card),
            )
            .values(balance=-5_000),
        )
        await session.commit()

    resp = await client.get("/dashboard/credit", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["credit_limit_total"] == 0
    assert data["credit_used"] == 0
    assert data["fx_status"] == {
        "state": "unavailable",
        "missing_pairs": [
            {
                "base": "USD",
                "quote": "CAD",
            },
        ],
    }


async def test_dashboard_credit_used_ignores_positive_card_balances(client, monkeypatch):
    """Stored credit on a card does not count as used credit."""
    from app.routes import dashboard as dashboard_routes

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 3, 20, 16, 0, tzinfo=UTC)))

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    credit_card = (await _create_account(
        client, headers,
        account_kind="revolving",
        account_type="credit_card",
        name="Credit Balance Card",
        credit_limit=1_500_000,
    )).json()

    async with TestSession() as session:
        session.add_all([
            AccountBalanceSnapshot(account_id=UUID(credit_card["id"]), dt=date(2026, 3, 20), balance=42_604),
        ])
        await session.execute(
            update(AccountBalanceSnapshot)
            .where(
                AccountBalanceSnapshot.account_id == UUID(credit_card["id"]),
                AccountBalanceSnapshot.dt == _owner_local_creation_day(credit_card),
            )
            .values(balance=42_604),
        )
        await session.commit()

    resp = await client.get("/dashboard/credit", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["credit_limit_total"] == 1_500_000
    assert data["credit_used"] == 0
    assert data["fx_status"] == {"state": "none", "missing_pairs": []}
