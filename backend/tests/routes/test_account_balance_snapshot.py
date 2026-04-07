"""Route tests for the account balance snapshot endpoints and lifecycle hooks."""
import uuid
from datetime import UTC, datetime

from sqlalchemy import select

from app.models.account import AccountBalanceSnapshot
from tests.conftest import TestSession
from tests.routes.conftest import _create_account, _create_user, _get_auth_header

# --- Helpers ---


def _midnight(y, m, d):
    """Build a midnight-UTC datetime for snapshot ts comparisons."""
    return datetime(y, m, d, tzinfo=UTC)


async def _get_snapshots_for(account_id):
    """Query the DB directly for an account's balance snapshots ordered by ts."""
    async with TestSession() as session:
        result = await session.execute(
            select(AccountBalanceSnapshot)
            .where(AccountBalanceSnapshot.account_id == account_id)
            .order_by(AccountBalanceSnapshot.ts),
        )
        return list(result.scalars().all())


async def _create_category(client, headers, **overrides):
    """Create an expense category via POST /categories."""
    payload = {"name": "Groceries", "kind": "expense", **overrides}
    return await client.post("/categories", json=payload, headers=headers)


async def _create_transaction(client, headers, account_id, category_id, **overrides):
    """Create a transaction via POST /transactions."""
    payload = {
        "account_id": account_id,
        "category_id": category_id,
        "ts": "2026-03-15T12:00:00Z",
        "amount": -5000,
        "currency": "CAD",
        **overrides,
    }
    return await client.post("/transactions", json=payload, headers=headers)


# --- Zero snapshot seeding on account creation ---


async def test_create_account_seeds_zero_balance_snapshot(client):
    """A new personal account gets a zero-balance snapshot anchoring its history."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(client, headers)
    account_id = resp.json()["id"]
    created_at = datetime.fromisoformat(resp.json()["created_at"])
    expected_ts = datetime.combine(created_at.astimezone(UTC).date(), datetime.min.time(), tzinfo=UTC)

    snapshots = await _get_snapshots_for(account_id)
    assert len(snapshots) == 1
    assert snapshots[0].balance == 0
    assert snapshots[0].ts == expected_ts


async def test_create_household_account_seeds_zero_balance_snapshot(client):
    """A new household account also gets a zero-balance snapshot."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    household_resp = await client.post("/households", json={"name": "Smith Family"}, headers=headers)
    household_id = household_resp.json()["id"]

    resp = await _create_account(client, headers, household_id=household_id)
    account_id = resp.json()["id"]
    created_at = datetime.fromisoformat(resp.json()["created_at"])
    expected_ts = datetime.combine(created_at.astimezone(UTC).date(), datetime.min.time(), tzinfo=UTC)

    snapshots = await _get_snapshots_for(account_id)
    assert len(snapshots) == 1
    assert snapshots[0].balance == 0
    assert snapshots[0].ts == expected_ts


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


# --- Snapshot recomputation on transaction create ---


async def test_create_transaction_writes_snapshot_for_its_date(client):
    """Creating a transaction produces a snapshot for that day with the new balance."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = uuid.UUID(account_resp.json()["id"])

    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    await _create_transaction(
        client, headers, str(account_id), category_id,
        ts="2026-03-15T12:00:00Z", amount=-5000,
    )

    snapshots = await _get_snapshots_for(account_id)
    snapshot_map = {s.ts: s.balance for s in snapshots}
    assert snapshot_map[_midnight(2026, 3, 15)] == -5000


async def test_create_multiple_transactions_same_day_accumulates_balance(client):
    """Multiple transactions on the same day produce a single snapshot with the net balance."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = uuid.UUID(account_resp.json()["id"])

    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    await _create_transaction(
        client, headers, str(account_id), category_id,
        ts="2026-03-15T09:00:00Z", amount=10000,
    )
    await _create_transaction(
        client, headers, str(account_id), category_id,
        ts="2026-03-15T15:00:00Z", amount=-3000,
    )

    snapshots = await _get_snapshots_for(account_id)
    day_snapshots = [s for s in snapshots if s.ts == _midnight(2026, 3, 15)]
    assert len(day_snapshots) == 1
    assert day_snapshots[0].balance == 7000


async def test_create_transactions_across_multiple_days_builds_running_balance(client):
    """Transactions across several days produce one snapshot per day with running totals."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = uuid.UUID(account_resp.json()["id"])

    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    await _create_transaction(
        client, headers, str(account_id), category_id,
        ts="2026-03-01T10:00:00Z", amount=10000,
    )
    await _create_transaction(
        client, headers, str(account_id), category_id,
        ts="2026-03-02T10:00:00Z", amount=-2000,
    )
    await _create_transaction(
        client, headers, str(account_id), category_id,
        ts="2026-03-03T10:00:00Z", amount=-3000,
    )

    snapshots = await _get_snapshots_for(account_id)
    snapshot_map = {s.ts: s.balance for s in snapshots}
    assert snapshot_map[_midnight(2026, 3, 1)] == 10000
    assert snapshot_map[_midnight(2026, 3, 2)] == 8000
    assert snapshot_map[_midnight(2026, 3, 3)] == 5000
