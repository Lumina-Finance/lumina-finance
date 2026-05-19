"""Route tests for insights net-worth endpoint."""

from datetime import date
from uuid import UUID

from app.models.account import AccountBalanceSnapshot
from app.models.currency import Currency
from tests.conftest import TestSession
from tests.routes.conftest import _create_account, _create_user, _get_auth_header


def _snapshot(account_id: UUID, dt: date, balance: int) -> AccountBalanceSnapshot:
    """Build an account balance snapshot row."""
    return AccountBalanceSnapshot(account_id=account_id, dt=dt, balance=balance)


async def _seed_usd_currency():
    """Insert USD for base-currency exclusion tests."""
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()


async def test_net_worth_returns_compact_daily_signed_group_series(client):
    """Daily buckets group balances, sign debts, and exclude hidden/non-base accounts."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    await _seed_usd_currency()

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
    hidden_account = (await _create_account(client, headers, name="Hidden Cash", is_hidden=True)).json()
    usd_account = (await _create_account(client, headers, name="USD Cash", currency="USD")).json()
    cash_account_id = UUID(cash_account["id"])
    savings_account_id = UUID(savings_account["id"])
    card_account_id = UUID(card_account["id"])
    hidden_account_id = UUID(hidden_account["id"])
    usd_account_id = UUID(usd_account["id"])

    async with TestSession() as session:
        session.add_all([
            _snapshot(cash_account_id, date(2026, 4, 30), 100_000),
            _snapshot(cash_account_id, date(2026, 5, 2), 120_000),
            _snapshot(savings_account_id, date(2026, 4, 30), 20_000),
            _snapshot(savings_account_id, date(2026, 5, 2), 30_000),
            _snapshot(card_account_id, date(2026, 4, 30), 50_000),
            _snapshot(card_account_id, date(2026, 5, 3), 80_000),
            _snapshot(hidden_account_id, date(2026, 5, 2), 9_000_000),
            _snapshot(usd_account_id, date(2026, 5, 2), 8_000_000),
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
    assert data["points"] == [
        ["2026-05-01", "2026-05-01", [120_000, -50_000]],
        ["2026-05-02", "2026-05-02", [150_000, -50_000]],
        ["2026-05-03", "2026-05-03", [150_000, -80_000]],
    ]


async def test_net_worth_uses_weekly_buckets_for_mid_length_ranges(client):
    """Ranges over 30 and up to 90 days use Monday-labeled weekly buckets."""
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


async def test_net_worth_uses_monthly_buckets_for_long_ranges(client):
    """Ranges over 90 days use month-start labels and month-end values."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    account_id = UUID((await _create_account(client, headers, name="Long Cash")).json()["id"])

    async with TestSession() as session:
        session.add_all([
            _snapshot(account_id, date(2025, 12, 31), 1_000),
            _snapshot(account_id, date(2026, 2, 10), 2_000),
            _snapshot(account_id, date(2026, 5, 20), 3_000),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/net-worth",
        params={"from_date": "2026-01-15", "to_date": "2026-05-20"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["points"] == [
        ["2026-01-01", "2026-01-31", [1_000]],
        ["2026-02-01", "2026-02-28", [2_000]],
        ["2026-03-01", "2026-03-31", [2_000]],
        ["2026-04-01", "2026-04-30", [2_000]],
        ["2026-05-01", "2026-05-20", [3_000]],
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
    assert resp.json() == {"groups": [], "points": []}


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
