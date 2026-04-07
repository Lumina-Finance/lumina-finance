"""Route tests for the account balance snapshot endpoints and lifecycle hooks."""
import uuid
from datetime import datetime

from sqlalchemy import select

from app.models.account import AccountBalanceSnapshot
from tests.conftest import TestSession
from tests.routes.conftest import _create_account, _create_user, _get_auth_header

# --- Helpers ---


async def _get_snapshots_for(account_id):
    """Query the DB directly for an account's balance snapshots ordered by date."""
    async with TestSession() as session:
        result = await session.execute(
            select(AccountBalanceSnapshot)
            .where(AccountBalanceSnapshot.account_id == account_id)
            .order_by(AccountBalanceSnapshot.date),
        )
        return list(result.scalars().all())


# --- Zero snapshot seeding on account creation ---


async def test_create_account_seeds_zero_balance_snapshot(client):
    """A new personal account gets a zero-balance snapshot anchoring its history."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(client, headers)
    account_id = resp.json()["id"]
    created_at = datetime.fromisoformat(resp.json()["created_at"])

    snapshots = await _get_snapshots_for(account_id)
    assert len(snapshots) == 1
    assert snapshots[0].balance == 0
    assert snapshots[0].date == created_at.date()


async def test_create_household_account_seeds_zero_balance_snapshot(client):
    """A new household account also gets a zero-balance snapshot."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    household_resp = await client.post("/households", json={"name": "Smith Family"}, headers=headers)
    household_id = household_resp.json()["id"]

    resp = await _create_account(client, headers, household_id=household_id)
    account_id = resp.json()["id"]
    created_at = datetime.fromisoformat(resp.json()["created_at"])

    snapshots = await _get_snapshots_for(account_id)
    assert len(snapshots) == 1
    assert snapshots[0].balance == 0
    assert snapshots[0].date == created_at.date()


async def test_create_two_accounts_each_gets_its_own_snapshot(client):
    """Creating two accounts for the same user yields one snapshot per account."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    first = await _create_account(client, headers, name="Chequing")
    second = await _create_account(client, headers, name="Savings", account_type="savings")

    first_id = uuid.UUID(first.json()["id"])
    second_id = uuid.UUID(second.json()["id"])

    first_snapshots = await _get_snapshots_for(first_id)
    second_snapshots = await _get_snapshots_for(second_id)

    assert len(first_snapshots) == 1
    assert len(second_snapshots) == 1
    assert first_snapshots[0].account_id == first_id
    assert second_snapshots[0].account_id == second_id


async def test_failed_account_creation_leaves_no_snapshot(client):
    """Invalid account creation request does not leave an orphan snapshot."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    # Invalid currency triggers 422 before any DB writes
    resp = await _create_account(client, headers, currency="ZZZ")
    assert resp.status_code == 422

    # No snapshots should exist for any account created by this user
    async with TestSession() as session:
        result = await session.execute(select(AccountBalanceSnapshot))
        assert list(result.scalars().all()) == []
