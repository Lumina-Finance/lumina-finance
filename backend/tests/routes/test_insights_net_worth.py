"""Route tests for insights net-worth endpoint."""

from datetime import date
from decimal import Decimal
from uuid import UUID

from sqlalchemy import update

from app.models.account import AccountBalanceSnapshot
from app.models.currency import Currency
from tests.conftest import TestSession
from tests.routes.conftest import _create_account, _create_user, _get_auth_header


def _snapshot(account_id: UUID, dt: date, balance: int) -> AccountBalanceSnapshot:
    """Build an account balance snapshot row."""
    return AccountBalanceSnapshot(account_id=account_id, dt=dt, balance=balance)


async def _seed_currency(currency_id: str, name: str, symbol: str, minor_unit_exponent: int = 2):
    """Insert a currency row for foreign-account tests."""
    async with TestSession() as session:
        session.add(Currency(id=currency_id, name=name, symbol=symbol, minor_unit_exponent=minor_unit_exponent))
        await session.commit()


async def _create_plan(client, headers, **overrides):
    """Create a tax-advantaged plan."""
    payload = {
        "name": "TFSA",
        "tax_treatment": "tax_free",
        "currency": "CAD",
        **overrides,
    }
    return await client.post("/tax-advantaged-plans", json=payload, headers=headers)


