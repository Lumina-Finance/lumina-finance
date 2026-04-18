"""Route tests for the account balance snapshot endpoints and lifecycle hooks."""
import uuid
from datetime import UTC, datetime

from sqlalchemy import select

from app.models.account import AccountBalanceSnapshot
from app.models.currency import Currency
from tests.conftest import TestSession
from tests.routes.conftest import _create_account, _create_user, _get_auth_header

# --- Helpers ---


def _midnight(y, m, d):
    """Build a midnight-UTC datetime for snapshot ts comparisons."""
    return datetime(y, m, d, tzinfo=UTC)


def _creation_day_midnight(account_resp):
    """Return the midnight-UTC datetime of an account's creation day."""
    created_at_utc = datetime.fromisoformat(account_resp.json()["created_at"]).astimezone(UTC)
    return _midnight(created_at_utc.year, created_at_utc.month, created_at_utc.day)


async def _get_snapshots_for(account_id):
    """Query the DB directly for an account's balance snapshots ordered by ts."""
    async with TestSession() as session:
        result = await session.execute(
            select(AccountBalanceSnapshot)
            .where(AccountBalanceSnapshot.account_id == account_id)
            .order_by(AccountBalanceSnapshot.ts),
        )
        return list(result.scalars().all())


async def _seed_usd_currency():
    """Insert the USD currency row needed for multi-currency transaction tests."""
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()


async def _create_category(client, headers, **overrides):
    """Create an expense category via POST /categories."""
    payload = {"name": "Test Groceries", "kind": "expense", **overrides}
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
    account_id = uuid.UUID(resp.json()["id"])
    expected_ts = _creation_day_midnight(resp)

    snapshots = await _get_snapshots_for(account_id)
    assert len(snapshots) == 1
    assert snapshots[0].balance == 0
    assert snapshots[0].ts == expected_ts


async def test_create_group_account_seeds_zero_balance_snapshot(client):
    """A new group account also gets a zero-balance snapshot."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    group_resp = await client.post("/groups", json={"name": "Smith Family"}, headers=headers)
    group_id = group_resp.json()["id"]

    resp = await _create_account(client, headers, group_id=group_id)
    account_id = uuid.UUID(resp.json()["id"])
    expected_ts = _creation_day_midnight(resp)

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


# --- Zero anchor lifecycle (replacement vs preservation) ---


async def test_create_transaction_after_creation_day_keeps_zero_anchor(client):
    """Transactions dated after the account creation day leave the zero anchor in place.

    The anchor exists so the frontend has a starting point at the creation day.
    A future-dated transaction is appended forward of the anchor — both rows
    coexist and the anchor remains the earliest snapshot.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = uuid.UUID(account_resp.json()["id"])
    creation_day = _creation_day_midnight(account_resp)

    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    # Far-future date so the recompute window starts well after the creation day
    await _create_transaction(
        client, headers, str(account_id), category_id,
        ts="2026-12-15T12:00:00Z", amount=5000,
    )

    snapshots = await _get_snapshots_for(account_id)
    snapshot_map = {s.ts: s.balance for s in snapshots}
    # Zero anchor is preserved as the earliest snapshot
    assert snapshot_map[creation_day] == 0
    # New txn day carries the running balance from the anchor (0 + 5000)
    assert snapshot_map[_midnight(2026, 12, 15)] == 5000
    assert len(snapshots) == 2


async def test_create_transaction_before_creation_day_replaces_zero_anchor(client):
    """Transactions dated before the account creation day replace the zero anchor.

    The recompute window starts at the transaction's day, which wipes any
    snapshots at or after that day — including the original creation-day
    anchor. The earliest transaction becomes the new anchor.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = uuid.UUID(account_resp.json()["id"])
    creation_day = _creation_day_midnight(account_resp)

    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    # Past date — recompute starts at this day and wipes the creation-day anchor
    await _create_transaction(
        client, headers, str(account_id), category_id,
        ts="2026-03-15T12:00:00Z", amount=5000,
    )

    snapshots = await _get_snapshots_for(account_id)
    snapshot_map = {s.ts: s.balance for s in snapshots}
    assert creation_day not in snapshot_map
    assert snapshot_map[_midnight(2026, 3, 15)] == 5000
    assert len(snapshots) == 1


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
    assert len(snapshots) == 1


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
    assert len(snapshots) == 1
    assert snapshots[0].ts == _midnight(2026, 3, 15)
    assert snapshots[0].balance == 7000


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
    assert len(snapshots) == 3


async def test_failed_create_transaction_with_invalid_currency_leaves_no_snapshot(client):
    """A 422 transaction create due to bad currency leaves no orphan snapshot rows."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = uuid.UUID(account_resp.json()["id"])

    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    before = [(s.ts, s.balance) for s in await _get_snapshots_for(account_id)]

    resp = await _create_transaction(
        client, headers, str(account_id), category_id,
        ts="2026-03-15T12:00:00Z", amount=-5000, currency="ZZZ",
    )
    assert resp.status_code == 422

    after = [(s.ts, s.balance) for s in await _get_snapshots_for(account_id)]
    assert before == after


