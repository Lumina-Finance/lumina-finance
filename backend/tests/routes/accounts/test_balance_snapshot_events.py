"""Route tests for the account balance snapshot endpoints and lifecycle hooks."""
import uuid
from datetime import date, timedelta

from sqlalchemy import select

from app.models.account import AccountBalanceSnapshot
from tests.conftest import TestSession
from tests.routes.accounts._balance_snapshot_helpers import (
    _create_category,
    _create_transaction,
    _creation_day,
    _get_snapshots_for,
    _seed_usd_currency,
)
from tests.routes.support import _create_account, _create_user, _get_auth_header

# --- Zero snapshot seeding on account creation ---


async def test_create_account_seeds_zero_balance_snapshot(client):
    """A new personal account gets a zero-balance snapshot anchoring its history."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(client, headers)
    account_id = uuid.UUID(resp.json()["id"])
    expected_dt = _creation_day(resp)

    snapshots = await _get_snapshots_for(account_id)
    assert len(snapshots) == 1
    assert snapshots[0].balance == 0
    assert snapshots[0].dt == expected_dt


async def test_create_group_account_seeds_zero_balance_snapshot(client):
    """A new group account also gets a zero-balance snapshot."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    group_resp = await client.post("/groups", json={"name": "Smith Family"}, headers=headers)
    group_id = group_resp.json()["id"]

    resp = await _create_account(client, headers, group_id=group_id)
    account_id = uuid.UUID(resp.json()["id"])
    expected_dt = _creation_day(resp)

    snapshots = await _get_snapshots_for(account_id)
    assert len(snapshots) == 1
    assert snapshots[0].balance == 0
    assert snapshots[0].dt == expected_dt


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
    """Transactions dated after the account creation day leave the zero anchor in place

    The anchor exists so the frontend has a starting point at the creation day
    A future-dated transaction is appended forward of the anchor — both rows
    coexist and the anchor remains the earliest snapshot
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = uuid.UUID(account_resp.json()["id"])
    creation_day = _creation_day(account_resp)

    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    # Date well after the creation day so the recompute window starts past the zero anchor on any run date
    future_dt = creation_day + timedelta(days=30)
    await _create_transaction(
        client, headers, str(account_id), category_id,
        dt=future_dt.isoformat(), amount=5000,
    )

    snapshots = await _get_snapshots_for(account_id)
    snapshot_map = {s.dt: s.balance for s in snapshots}
    # Zero anchor is preserved as the earliest snapshot
    assert snapshot_map[creation_day] == 0
    # New txn day carries the running balance from the anchor (0 + 5000)
    assert snapshot_map[future_dt] == 5000
    assert len(snapshots) == 2


async def test_create_transaction_before_creation_day_replaces_zero_anchor(client):
    """Transactions dated before the account creation day replace the zero anchor

    The recompute window starts at the transaction's day, which wipes any
    snapshots at or after that day — including the original creation-day
    anchor. The earliest transaction becomes the new anchor
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = uuid.UUID(account_resp.json()["id"])
    creation_day = _creation_day(account_resp)

    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    # Past date — recompute starts at this day and wipes the creation-day anchor
    await _create_transaction(
        client, headers, str(account_id), category_id,
        dt="2026-03-15", amount=5000,
    )

    snapshots = await _get_snapshots_for(account_id)
    snapshot_map = {s.dt: s.balance for s in snapshots}
    assert creation_day not in snapshot_map
    assert snapshot_map[date(2026, 3, 15)] == 5000
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
        dt="2026-03-15", amount=-5000,
    )

    snapshots = await _get_snapshots_for(account_id)
    snapshot_map = {s.dt: s.balance for s in snapshots}
    assert snapshot_map[date(2026, 3, 15)] == -5000
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
        dt="2026-03-15", amount=10000,
    )
    await _create_transaction(
        client, headers, str(account_id), category_id,
        dt="2026-03-15", amount=-3000,
    )

    snapshots = await _get_snapshots_for(account_id)
    assert len(snapshots) == 1
    assert snapshots[0].dt == date(2026, 3, 15)
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
        dt="2026-03-01", amount=10000,
    )
    await _create_transaction(
        client, headers, str(account_id), category_id,
        dt="2026-03-02", amount=-2000,
    )
    await _create_transaction(
        client, headers, str(account_id), category_id,
        dt="2026-03-03", amount=-3000,
    )

    snapshots = await _get_snapshots_for(account_id)
    snapshot_map = {s.dt: s.balance for s in snapshots}
    assert snapshot_map[date(2026, 3, 1)] == 10000
    assert snapshot_map[date(2026, 3, 2)] == 8000
    assert snapshot_map[date(2026, 3, 3)] == 5000
    assert len(snapshots) == 3


