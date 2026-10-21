"""Route tests that account cash flow and snapshots leave out days after the profile's today"""

from datetime import date
from uuid import UUID

from app.models.account import AccountBalanceSnapshot
from tests.conftest import TestSession
from tests.routes.accounts._balance_snapshot_helpers import _create_category, _create_transaction
from tests.routes.support import _create_account, _create_user, _get_auth_header
from tests.routes.support.clock_helpers import PROFILE_TODAY, PROFILE_TOMORROW, freeze_profile_clock


async def _seed_snapshots(account_id: str) -> None:
    """Give the account a balance on June 8, on the profile's today and on the day after"""
    async with TestSession() as session:
        rows = [
            AccountBalanceSnapshot(account_id=UUID(account_id), dt=date(2026, 6, 8), balance=1_000),
            AccountBalanceSnapshot(account_id=UUID(account_id), dt=PROFILE_TODAY, balance=3_000),
            AccountBalanceSnapshot(account_id=UUID(account_id), dt=PROFILE_TOMORROW, balance=6_000),
        ]
        session.add_all(rows)
        await session.commit()


async def test_account_cash_flow_leaves_out_days_after_the_profile_date(client, freeze_now):
    """A transaction dated after the profile's today adds nothing, though it is already today in UTC"""
    freeze_profile_clock(freeze_now)
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    account_id = (await _create_account(client, headers)).json()["id"]
    income_id = (await _create_category(client, headers, name="Test Salary", kind="income")).json()["id"]
    expense_id = (await _create_category(client, headers, name="Test Groceries", kind="expense")).json()["id"]

    await _create_transaction(client, headers, account_id, income_id, dt=PROFILE_TODAY.isoformat(), amount=100_000)
    await _create_transaction(client, headers, account_id, income_id, dt=PROFILE_TOMORROW.isoformat(), amount=40_000)
    await _create_transaction(client, headers, account_id, expense_id, dt=PROFILE_TODAY.isoformat(), amount=-30_000)
    await _create_transaction(client, headers, account_id, expense_id, dt=PROFILE_TOMORROW.isoformat(), amount=-20_000)

    resp = await client.get(f"/accounts/{account_id}/cash-flow", params={"months": 1}, headers=headers)

    assert resp.status_code == 200
    assert resp.json() == [{"month": "2026-06-01", "income": 100_000, "expenses": 30_000}]


async def test_account_snapshots_leave_out_days_after_the_profile_date(client, freeze_now):
    """Snapshots dated after the profile's today are not listed, with or without an upper bound"""
    freeze_profile_clock(freeze_now)
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    account_id = (await _create_account(client, headers)).json()["id"]
    await _seed_snapshots(account_id)

    unbounded = await client.get(f"/accounts/{account_id}/snapshots", params={"from_date": "2026-06-08"}, headers=headers)
    bounded = await client.get(
        f"/accounts/{account_id}/snapshots",
        params={"from_date": "2026-06-08", "to_date": "2026-06-12"},
        headers=headers,
    )

    assert unbounded.status_code == bounded.status_code == 200
    assert [row["balance"] for row in unbounded.json()] == [1_000, 3_000]
    assert [row["balance"] for row in bounded.json()] == [1_000, 3_000]


async def test_account_snapshot_anchor_for_a_future_start_is_the_balance_on_the_profile_date(client, freeze_now):
    """A window that starts after today is anchored on today's balance, not on a balance that starts later"""
    freeze_profile_clock(freeze_now)
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    account_id = (await _create_account(client, headers)).json()["id"]
    await _seed_snapshots(account_id)

    resp = await client.get(
        f"/accounts/{account_id}/snapshots",
        params={"from_date": "2026-06-12", "include_anchor": "true"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert [row["balance"] for row in resp.json()] == [3_000]