async def test_fx_rate_is_metadata_and_does_not_affect_snapshot_balance(client):
    """fx_rate is metadata; the snapshot must use Transaction.amount as-is.

    fx_rate and currency are metadata about the original receipt; the
    Transaction.amount field is already denominated in the account's base
    currency. The snapshot service must therefore sum amounts directly and
    must NOT multiply by fx_rate.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    await _seed_usd_currency()

    account_resp = await _create_account(client, headers)  # CAD account
    account_id = uuid.UUID(account_resp.json()["id"])

    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    # The user paid 100 USD at 1.4 CAD/USD; the client pre-converted to 140
    # CAD cents and posts that as `amount` with the original currency and rate
    # preserved as metadata.
    await _create_transaction(
        client, headers, str(account_id), category_id,
        ts="2026-03-15T12:00:00Z", amount=14000, currency="USD", fx_rate=1.4,
    )

    snapshots = await _get_snapshots_for(account_id)
    snapshot_map = {s.ts: s.balance for s in snapshots}
    # Snapshot equals the stored amount (14000 CAD cents), NOT 14000 * 1.4
    assert snapshot_map[_midnight(2026, 3, 15)] == 14000


# --- Snapshot recomputation on transaction update ---


async def test_update_transaction_amount_recomputes_same_day_balance(client):
    """Updating a transaction's amount adjusts that day's snapshot balance."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = uuid.UUID(account_resp.json()["id"])
    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    txn_resp = await _create_transaction(
        client, headers, str(account_id), category_id,
        ts="2026-03-15T12:00:00Z", amount=-5000,
    )
    txn_id = txn_resp.json()["id"]

    await client.patch(f"/transactions/{txn_id}", json={"amount": -8000}, headers=headers)

    snapshots = await _get_snapshots_for(account_id)
    snapshot_map = {s.ts: s.balance for s in snapshots}
    assert snapshot_map[_midnight(2026, 3, 15)] == -8000
    assert len(snapshots) == 1


async def test_update_transaction_amount_propagates_to_later_day_snapshots(client):
    """Adjusting one day's transaction amount cascades to later days' running balances."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = uuid.UUID(account_resp.json()["id"])
    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    txn1 = await _create_transaction(
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

    txn1_id = txn1.json()["id"]
    await client.patch(f"/transactions/{txn1_id}", json={"amount": 20000}, headers=headers)

    snapshots = await _get_snapshots_for(account_id)
    snapshot_map = {s.ts: s.balance for s in snapshots}
    assert snapshot_map[_midnight(2026, 3, 1)] == 20000
    assert snapshot_map[_midnight(2026, 3, 2)] == 18000
    assert snapshot_map[_midnight(2026, 3, 3)] == 15000
    assert len(snapshots) == 3


async def test_update_transaction_ts_to_later_day_moves_snapshot(client):
    """Moving a transaction's ts to a later day removes the original day's snapshot."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = uuid.UUID(account_resp.json()["id"])
    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    txn = await _create_transaction(
        client, headers, str(account_id), category_id,
        ts="2026-03-15T12:00:00Z", amount=-5000,
    )
    txn_id = txn.json()["id"]

    await client.patch(
        f"/transactions/{txn_id}",
        json={"ts": "2026-03-20T12:00:00Z"},
        headers=headers,
    )

    snapshots = await _get_snapshots_for(account_id)
    snapshot_map = {s.ts: s.balance for s in snapshots}
    assert _midnight(2026, 3, 15) not in snapshot_map
    assert snapshot_map[_midnight(2026, 3, 20)] == -5000
    assert len(snapshots) == 1