async def test_failed_create_transaction_with_invalid_currency_leaves_no_snapshot(client):
    """A 422 transaction create due to bad currency leaves no orphan snapshot rows."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = uuid.UUID(account_resp.json()["id"])

    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    before = [(s.dt, s.balance) for s in await _get_snapshots_for(account_id)]

    resp = await _create_transaction(
        client, headers, str(account_id), category_id,
        dt="2026-03-15", amount=-5000, currency="ZZZ",
    )
    assert resp.status_code == 422

    after = [(s.dt, s.balance) for s in await _get_snapshots_for(account_id)]
    assert before == after


async def test_fx_rate_is_metadata_and_does_not_affect_snapshot_balance(client):
    """fx_rate is metadata; the snapshot must use Transaction.amount as-is

    fx_rate and currency are metadata about the original receipt; the
    Transaction.amount field is already denominated in the account's base
    currency. The snapshot service must therefore sum amounts directly and
    must NOT multiply by fx_rate
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
    # preserved as metadata
    await _create_transaction(
        client, headers, str(account_id), category_id,
        dt="2026-03-15", amount=14000, currency="USD", fx_rate=1.4,
    )

    snapshots = await _get_snapshots_for(account_id)
    snapshot_map = {s.dt: s.balance for s in snapshots}
    # Snapshot equals the stored amount (14000 CAD cents), NOT 14000 * 1.4
    assert snapshot_map[date(2026, 3, 15)] == 14000


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
        dt="2026-03-15", amount=-5000,
    )
    txn_id = txn_resp.json()["id"]

    await client.patch(f"/transactions/{txn_id}", json={"amount": -8000}, headers=headers)

    snapshots = await _get_snapshots_for(account_id)
    snapshot_map = {s.dt: s.balance for s in snapshots}
    assert snapshot_map[date(2026, 3, 15)] == -8000
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
        dt="2026-03-01", amount=10000,
    )
    await _create_transaction(
        client, headers, str(account_id), category_id,
        dt="2026-03-02", amount=-2000,
    )
    await _create_transaction(
        client, headers, str(account_id), category_id,
        dt="2026-03-03", amount=-3000,
    )

    txn1_id = txn1.json()["id"]
    await client.patch(f"/transactions/{txn1_id}", json={"amount": 20000}, headers=headers)

    snapshots = await _get_snapshots_for(account_id)
    snapshot_map = {s.dt: s.balance for s in snapshots}
    assert snapshot_map[date(2026, 3, 1)] == 20000
    assert snapshot_map[date(2026, 3, 2)] == 18000
    assert snapshot_map[date(2026, 3, 3)] == 15000
    assert len(snapshots) == 3