async def test_net_worth_returns_compact_daily_signed_group_series(client):
    """Daily buckets group balances, preserve debt signs, and include archived accounts."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cash_account = (await _create_account(client, headers, name="CAD Cash")).json()
    savings_account = (await _create_account(client, headers, account_type="savings", name="CAD Savings")).json()
    card_account = (await _create_account(
        client,
        headers,
        account_kind="revolving",
        account_type="credit_card",
        name="CAD Card",
        credit_limit=500_000,
    )).json()
    archived_account = (await _create_account(client, headers, name="Archived Cash", is_archived=True)).json()
    cash_account_id = UUID(cash_account["id"])
    savings_account_id = UUID(savings_account["id"])
    card_account_id = UUID(card_account["id"])
    archived_account_id = UUID(archived_account["id"])

    async with TestSession() as session:
        session.add_all([
            _snapshot(cash_account_id, date(2026, 4, 30), 100_000),
            _snapshot(cash_account_id, date(2026, 5, 2), 120_000),
            _snapshot(savings_account_id, date(2026, 4, 30), 20_000),
            _snapshot(savings_account_id, date(2026, 5, 2), 30_000),
            _snapshot(card_account_id, date(2026, 4, 30), -50_000),
            _snapshot(card_account_id, date(2026, 5, 3), -80_000),
            _snapshot(archived_account_id, date(2026, 5, 2), 9_000_000),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/net-worth",
        params={"from_date": "2026-05-01", "to_date": "2026-05-03"},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["groups"] == [
        ["cash", "Cash", "asset"],
        ["revolving_debt", "Revolving Debt", "debt"],
    ]
    assert data["baseline"] == [120_000, -50_000]
    assert data["points"] == [
        ["2026-05-01", "2026-05-01", [120_000, -50_000]],
        ["2026-05-02", "2026-05-02", [9_150_000, -50_000]],
        ["2026-05-03", "2026-05-03", [9_150_000, -80_000]],
    ]
    assert data["fx_status"] == {"state": "none", "missing_pairs": []}


async def test_net_worth_groups_tax_advantaged_assets_by_account_type(client):
    """Tax wrappers do not override the underlying asset composition."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    plan_id = (await _create_plan(client, headers)).json()["id"]
    savings_account = (await _create_account(
        client,
        headers,
        account_type="savings",
        name="TFSA Savings",
        tax_advantaged_plan_id=plan_id,
    )).json()
    investment_account = (await _create_account(
        client,
        headers,
        account_type="investment",
        name="TFSA Investment",
        tax_advantaged_plan_id=plan_id,
    )).json()

    async with TestSession() as session:
        session.add_all([
            _snapshot(UUID(savings_account["id"]), date(2026, 5, 1), 25_000),
            _snapshot(UUID(investment_account["id"]), date(2026, 5, 1), 175_000),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/net-worth",
        params={"from_date": "2026-05-01", "to_date": "2026-05-01"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json() == {
        "groups": [
            ["cash", "Cash", "asset"],
            ["investments", "Investments", "asset"],
        ],
        "baseline": [0, 0],
        "points": [["2026-05-01", "2026-05-01", [25_000, 175_000]]],
        "fx_status": {"state": "none", "missing_pairs": []},
    }


async def test_net_worth_converts_foreign_balances_by_bucket_value_date(client, monkeypatch):
    """Foreign balances convert on each bucket's value date while preserving liability signs."""
    from app.services.fx import FrankfurterProvider

    async def fake_get_rates(self, base, quote, start_date, end_date):
        assert (base, quote, start_date, end_date) == (
            "USD",
            "CAD",
            date(2026, 4, 30),
            date(2026, 5, 3),
        )
        return {
            date(2026, 4, 30): Decimal("1.5"),
            date(2026, 5, 1): Decimal("1.5"),
            date(2026, 5, 2): Decimal("2"),
            date(2026, 5, 3): Decimal("2.5"),
        }

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    await _seed_currency("USD", "US Dollar", "$")

    cad_account_id = UUID((await _create_account(client, headers, name="CAD Cash")).json()["id"])
    usd_cash_id = UUID((await _create_account(client, headers, name="USD Cash", currency="USD")).json()["id"])
    usd_card_id = UUID((await _create_account(
        client,
        headers,
        account_kind="revolving",
        account_type="credit_card",
        name="USD Card",
        currency="USD",
        credit_limit=500_000,
    )).json()["id"])

    async with TestSession() as session:
        session.add_all([
            _snapshot(cad_account_id, date(2026, 4, 30), 100_000),
            _snapshot(usd_cash_id, date(2026, 4, 30), 10_000),
            _snapshot(usd_cash_id, date(2026, 5, 2), 20_000),
            _snapshot(usd_card_id, date(2026, 4, 30), -4_000),
            _snapshot(usd_card_id, date(2026, 5, 3), -8_000),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/net-worth",
        params={"from_date": "2026-05-01", "to_date": "2026-05-03"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json() == {
        "groups": [
            ["cash", "Cash", "asset"],
            ["revolving_debt", "Revolving Debt", "debt"],
        ],
        "baseline": [115_000, -6_000],
        "points": [
            ["2026-05-01", "2026-05-01", [115_000, -6_000]],
            ["2026-05-02", "2026-05-02", [140_000, -8_000]],
            ["2026-05-03", "2026-05-03", [150_000, -20_000]],
        ],
        "fx_status": {"state": "complete", "missing_pairs": []},
    }


async def test_net_worth_reports_incomplete_fx_with_missing_pairs(client, monkeypatch):
    """Unconverted foreign balances are skipped and reported through the Net Worth FX status."""
    from app.services.fx import FrankfurterProvider, FxRateNotFoundError

    async def fake_get_rates(self, base, quote, start_date, end_date):
        raise FxRateNotFoundError()

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    await _seed_currency("ABC", "Unsupported Test Currency", "A")

    cad_account_id = UUID((await _create_account(client, headers, name="CAD Cash")).json()["id"])
    abc_account_id = UUID((await _create_account(client, headers, name="ABC Cash", currency="ABC")).json()["id"])

    async with TestSession() as session:
        session.add_all([
            _snapshot(cad_account_id, date(2026, 5, 1), 100_000),
            _snapshot(abc_account_id, date(2026, 5, 1), 70_000),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/net-worth",
        params={"from_date": "2026-05-01", "to_date": "2026-05-01"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json() == {
        "groups": [["cash", "Cash", "asset"]],
        "baseline": [0],
        "points": [["2026-05-01", "2026-05-01", [100_000]]],
        "fx_status": {
            "state": "incomplete",
            "missing_pairs": [{"base": "ABC", "quote": "CAD"}],
        },
    }


async def test_net_worth_returns_previous_day_baseline_for_first_day_activity(client):
    """Monthly ranges use daily buckets and include first-day balance movement."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    account_id = UUID((await _create_account(client, headers, name="June Cash")).json()["id"])

    async with TestSession() as session:
        await session.execute(
            update(AccountBalanceSnapshot)
            .where(AccountBalanceSnapshot.account_id == account_id)
            .values(dt=date(2026, 5, 31), balance=0),
        )
        session.add_all([
            _snapshot(account_id, date(2026, 6, 1), 100_000),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/net-worth",
        params={"from_date": "2026-06-01", "to_date": "2026-07-01"},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["groups"] == [["cash", "Cash", "asset"]]
    assert data["baseline"] == [0]
    assert data["points"][0] == ["2026-06-01", "2026-06-01", [100_000]]
    assert data["points"][-1] == ["2026-07-01", "2026-07-01", [100_000]]


async def test_net_worth_uses_weekly_buckets_for_mid_length_ranges(client):
    """Ranges over 31 days use Monday-labeled weekly buckets."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    account_id = UUID((await _create_account(client, headers, name="Weekly Cash")).json()["id"])

    async with TestSession() as session:
        session.add_all([
            _snapshot(account_id, date(2026, 3, 1), 10_000),
            _snapshot(account_id, date(2026, 3, 12), 20_000),
            _snapshot(account_id, date(2026, 3, 30), 40_000),
            _snapshot(account_id, date(2026, 4, 20), 50_000),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/net-worth",
        params={"from_date": "2026-03-10", "to_date": "2026-04-20"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["points"] == [
        ["2026-03-09", "2026-03-15", [20_000]],
        ["2026-03-16", "2026-03-22", [20_000]],
        ["2026-03-23", "2026-03-29", [20_000]],
        ["2026-03-30", "2026-04-05", [40_000]],
        ["2026-04-06", "2026-04-12", [40_000]],
        ["2026-04-13", "2026-04-19", [40_000]],
        ["2026-04-20", "2026-04-20", [50_000]],
    ]


async def test_net_worth_uses_weekly_buckets_through_183_day_ranges(client):
    """Ranges up to 183 days stay weekly."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    account_id = UUID((await _create_account(client, headers, name="Half Year Cash")).json()["id"])

    async with TestSession() as session:
        await session.execute(
            update(AccountBalanceSnapshot)
            .where(AccountBalanceSnapshot.account_id == account_id)
            .values(dt=date(2025, 12, 31), balance=1_000),
        )
        session.add(_snapshot(account_id, date(2026, 7, 2), 2_000))
        await session.commit()

    resp = await client.get(
        "/insights/net-worth",
        params={"from_date": "2026-01-01", "to_date": "2026-07-02"},
        headers=headers,
    )

    assert resp.status_code == 200
    points = resp.json()["points"]
    assert len(points) == 27
    assert points[0] == ["2025-12-29", "2026-01-04", [1_000]]
    assert points[-1] == ["2026-06-29", "2026-07-02", [2_000]]


async def test_net_worth_uses_monthly_buckets_for_long_ranges(client):
    """Ranges over 183 days use month-start labels and month-end values."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    account_id = UUID((await _create_account(client, headers, name="Long Cash")).json()["id"])

    async with TestSession() as session:
        await session.execute(
            update(AccountBalanceSnapshot)
            .where(AccountBalanceSnapshot.account_id == account_id)
            .values(dt=date(2025, 12, 31), balance=1_000),
        )
        session.add_all([
            _snapshot(account_id, date(2026, 2, 10), 2_000),
            _snapshot(account_id, date(2026, 5, 20), 3_000),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/net-worth",
        params={"from_date": "2026-01-15", "to_date": "2026-08-01"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["points"] == [
        ["2026-01-01", "2026-01-31", [1_000]],
        ["2026-02-01", "2026-02-28", [2_000]],
        ["2026-03-01", "2026-03-31", [2_000]],
        ["2026-04-01", "2026-04-30", [2_000]],
        ["2026-05-01", "2026-05-31", [3_000]],
        ["2026-06-01", "2026-06-30", [3_000]],
        ["2026-07-01", "2026-07-31", [3_000]],
        ["2026-08-01", "2026-08-01", [3_000]],
    ]


async def test_net_worth_omits_zero_only_groups(client):
    """Groups with no non-zero contribution in the selected range are not sent."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    await _create_account(client, headers, name="Future Account")

    resp = await client.get(
        "/insights/net-worth",
        params={"from_date": "2020-01-01", "to_date": "2020-01-03"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json() == {"groups": [], "baseline": [], "points": [], "fx_status": {"state": "none", "missing_pairs": []}}


async def test_net_worth_rejects_invalid_date_range(client):
    """The endpoint rejects a start date after the end date."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(
        "/insights/net-worth",
        params={"from_date": "2026-05-03", "to_date": "2026-05-01"},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_net_worth_requires_auth(client):
    """Insights endpoints require an authenticated user."""
    resp = await client.get(
        "/insights/net-worth",
        params={"from_date": "2026-05-01", "to_date": "2026-05-03"},
    )

    assert resp.status_code == 401