async def test_update_transaction_ts_to_earlier_day_recomputes_from_earlier_day(client):
    """Moving a transaction's ts backwards rebuilds snapshots from the earlier day forward."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = uuid.UUID(account_resp.json()["id"])
    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    txn = await _create_transaction(
        client, headers, str(account_id), category_id,
        ts="2026-03-20T12:00:00Z", amount=-5000,
    )
    txn_id = txn.json()["id"]

    await client.patch(
        f"/transactions/{txn_id}",
        json={"ts": "2026-03-10T12:00:00Z"},
        headers=headers,
    )

    snapshots = await _get_snapshots_for(account_id)
    snapshot_map = {s.ts: s.balance for s in snapshots}
    assert _midnight(2026, 3, 20) not in snapshot_map
    assert snapshot_map[_midnight(2026, 3, 10)] == -5000
    assert len(snapshots) == 1


async def test_update_transaction_ts_within_same_utc_day_keeps_snapshot_unchanged(client):
    """Changing ts to a different time of the same UTC day re-runs recompute but yields the same snapshot."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = uuid.UUID(account_resp.json()["id"])
    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    txn = await _create_transaction(
        client, headers, str(account_id), category_id,
        ts="2026-03-15T09:00:00Z", amount=-5000,
    )
    txn_id = txn.json()["id"]

    before = [(s.ts, s.balance) for s in await _get_snapshots_for(account_id)]

    # Same UTC day, different time of day
    await client.patch(
        f"/transactions/{txn_id}",
        json={"ts": "2026-03-15T18:30:00Z"},
        headers=headers,
    )

    after = [(s.ts, s.balance) for s in await _get_snapshots_for(account_id)]
    assert before == after


async def test_update_transaction_account_id_recomputes_both_accounts(client):
    """Moving a transaction between accounts recomputes both source and destination snapshots."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    src = await _create_account(client, headers, name="Source")
    dst = await _create_account(client, headers, name="Dest")
    src_id = uuid.UUID(src.json()["id"])
    dst_id = uuid.UUID(dst.json()["id"])
    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    txn = await _create_transaction(
        client, headers, str(src_id), category_id,
        ts="2026-03-15T12:00:00Z", amount=-5000,
    )
    txn_id = txn.json()["id"]

    await client.patch(
        f"/transactions/{txn_id}",
        json={"account_id": str(dst_id)},
        headers=headers,
    )

    src_snapshots = await _get_snapshots_for(src_id)
    dst_snapshots = await _get_snapshots_for(dst_id)
    src_map = {s.ts: s.balance for s in src_snapshots}
    dst_map = {s.ts: s.balance for s in dst_snapshots}

    # Source loses the moved txn's day; with no other txns it ends up with no snapshots
    assert _midnight(2026, 3, 15) not in src_map
    assert len(src_snapshots) == 0
    # Destination gains the moved txn's day
    assert dst_map[_midnight(2026, 3, 15)] == -5000
    assert len(dst_snapshots) == 1


async def test_update_transaction_account_id_and_ts_recomputes_both_with_correct_anchors(client):
    """Moving a transaction across accounts AND days uses old_ts for source and new_ts for destination."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    src = await _create_account(client, headers, name="Source")
    dst = await _create_account(client, headers, name="Dest")
    src_id = uuid.UUID(src.json()["id"])
    dst_id = uuid.UUID(dst.json()["id"])
    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    # Source has a fixed earlier transaction plus the one we'll move
    await _create_transaction(
        client, headers, str(src_id), category_id,
        ts="2026-03-05T10:00:00Z", amount=10000,
    )
    moving = await _create_transaction(
        client, headers, str(src_id), category_id,
        ts="2026-03-15T10:00:00Z", amount=-3000,
    )
    moving_id = moving.json()["id"]

    await client.patch(
        f"/transactions/{moving_id}",
        json={"account_id": str(dst_id), "ts": "2026-03-20T10:00:00Z"},
        headers=headers,
    )

    src_snapshots = await _get_snapshots_for(src_id)
    dst_snapshots = await _get_snapshots_for(dst_id)
    src_map = {s.ts: s.balance for s in src_snapshots}
    dst_map = {s.ts: s.balance for s in dst_snapshots}

    # Source: only the un-moved earlier txn remains
    assert src_map[_midnight(2026, 3, 5)] == 10000
    assert _midnight(2026, 3, 15) not in src_map
    assert len(src_snapshots) == 1
    # Destination: the moved txn lands on its new day
    assert dst_map[_midnight(2026, 3, 20)] == -3000
    assert len(dst_snapshots) == 1