async def test_update_transaction_dt_to_later_day_moves_snapshot(client):
    """Moving a transaction's ts to a later day removes the original day's snapshot."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = uuid.UUID(account_resp.json()["id"])
    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    txn = await _create_transaction(
        client, headers, str(account_id), category_id,
        dt="2026-03-15", amount=-5000,
    )
    txn_id = txn.json()["id"]

    await client.patch(
        f"/transactions/{txn_id}",
        json={"dt": "2026-03-20"},
        headers=headers,
    )

    snapshots = await _get_snapshots_for(account_id)
    snapshot_map = {s.dt: s.balance for s in snapshots}
    assert date(2026, 3, 15) not in snapshot_map
    assert snapshot_map[date(2026, 3, 20)] == -5000
    assert len(snapshots) == 1


async def test_update_transaction_dt_to_earlier_day_recomputes_from_earlier_day(client):
    """Moving a transaction's ts backwards rebuilds snapshots from the earlier day forward."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = uuid.UUID(account_resp.json()["id"])
    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    txn = await _create_transaction(
        client, headers, str(account_id), category_id,
        dt="2026-03-20", amount=-5000,
    )
    txn_id = txn.json()["id"]

    await client.patch(
        f"/transactions/{txn_id}",
        json={"dt": "2026-03-10"},
        headers=headers,
    )

    snapshots = await _get_snapshots_for(account_id)
    snapshot_map = {s.dt: s.balance for s in snapshots}
    assert date(2026, 3, 20) not in snapshot_map
    assert snapshot_map[date(2026, 3, 10)] == -5000
    assert len(snapshots) == 1


async def test_update_transaction_dt_within_same_day_keeps_snapshot_unchanged(client):
    """Updating dt to the same date re-runs recompute but yields the same snapshot."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = uuid.UUID(account_resp.json()["id"])
    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    txn = await _create_transaction(
        client, headers, str(account_id), category_id,
        dt="2026-03-15", amount=-5000,
    )
    txn_id = txn.json()["id"]

    before = [(s.dt, s.balance) for s in await _get_snapshots_for(account_id)]

    await client.patch(
        f"/transactions/{txn_id}",
        json={"dt": "2026-03-15"},
        headers=headers,
    )

    after = [(s.dt, s.balance) for s in await _get_snapshots_for(account_id)]
    assert before == after


async def test_update_transaction_account_id_recomputes_both_accounts(client):
    """Moving a transaction between accounts recomputes both source and destination snapshots."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    src = await _create_account(client, headers, name="Source")
    dst = await _create_account(client, headers, name="Dest")
    src_id = uuid.UUID(src.json()["id"])
    dst_id = uuid.UUID(dst.json()["id"])
    src_creation_day = _creation_day(src)
    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    txn = await _create_transaction(
        client, headers, str(src_id), category_id,
        dt="2026-03-15", amount=-5000,
    )
    txn_id = txn.json()["id"]

    await client.patch(
        f"/transactions/{txn_id}",
        json={"account_id": str(dst_id)},
        headers=headers,
    )

    src_snapshots = await _get_snapshots_for(src_id)
    dst_snapshots = await _get_snapshots_for(dst_id)
    src_map = {s.dt: s.balance for s in src_snapshots}
    dst_map = {s.dt: s.balance for s in dst_snapshots}

    # Source loses the moved txn's day; with no other txns it keeps its zero anchor
    assert date(2026, 3, 15) not in src_map
    assert src_map[src_creation_day] == 0
    assert len(src_snapshots) == 1
    # Destination gains the moved txn's day
    assert dst_map[date(2026, 3, 15)] == -5000
    assert len(dst_snapshots) == 1


async def test_update_transaction_account_id_and_dt_recomputes_both_with_correct_anchors(client):
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
        dt="2026-03-05", amount=10000,
    )
    moving = await _create_transaction(
        client, headers, str(src_id), category_id,
        dt="2026-03-15", amount=-3000,
    )
    moving_id = moving.json()["id"]

    await client.patch(
        f"/transactions/{moving_id}",
        json={"account_id": str(dst_id), "dt": "2026-03-20"},
        headers=headers,
    )

    src_snapshots = await _get_snapshots_for(src_id)
    dst_snapshots = await _get_snapshots_for(dst_id)
    src_map = {s.dt: s.balance for s in src_snapshots}
    dst_map = {s.dt: s.balance for s in dst_snapshots}

    # Source: only the un-moved earlier txn remains
    assert src_map[date(2026, 3, 5)] == 10000
    assert date(2026, 3, 15) not in src_map
    assert len(src_snapshots) == 1
    # Destination: the moved txn lands on its new day
    assert dst_map[date(2026, 3, 20)] == -3000
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
        dt="2026-03-10", amount=5000,
    )
    await _create_transaction(
        client, headers, str(dst_id), category_id,
        dt="2026-03-20", amount=-1000,
    )

    # Source has a transaction on day 15 that we'll move into the middle of dst
    moving = await _create_transaction(
        client, headers, str(src_id), category_id,
        dt="2026-03-15", amount=2000,
    )
    moving_id = moving.json()["id"]

    await client.patch(
        f"/transactions/{moving_id}",
        json={"account_id": str(dst_id)},
        headers=headers,
    )

    dst_snapshots = await _get_snapshots_for(dst_id)
    dst_map = {s.dt: s.balance for s in dst_snapshots}

    # day 10 unchanged, day 15 lands the moved txn (5000 + 2000),
    # day 20 reflects the new running balance forward (7000 - 1000)
    assert dst_map[date(2026, 3, 10)] == 5000
    assert dst_map[date(2026, 3, 15)] == 7000
    assert dst_map[date(2026, 3, 20)] == 6000
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
        dt="2026-03-01", amount=10000,
    )
    txn2 = await _create_transaction(
        client, headers, str(account_id), category_id,
        dt="2026-03-02", amount=-2000,
    )
    await _create_transaction(
        client, headers, str(account_id), category_id,
        dt="2026-03-03", amount=-3000,
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
        dt="2026-03-15", amount=-5000,
    )
    txn_id = txn.json()["id"]

    before = [(s.dt, s.balance) for s in await _get_snapshots_for(account_id)]
    await client.patch(f"/transactions/{txn_id}", json={"notes": "groceries"}, headers=headers)
    after = [(s.dt, s.balance) for s in await _get_snapshots_for(account_id)]

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
        dt="2026-03-15", amount=-5000,
    )
    txn_id = txn.json()["id"]

    before = [(s.dt, s.balance) for s in await _get_snapshots_for(account_id)]
    await client.patch(f"/transactions/{txn_id}", json={"tag_ids": [tag_id]}, headers=headers)
    after = [(s.dt, s.balance) for s in await _get_snapshots_for(account_id)]

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
        dt="2026-03-15", amount=-5000,
    )
    txn_id = txn.json()["id"]

    before = [(s.dt, s.balance) for s in await _get_snapshots_for(account_id)]

    # Send both a valid amount change AND an invalid category — the 422 must
    # short-circuit before recompute, leaving snapshots untouched
    bogus_category_id = "00000000-0000-0000-0000-000000000000"
    resp = await client.patch(
        f"/transactions/{txn_id}",
        json={"amount": -9999, "category_id": bogus_category_id},
        headers=headers,
    )
    assert resp.status_code == 422

    after = [(s.dt, s.balance) for s in await _get_snapshots_for(account_id)]
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
        json={"closed_at": "2026-03-01"},
        headers=headers,
    )
    assert close_resp.status_code == 200

    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    txn = await _create_transaction(
        client, headers, str(src_id), category_id,
        dt="2026-03-15", amount=-5000,
    )
    txn_id = txn.json()["id"]

    src_before = [(s.dt, s.balance) for s in await _get_snapshots_for(src_id)]
    dst_before = [(s.dt, s.balance) for s in await _get_snapshots_for(dst_id)]

    resp = await client.patch(
        f"/transactions/{txn_id}",
        json={"account_id": str(dst_id)},
        headers=headers,
    )
    assert resp.status_code == 422

    src_after = [(s.dt, s.balance) for s in await _get_snapshots_for(src_id)]
    dst_after = [(s.dt, s.balance) for s in await _get_snapshots_for(dst_id)]

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
        dt="2026-03-15", amount=-5000,
    )
    txn_id = txn.json()["id"]

    await client.patch(f"/transactions/{txn_id}", json={"amount": -7500}, headers=headers)

    snapshots = await _get_snapshots_for(account_id)
    snapshot_map = {s.dt: s.balance for s in snapshots}
    assert snapshot_map[date(2026, 3, 15)] == -7500
    assert len(snapshots) == 1