async def test_update_account_move_into_dst_with_existing_history_recomputes_running_balance(client):
    """Moving a transaction into a destination with existing history rebuilds dst's later running balances."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    src = await _create_account(client, headers, name="Source")
    dst = await _create_account(client, headers, name="Dest")
    src_id = uuid.UUID(src.json()["id"])
    dst_id = uuid.UUID(dst.json()["id"])
    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    # Destination already has activity bracketing the move's target day
    await _create_transaction(
        client, headers, str(dst_id), category_id,
        ts="2026-03-10T12:00:00Z", amount=5000,
    )
    await _create_transaction(
        client, headers, str(dst_id), category_id,
        ts="2026-03-20T12:00:00Z", amount=-1000,
    )

    # Source has a transaction on day 15 that we'll move into the middle of dst
    moving = await _create_transaction(
        client, headers, str(src_id), category_id,
        ts="2026-03-15T12:00:00Z", amount=2000,
    )
    moving_id = moving.json()["id"]

    await client.patch(
        f"/transactions/{moving_id}",
        json={"account_id": str(dst_id)},
        headers=headers,
    )

    dst_snapshots = await _get_snapshots_for(dst_id)
    dst_map = {s.ts: s.balance for s in dst_snapshots}

    # day 10 unchanged, day 15 lands the moved txn (5000 + 2000),
    # day 20 reflects the new running balance forward (7000 - 1000)
    assert dst_map[_midnight(2026, 3, 10)] == 5000
    assert dst_map[_midnight(2026, 3, 15)] == 7000
    assert dst_map[_midnight(2026, 3, 20)] == 6000
    assert len(dst_snapshots) == 3


async def test_update_amount_does_not_create_snapshots_for_unrelated_days(client):
    """Updating one day's amount does not write snapshots for days without activity."""
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
    txn2 = await _create_transaction(
        client, headers, str(account_id), category_id,
        ts="2026-03-02T10:00:00Z", amount=-2000,
    )
    await _create_transaction(
        client, headers, str(account_id), category_id,
        ts="2026-03-03T10:00:00Z", amount=-3000,
    )

    txn2_id = txn2.json()["id"]
    await client.patch(f"/transactions/{txn2_id}", json={"amount": -1000}, headers=headers)

    snapshots = await _get_snapshots_for(account_id)
    # Exactly 3 days, no phantom rows for skipped days
    assert len(snapshots) == 3


async def test_update_transaction_notes_only_does_not_change_snapshots(client):
    """Updating only non-balance fields leaves balance snapshots untouched."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = uuid.UUID(account_resp.json()["id"])
    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    txn = await _create_transaction(
        client, headers, str(account_id), category_id,
        ts="2026-03-15T12:00:00Z", amount=-5000,
    )
    txn_id = txn.json()["id"]

    before = [(s.ts, s.balance) for s in await _get_snapshots_for(account_id)]
    await client.patch(f"/transactions/{txn_id}", json={"notes": "groceries"}, headers=headers)
    after = [(s.ts, s.balance) for s in await _get_snapshots_for(account_id)]

    assert before == after


async def test_update_transaction_tags_only_does_not_change_snapshots(client):
    """Updating only tag_ids leaves balance snapshots untouched."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = uuid.UUID(account_resp.json()["id"])
    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    tag_resp = await client.post("/tags", json={"name": "reimbursable"}, headers=headers)
    tag_id = tag_resp.json()["id"]

    txn = await _create_transaction(
        client, headers, str(account_id), category_id,
        ts="2026-03-15T12:00:00Z", amount=-5000,
    )
    txn_id = txn.json()["id"]

    before = [(s.ts, s.balance) for s in await _get_snapshots_for(account_id)]
    await client.patch(f"/transactions/{txn_id}", json={"tag_ids": [tag_id]}, headers=headers)
    after = [(s.ts, s.balance) for s in await _get_snapshots_for(account_id)]

    assert before == after