# --- Snapshot recomputation on transaction delete ---


async def test_delete_only_transaction_on_day_removes_snapshot(client):
    """Deleting the only transaction on a day removes that day's snapshot."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = uuid.UUID(account_resp.json()["id"])
    creation_day = _creation_day(account_resp)
    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    txn = await _create_transaction(
        client, headers, str(account_id), category_id,
        dt="2026-03-15", amount=-5000,
    )
    txn_id = txn.json()["id"]

    await client.delete(f"/transactions/{txn_id}", headers=headers)

    snapshots = await _get_snapshots_for(account_id)
    snapshot_map = {s.dt: s.balance for s in snapshots}
    assert date(2026, 3, 15) not in snapshot_map
    assert snapshot_map[creation_day] == 0
    assert len(snapshots) == 1

    accounts_resp = await client.get("/accounts", headers=headers)
    assert accounts_resp.status_code == 200
    assert accounts_resp.json()[0]["current_balance"] == 0

    dashboard_resp = await client.get("/dashboard/net-worth", headers=headers)
    assert dashboard_resp.status_code == 200
    assert dashboard_resp.json()["current_net_worth"] == 0


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
        dt="2026-03-15", amount=10000,
    )
    txn2 = await _create_transaction(
        client, headers, str(account_id), category_id,
        dt="2026-03-15", amount=-3000,
    )
    txn2_id = txn2.json()["id"]

    await client.delete(f"/transactions/{txn2_id}", headers=headers)

    snapshots = await _get_snapshots_for(account_id)
    snapshot_map = {s.dt: s.balance for s in snapshots}
    assert snapshot_map[date(2026, 3, 15)] == 10000
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
        dt="2026-03-01", amount=10000,
    )
    await _create_transaction(
        client, headers, str(account_id), category_id,
        dt="2026-03-02", amount=-2000,
    )
    await _create_transaction(
        client, headers, str(account_id), category_id,
        dt="2026-03-03", amount=-3000,
    )

    txn1_id = txn1.json()["id"]
    await client.delete(f"/transactions/{txn1_id}", headers=headers)

    snapshots = await _get_snapshots_for(account_id)
    snapshot_map = {s.dt: s.balance for s in snapshots}
    assert date(2026, 3, 1) not in snapshot_map
    assert snapshot_map[date(2026, 3, 2)] == -2000
    assert snapshot_map[date(2026, 3, 3)] == -5000
    assert len(snapshots) == 2


async def test_delete_group_account_transaction_recomputes_snapshots(client):
    """Deleting a transaction on a group account recomputes that account's snapshots."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    group_resp = await client.post("/groups", json={"name": "Smith Family"}, headers=headers)
    group_id = group_resp.json()["id"]

    account_resp = await _create_account(client, headers, group_id=group_id)
    account_id = uuid.UUID(account_resp.json()["id"])
    creation_day = _creation_day(account_resp)
    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    txn = await _create_transaction(
        client, headers, str(account_id), category_id,
        dt="2026-03-15", amount=-5000,
    )
    txn_id = txn.json()["id"]

    await client.delete(f"/transactions/{txn_id}", headers=headers)

    snapshots = await _get_snapshots_for(account_id)
    snapshot_map = {s.dt: s.balance for s in snapshots}
    assert date(2026, 3, 15) not in snapshot_map
    assert snapshot_map[creation_day] == 0
    assert len(snapshots) == 1