async def test_failed_update_with_invalid_category_does_not_change_snapshots(client):
    """A 422 update due to bad category leaves snapshots unchanged even when amount was sent."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = uuid.UUID(account_resp.json()["id"])
    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    txn = await _create_transaction(
        client, headers, str(account_id), category_id,
        ts="2026-03-15T12:00:00Z", amount=-5000,
    )
    txn_id = txn.json()["id"]

    before = [(s.ts, s.balance) for s in await _get_snapshots_for(account_id)]

    # Send both a valid amount change AND an invalid category — the 422 must
    # short-circuit before recompute, leaving snapshots untouched
    bogus_category_id = "00000000-0000-0000-0000-000000000000"
    resp = await client.patch(
        f"/transactions/{txn_id}",
        json={"amount": -9999, "category_id": bogus_category_id},
        headers=headers,
    )
    assert resp.status_code == 422

    after = [(s.ts, s.balance) for s in await _get_snapshots_for(account_id)]
    assert before == after


async def test_failed_move_to_closed_account_leaves_both_account_snapshots_unchanged(client):
    """A 422 from moving to a closed account must not touch either account's snapshots."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    src = await _create_account(client, headers, name="Source")
    dst = await _create_account(client, headers, name="Dest")
    src_id = uuid.UUID(src.json()["id"])
    dst_id = uuid.UUID(dst.json()["id"])

    # Close dst
    close_resp = await client.patch(
        f"/accounts/{dst_id}",
        json={"closed_at": "2026-03-01T00:00:00Z"},
        headers=headers,
    )
    assert close_resp.status_code == 200

    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    txn = await _create_transaction(
        client, headers, str(src_id), category_id,
        ts="2026-03-15T12:00:00Z", amount=-5000,
    )
    txn_id = txn.json()["id"]

    src_before = [(s.ts, s.balance) for s in await _get_snapshots_for(src_id)]
    dst_before = [(s.ts, s.balance) for s in await _get_snapshots_for(dst_id)]

    resp = await client.patch(
        f"/transactions/{txn_id}",
        json={"account_id": str(dst_id)},
        headers=headers,
    )
    assert resp.status_code == 422

    src_after = [(s.ts, s.balance) for s in await _get_snapshots_for(src_id)]
    dst_after = [(s.ts, s.balance) for s in await _get_snapshots_for(dst_id)]

    assert src_before == src_after
    assert dst_before == dst_after


async def test_update_group_account_transaction_recomputes_snapshots(client):
    """Updating a transaction on a group account recomputes that account's snapshots."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    group_resp = await client.post("/groups", json={"name": "Smith Family"}, headers=headers)
    group_id = group_resp.json()["id"]

    account_resp = await _create_account(client, headers, group_id=group_id)
    account_id = uuid.UUID(account_resp.json()["id"])
    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    txn = await _create_transaction(
        client, headers, str(account_id), category_id,
        ts="2026-03-15T12:00:00Z", amount=-5000,
    )
    txn_id = txn.json()["id"]

    await client.patch(f"/transactions/{txn_id}", json={"amount": -7500}, headers=headers)

    snapshots = await _get_snapshots_for(account_id)
    snapshot_map = {s.ts: s.balance for s in snapshots}
    assert snapshot_map[_midnight(2026, 3, 15)] == -7500
    assert len(snapshots) == 1


# --- Snapshot recomputation on transaction delete ---


async def test_delete_only_transaction_on_day_removes_snapshot(client):
    """Deleting the only transaction on a day removes that day's snapshot."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = uuid.UUID(account_resp.json()["id"])
    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    txn = await _create_transaction(
        client, headers, str(account_id), category_id,
        ts="2026-03-15T12:00:00Z", amount=-5000,
    )
    txn_id = txn.json()["id"]

    await client.delete(f"/transactions/{txn_id}", headers=headers)

    snapshots = await _get_snapshots_for(account_id)
    snapshot_map = {s.ts: s.balance for s in snapshots}
    assert _midnight(2026, 3, 15) not in snapshot_map
    # The retroactive create wiped the original creation-day anchor; deleting
    # the only txn now leaves the account with no snapshots at all.
    assert len(snapshots) == 0


async def test_delete_one_of_multiple_same_day_transactions_adjusts_balance(client):
    """Deleting one of multiple same-day transactions keeps the snapshot but adjusts the balance."""
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
    txn2 = await _create_transaction(
        client, headers, str(account_id), category_id,
        ts="2026-03-15T15:00:00Z", amount=-3000,
    )
    txn2_id = txn2.json()["id"]

    await client.delete(f"/transactions/{txn2_id}", headers=headers)

    snapshots = await _get_snapshots_for(account_id)
    snapshot_map = {s.ts: s.balance for s in snapshots}
    assert snapshot_map[_midnight(2026, 3, 15)] == 10000
    assert len(snapshots) == 1


async def test_delete_transaction_with_later_days_adjusts_balances(client):
    """Deleting a transaction adjusts running balances on all later days."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = uuid.UUID(account_resp.json()["id"])
    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    txn1 = await _create_transaction(
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

    txn1_id = txn1.json()["id"]
    await client.delete(f"/transactions/{txn1_id}", headers=headers)

    snapshots = await _get_snapshots_for(account_id)
    snapshot_map = {s.ts: s.balance for s in snapshots}
    assert _midnight(2026, 3, 1) not in snapshot_map
    assert snapshot_map[_midnight(2026, 3, 2)] == -2000
    assert snapshot_map[_midnight(2026, 3, 3)] == -5000
    assert len(snapshots) == 2


async def test_delete_group_account_transaction_recomputes_snapshots(client):
    """Deleting a transaction on a group account recomputes that account's snapshots."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    group_resp = await client.post("/groups", json={"name": "Smith Family"}, headers=headers)
    group_id = group_resp.json()["id"]

    account_resp = await _create_account(client, headers, group_id=group_id)
    account_id = uuid.UUID(account_resp.json()["id"])
    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    txn = await _create_transaction(
        client, headers, str(account_id), category_id,
        ts="2026-03-15T12:00:00Z", amount=-5000,
    )
    txn_id = txn.json()["id"]

    await client.delete(f"/transactions/{txn_id}", headers=headers)

    snapshots = await _get_snapshots_for(account_id)
    snapshot_map = {s.ts: s.balance for s in snapshots}
    assert _midnight(2026, 3, 15) not in snapshot_map
    assert len(snapshots) == 0


# --- Helpers for the snapshots endpoint ---

NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000"


async def _create_second_user(client):
    """Sign up a second user and return (auth_headers, user_id)."""
    resp = await client.post("/auth/signup", json={
        "email": "other@example.com",
        "password": "securepassword123",
        "first_name": "Other",
        "tz": "America/Toronto",
        "base_currency": "CAD",
    })
    return _get_auth_header(resp), resp.json()["user"]["id"]


async def _create_group(client, headers):
    """Create a group and return its id."""
    resp = await client.post("/groups", json={"name": "Smith Family"}, headers=headers)
    return resp.json()["id"]


async def _grant_account_permission(client, admin_headers, account_id, user_id, level):
    """Grant a user a permission level on a group account."""
    return await client.post(
        f"/accounts/{account_id}/permissions",
        json={"user_id": user_id, "level": level},
        headers=admin_headers,
    )


async def _seed_three_day_history(client, headers, account_id):
    """Create transactions on 3/1, 3/5, and 3/10 so the account has 3 snapshots."""
    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]
    await _create_transaction(
        client, headers, account_id, category_id,
        ts="2026-03-01T10:00:00Z", amount=1000,
    )
    await _create_transaction(
        client, headers, account_id, category_id,
        ts="2026-03-05T10:00:00Z", amount=2000,
    )
    await _create_transaction(
        client, headers, account_id, category_id,
        ts="2026-03-10T10:00:00Z", amount=3000,
    )


# --- GET /accounts/{account_id}/snapshots — listing and date filters ---


async def test_list_snapshots_returns_all_in_ascending_order(client):
    """The endpoint returns every snapshot for the account ordered ts ascending."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = account_resp.json()["id"]
    await _seed_three_day_history(client, headers, account_id)

    resp = await client.get(f"/accounts/{account_id}/snapshots", headers=headers)
    assert resp.status_code == 200

    snapshots = resp.json()
    assert len(snapshots) == 3
    timestamps = [s["ts"] for s in snapshots]
    assert timestamps == sorted(timestamps)
    assert snapshots[0]["balance"] == 1000
    assert snapshots[1]["balance"] == 3000
    assert snapshots[2]["balance"] == 6000


async def test_list_snapshots_filters_by_from_date(client):
    """from_date excludes snapshots strictly before the bound (inclusive boundary).

    Passing from_date equal to a snapshot's ts includes that snapshot.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = account_resp.json()["id"]
    await _seed_three_day_history(client, headers, account_id)

    resp = await client.get(
        f"/accounts/{account_id}/snapshots",
        params={"from_date": "2026-03-05T00:00:00Z"},
        headers=headers,
    )
    assert resp.status_code == 200

    snapshots = resp.json()
    assert len(snapshots) == 2
    assert snapshots[0]["balance"] == 3000
    assert snapshots[1]["balance"] == 6000


async def test_list_snapshots_filters_by_to_date(client):
    """to_date excludes snapshots strictly after the bound (inclusive boundary).

    Passing to_date equal to a snapshot's ts includes that snapshot.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = account_resp.json()["id"]
    await _seed_three_day_history(client, headers, account_id)

    resp = await client.get(
        f"/accounts/{account_id}/snapshots",
        params={"to_date": "2026-03-05T00:00:00Z"},
        headers=headers,
    )
    assert resp.status_code == 200

    snapshots = resp.json()
    assert len(snapshots) == 2
    assert snapshots[0]["balance"] == 1000
    assert snapshots[1]["balance"] == 3000


async def test_list_snapshots_filters_by_both_date_bounds(client):
    """Both bounds combined return only snapshots inside the inclusive range."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = account_resp.json()["id"]
    await _seed_three_day_history(client, headers, account_id)

    resp = await client.get(
        f"/accounts/{account_id}/snapshots",
        params={
            "from_date": "2026-03-04T00:00:00Z",
            "to_date": "2026-03-06T00:00:00Z",
        },
        headers=headers,
    )
    assert resp.status_code == 200

    snapshots = resp.json()
    assert len(snapshots) == 1
    assert snapshots[0]["balance"] == 3000


async def test_list_snapshots_with_zero_width_date_range_returns_only_that_day(client):
    """from_date == to_date covering one snapshot's day returns exactly that snapshot."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = account_resp.json()["id"]
    await _seed_three_day_history(client, headers, account_id)

    # Both bounds at midnight UTC of day 5 — the snapshot's ts is exactly that
    resp = await client.get(
        f"/accounts/{account_id}/snapshots",
        params={
            "from_date": "2026-03-05T00:00:00Z",
            "to_date": "2026-03-05T00:00:00Z",
        },
        headers=headers,
    )
    assert resp.status_code == 200

    snapshots = resp.json()
    assert len(snapshots) == 1
    assert snapshots[0]["balance"] == 3000


async def test_list_snapshots_returns_empty_when_no_snapshots_in_range(client):
    """A date range that excludes all snapshots returns an empty list, not 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = account_resp.json()["id"]
    await _seed_three_day_history(client, headers, account_id)

    resp = await client.get(
        f"/accounts/{account_id}/snapshots",
        params={
            "from_date": "2027-01-01T00:00:00Z",
            "to_date": "2027-12-31T00:00:00Z",
        },
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_snapshots_returns_zero_anchor_for_new_account(client):
    """A brand-new account with no transactions returns just the zero anchor on its creation day."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = account_resp.json()["id"]
    expected_anchor_ts = _creation_day_midnight(account_resp)

    resp = await client.get(f"/accounts/{account_id}/snapshots", headers=headers)
    assert resp.status_code == 200

    snapshots = resp.json()
    assert len(snapshots) == 1
    assert snapshots[0]["balance"] == 0
    assert datetime.fromisoformat(snapshots[0]["ts"]) == expected_anchor_ts


async def test_list_snapshots_on_closed_account_still_returns_history(client):
    """Read-only endpoint must return snapshots even after the account is closed.

    Closed accounts are still meaningful for historical balance charts; the
    handler intentionally does NOT pass require_open=True to check_account_access.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = account_resp.json()["id"]
    await _seed_three_day_history(client, headers, account_id)

    # Close the account
    close_resp = await client.patch(
        f"/accounts/{account_id}",
        json={"closed_at": "2026-04-01T00:00:00Z"},
        headers=headers,
    )
    assert close_resp.status_code == 200

    resp = await client.get(f"/accounts/{account_id}/snapshots", headers=headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 3


# --- GET /accounts/{account_id}/snapshots — validation ---


async def test_list_snapshots_with_inverted_date_range_returns_422(client):
    """from_date later than to_date is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = account_resp.json()["id"]

    resp = await client.get(
        f"/accounts/{account_id}/snapshots",
        params={
            "from_date": "2026-04-01T00:00:00Z",
            "to_date": "2026-03-01T00:00:00Z",
        },
        headers=headers,
    )
    assert resp.status_code == 422


async def test_list_snapshots_with_invalid_date_format_returns_422(client):
    """A malformed date string is rejected by FastAPI's query validation."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = account_resp.json()["id"]

    resp = await client.get(
        f"/accounts/{account_id}/snapshots",
        params={"from_date": "not-a-date"},
        headers=headers,
    )
    assert resp.status_code == 422


# --- GET /accounts/{account_id}/snapshots — auth and permissions ---


async def test_list_snapshots_unauthenticated_returns_401(client):
    """Anonymous requests are rejected before reaching the handler."""
    resp = await client.get(f"/accounts/{NONEXISTENT_ID}/snapshots")
    assert resp.status_code == 401


async def test_list_snapshots_unknown_account_returns_404(client):
    """A nonexistent account UUID returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(f"/accounts/{NONEXISTENT_ID}/snapshots", headers=headers)
    assert resp.status_code == 404


async def test_list_snapshots_other_users_personal_account_returns_404(client):
    """A second user cannot enumerate the existence of a personal account they don't own."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    account_resp = await _create_account(client, headers)
    account_id = account_resp.json()["id"]

    other_headers, _ = await _create_second_user(client)

    resp = await client.get(f"/accounts/{account_id}/snapshots", headers=other_headers)
    assert resp.status_code == 404


async def test_list_snapshots_personal_owner_can_read_own_account(client):
    """A personal account owner can read their own snapshots."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = account_resp.json()["id"]

    resp = await client.get(f"/accounts/{account_id}/snapshots", headers=headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["balance"] == 0


async def test_list_snapshots_group_admin_can_read_group_account(client):
    """A group admin has implicit access to read group account snapshots."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, admin_headers)
    account_resp = await _create_account(client, admin_headers, group_id=group_id)
    account_id = account_resp.json()["id"]

    resp = await client.get(f"/accounts/{account_id}/snapshots", headers=admin_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["balance"] == 0


async def test_list_snapshots_non_group_user_returns_404(client):
    """A user who is not a member of the account's group at all gets 404.

    Distinct code path from "group member without permission": this user
    fails the membership lookup before any AccountPermission check.
    """
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, admin_headers)
    account_resp = await _create_account(client, admin_headers, group_id=group_id)
    account_id = account_resp.json()["id"]

    # Other user is intentionally NOT added to the group
    other_headers, _ = await _create_second_user(client)

    resp = await client.get(f"/accounts/{account_id}/snapshots", headers=other_headers)
    assert resp.status_code == 404


async def test_list_snapshots_group_member_with_read_permission_can_access(client):
    """A group member granted explicit READ on the account can read its snapshots."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, admin_headers)
    account_resp = await _create_account(client, admin_headers, group_id=group_id)
    account_id = account_resp.json()["id"]

    member_headers, member_user_id = await _create_second_user(client)
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": member_user_id},
        headers=admin_headers,
    )
    await _grant_account_permission(client, admin_headers, account_id, member_user_id, "read")

    resp = await client.get(f"/accounts/{account_id}/snapshots", headers=member_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["balance"] == 0


async def test_list_snapshots_group_member_without_permission_returns_404(client):
    """A group member with no explicit permission on the account gets 404, not 403."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, admin_headers)
    account_resp = await _create_account(client, admin_headers, group_id=group_id)
    account_id = account_resp.json()["id"]

    member_headers, member_user_id = await _create_second_user(client)
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": member_user_id},
        headers=admin_headers,
    )

    resp = await client.get(f"/accounts/{account_id}/snapshots", headers=member_headers)
    assert resp.status_code == 404


async def test_list_snapshots_group_member_with_write_permission_can_read(client):
    """WRITE access implies READ — a member with WRITE can read snapshots."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, admin_headers)
    account_resp = await _create_account(client, admin_headers, group_id=group_id)
    account_id = account_resp.json()["id"]

    member_headers, member_user_id = await _create_second_user(client)
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": member_user_id},
        headers=admin_headers,
    )
    await _grant_account_permission(client, admin_headers, account_id, member_user_id, "write")

    resp = await client.get(f"/accounts/{account_id}/snapshots", headers=member_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["balance"] == 0


async def test_list_snapshots_group_member_with_admin_permission_can_read(client):
    """ADMIN access also implies READ — locks in the WRITE < ADMIN ladder ordering."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, admin_headers)
    account_resp = await _create_account(client, admin_headers, group_id=group_id)
    account_id = account_resp.json()["id"]

    member_headers, member_user_id = await _create_second_user(client)
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": member_user_id},
        headers=admin_headers,
    )
    await _grant_account_permission(client, admin_headers, account_id, member_user_id, "admin")

    resp = await client.get(f"/accounts/{account_id}/snapshots", headers=member_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["balance"] == 0
