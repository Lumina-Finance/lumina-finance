"""Tests for the account balance snapshot recomputation service."""

import asyncio
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import event, select, text

from app.models.account import Account, AccountBalanceSnapshot
from app.models.base import AccountKind, AccountType, CategoryKind
from app.models.category import Category
from app.models.currency import Currency
from app.models.transaction import Transaction
from app.models.user import User
from app.services.accounts import snapshots as snapshots_module
from app.services.accounts.snapshots import recompute_account_snapshots
from tests.conftest import TestSession, engine

# --- Fixtures ---


@pytest.fixture
async def currency(db):
    """Seed a currency for FK references."""
    c = Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2)
    db.add(c)
    await db.flush()
    return c


@pytest.fixture
async def user(db, currency):
    """Seed a user."""
    u = User(email="user@example.com", first_name="Test", tz="America/Toronto", base_currency="CAD")
    db.add(u)
    await db.flush()
    return u


@pytest.fixture
async def account(db, user):
    """Seed a personal checking account."""
    a = Account(
        owner_id=user.id,
        account_kind=AccountKind.ASSET,
        account_type=AccountType.CHECKING,
        name="Chequing",
        currency="CAD",
    )
    db.add(a)
    await db.flush()
    return a


@pytest.fixture
async def second_account(db, user):
    """Seed a second personal account for isolation tests."""
    a = Account(
        owner_id=user.id,
        account_kind=AccountKind.ASSET,
        account_type=AccountType.SAVINGS,
        name="Savings",
        currency="CAD",
    )
    db.add(a)
    await db.flush()
    return a


@pytest.fixture
async def category(db, user):
    """Seed an expense category."""
    c = Category(owner_id=user.id, name="Groceries", kind=CategoryKind.EXPENSE)
    db.add(c)
    await db.flush()
    return c


def _make_transaction(user, account, category, amount, dt):
    """Build a Transaction row with default currency/fx_rate."""
    return Transaction(
        created_by_user_id=user.id,
        account_id=account.id,
        category_id=category.id,
        dt=dt,
        amount=amount,
        currency="CAD",
    )


async def _get_snapshots(db, account_id):
    """Return all snapshots for an account ordered by ts."""
    result = await db.execute(
        select(AccountBalanceSnapshot).where(AccountBalanceSnapshot.account_id == account_id).order_by(AccountBalanceSnapshot.dt),
    )
    return list(result.scalars().all())


async def _wait_until_blocked(blocker_pid, blocked_pid):
    """Wait until PostgreSQL reports one backend blocked by another."""
    async with asyncio.timeout(5):
        async with TestSession() as observer:
            while blocker_pid not in await observer.scalar(
                text("SELECT pg_blocking_pids(:pid)"),
                {"pid": blocked_pid},
            ):
                await asyncio.sleep(0.01)


# --- Tests ---


async def test_recompute_restores_zero_anchor_from_owner_local_created_at(db, user, category):
    """Creation anchors use the account owner's local date, not the UTC date."""
    account = Account(
        owner_id=user.id,
        account_kind=AccountKind.ASSET,
        account_type=AccountType.CHECKING,
        name="Boundary",
        currency="CAD",
        created_at=datetime(2026, 1, 1, 2, 0, tzinfo=UTC),
    )
    db.add(account)
    await db.flush()

    await recompute_account_snapshots(db, {account.id: date(2026, 1, 1)})

    snapshots = await _get_snapshots(db, account.id)
    assert [(s.dt, s.balance) for s in snapshots] == [(date(2025, 12, 31), 0)]


async def test_recompute_anchor_carries_forward_from_earlier_snapshot(db, user, account, category):
    """An existing snapshot before from_dt acts as the anchor balance."""
    db.add(AccountBalanceSnapshot(account_id=account.id, dt=date(2026, 2, 28), balance=5000))
    db.add(_make_transaction(user, account, category, -1000, date(2026, 3, 1)))
    await db.flush()

    await recompute_account_snapshots(db, {account.id: date(2026, 3, 1)})

    snapshots = await _get_snapshots(db, account.id)
    assert [(s.dt, s.balance) for s in snapshots] == [
        (date(2026, 2, 28), 5000),
        (date(2026, 3, 1), 4000),
    ]


async def test_recompute_replaces_stale_snapshots_in_range(db, user, account, category):
    """Stale snapshots on or after from_dt are wiped and rebuilt

    Covers the case where a stale snapshot sits between two legitimate
    days — the day with no transactions should end up without any snapshot
    """
    db.add(AccountBalanceSnapshot(account_id=account.id, dt=date(2026, 2, 28), balance=2000))
    # Stale snapshots across the recompute window
    db.add(AccountBalanceSnapshot(account_id=account.id, dt=date(2026, 3, 1), balance=99999))
    db.add(AccountBalanceSnapshot(account_id=account.id, dt=date(2026, 3, 2), balance=88888))
    db.add(AccountBalanceSnapshot(account_id=account.id, dt=date(2026, 3, 3), balance=77777))
    # Real transactions on 3/1 and 3/3; 3/2 has no activity
    db.add_all(
        [
            _make_transaction(user, account, category, 1000, date(2026, 3, 1)),
            _make_transaction(user, account, category, -500, date(2026, 3, 3)),
        ]
    )
    await db.flush()

    await recompute_account_snapshots(db, {account.id: date(2026, 3, 1)})

    snapshots = await _get_snapshots(db, account.id)
    assert [(s.dt, s.balance) for s in snapshots] == [
        (date(2026, 2, 28), 2000),
        (date(2026, 3, 1), 3000),
        (date(2026, 3, 3), 2500),
    ]


async def test_recompute_ignores_transactions_on_other_accounts(
    db,
    user,
    account,
    second_account,
    category,
):
    """Recomputing one account must not touch snapshots for a sibling account."""
    db.add_all(
        [
            _make_transaction(user, account, category, 1000, date(2026, 3, 1)),
            _make_transaction(user, second_account, category, 5000, date(2026, 3, 1)),
        ]
    )
    db.add(
        AccountBalanceSnapshot(
            account_id=second_account.id,
            dt=date(2026, 3, 1),
            balance=5000,
        )
    )
    await db.flush()

    await recompute_account_snapshots(db, {account.id: date(2026, 3, 1)})

    target_snapshots = await _get_snapshots(db, account.id)
    assert [(s.dt, s.balance) for s in target_snapshots] == [(date(2026, 3, 1), 1000)]

    sibling_snapshots = await _get_snapshots(db, second_account.id)
    assert [(s.dt, s.balance) for s in sibling_snapshots] == [(date(2026, 3, 1), 5000)]


async def test_recompute_with_no_activity_on_or_after_from_dt_preserves_earlier_snapshots(
    db,
    account,
):
    """Anchor snapshots strictly before from_dt survive when nothing follows them."""
    db.add(AccountBalanceSnapshot(account_id=account.id, dt=date(2026, 2, 28), balance=5000))
    await db.flush()

    await recompute_account_snapshots(db, {account.id: date(2026, 3, 1)})

    snapshots = await _get_snapshots(db, account.id)
    assert [(s.dt, s.balance) for s in snapshots] == [(date(2026, 2, 28), 5000)]


async def test_recompute_excludes_transactions_before_from_dt(db, user, account, category):
    """Transactions strictly before from_dt must not be summed into the rebuilt window."""
    db.add(AccountBalanceSnapshot(account_id=account.id, dt=date(2026, 3, 1), balance=1000))
    db.add_all(
        [
            _make_transaction(user, account, category, 1000, date(2026, 3, 1)),
            _make_transaction(user, account, category, -200, date(2026, 3, 3)),
        ]
    )
    await db.flush()

    # Recompute from 3/2 — the 3/1 transaction must be ignored
    await recompute_account_snapshots(db, {account.id: date(2026, 3, 2)})

    snapshots = await _get_snapshots(db, account.id)
    assert [(s.dt, s.balance) for s in snapshots] == [
        (date(2026, 3, 1), 1000),
        (date(2026, 3, 3), 800),
    ]


async def test_recompute_writes_snapshot_for_zero_delta_day(db, user, account, category):
    """A day where transactions sum to zero still produces a snapshot row."""
    db.add_all(
        [
            _make_transaction(user, account, category, 1000, date(2026, 3, 1)),
            _make_transaction(user, account, category, -1000, date(2026, 3, 1)),
        ]
    )
    await db.flush()

    await recompute_account_snapshots(db, {account.id: date(2026, 3, 1)})

    snapshots = await _get_snapshots(db, account.id)
    assert [(s.dt, s.balance) for s in snapshots] == [(date(2026, 3, 1), 0)]


async def test_recompute_anchor_balance_of_zero_is_treated_as_anchor(
    db,
    user,
    account,
    category,
):
    """A prior snapshot with balance=0 is a valid anchor, not treated as 'no anchor'."""
    db.add(AccountBalanceSnapshot(account_id=account.id, dt=date(2026, 2, 28), balance=0))
    db.add(_make_transaction(user, account, category, 500, date(2026, 3, 1)))
    await db.flush()

    await recompute_account_snapshots(db, {account.id: date(2026, 3, 1)})

    snapshots = await _get_snapshots(db, account.id)
    assert [(s.dt, s.balance) for s in snapshots] == [
        (date(2026, 2, 28), 0),
        (date(2026, 3, 1), 500),
    ]


async def test_recompute_from_dt_before_any_transaction(db, user, account, category):
    """from_dt far in the past rebuilds from an implicit zero anchor."""
    db.add(_make_transaction(user, account, category, 2000, date(2026, 3, 1)))
    await db.flush()

    await recompute_account_snapshots(db, {account.id: date(2020, 1, 1)})

    snapshots = await _get_snapshots(db, account.id)
    assert [(s.dt, s.balance) for s in snapshots] == [(date(2026, 3, 1), 2000)]


async def test_recompute_empty_map_does_not_flush_pending_changes(db, user, account, category):
    """An empty affected-account map performs no database work."""
    pending = _make_transaction(user, account, category, -1000, date(2026, 3, 1))
    db.add(pending)

    await recompute_account_snapshots(db, {})

    assert pending in db.new


async def test_recompute_acquires_deduplicated_lock_keys_in_numeric_order(
    db,
    user,
    account,
    second_account,
    category,
    monkeypatch,
):
    """Multi-account rebuilds acquire each advisory key once in numeric order."""
    third_account = Account(
        owner_id=user.id,
        account_kind=AccountKind.ASSET,
        account_type=AccountType.CASH,
        name="Cash",
        currency="CAD",
    )
    db.add(third_account)
    await db.flush()

    lock_keys_by_account = {
        account.id: 9,
        second_account.id: -4,
        third_account.id: -4,
    }

    def controlled_lock_key(account_id):
        """Return test keys that include reverse order and a collision."""
        return lock_keys_by_account[account_id]

    observed_lock_keys = []
    original_execute = db.execute

    async def record_real_execute(statement, *args, **kwargs):
        """Record advisory keys while executing each real database statement."""
        if "pg_advisory_xact_lock" in str(statement):
            observed_lock_keys.append(next(iter(statement.compile().params.values())))
        return await original_execute(statement, *args, **kwargs)

    monkeypatch.setattr(snapshots_module, "_snapshot_lock_key", controlled_lock_key)
    monkeypatch.setattr(db, "execute", record_real_execute)

    await recompute_account_snapshots(
        db,
        {
            account.id: date(2026, 3, 1),
            second_account.id: date(2026, 3, 1),
            third_account.id: date(2026, 3, 1),
        },
    )

    assert observed_lock_keys == [-4, 9]


async def test_recompute_rollback_releases_lock_and_restores_prior_snapshots(
    db,
    user,
    account,
    category,
):
    """Rolling back a held rebuild releases its lock and discards its snapshot rows."""
    transaction = _make_transaction(user, account, category, -1000, date(2026, 3, 1))
    db.add(transaction)
    await recompute_account_snapshots(db, {account.id: date(2026, 3, 1)})
    await db.commit()

    async with TestSession() as holder, TestSession() as waiter:
        held_transaction = await holder.get(Transaction, transaction.id)
        held_transaction.amount = -2000
        holder_pid = await holder.scalar(text("SELECT pg_backend_pid()"))
        waiter_pid = await waiter.scalar(text("SELECT pg_backend_pid()"))
        await recompute_account_snapshots(holder, {account.id: date(2026, 3, 1)})

        waiting_rebuild = asyncio.create_task(
            recompute_account_snapshots(waiter, {account.id: date(2026, 3, 1)}),
        )
        try:
            await _wait_until_blocked(holder_pid, waiter_pid)
            waiting_rebuild.cancel()
            async with asyncio.timeout(5):
                await asyncio.gather(waiting_rebuild, return_exceptions=True)
            await waiter.rollback()
            await holder.rollback()
        finally:
            if not waiting_rebuild.done():
                waiting_rebuild.cancel()
            async with asyncio.timeout(5):
                await asyncio.gather(waiting_rebuild, return_exceptions=True)
            await holder.rollback()
            await waiter.rollback()

    async with TestSession() as observer:
        snapshots = await _get_snapshots(observer, account.id)
    assert [(snapshot.dt, snapshot.balance) for snapshot in snapshots] == [
        (date(2026, 3, 1), -1000),
    ]

    async with TestSession() as after_rollback:
        async with asyncio.timeout(5):
            await recompute_account_snapshots(
                after_rollback,
                {account.id: date(2026, 3, 1)},
            )
            await after_rollback.commit()


async def test_recompute_for_other_account_completes_while_lock_is_held(
    db,
    user,
    account,
    second_account,
    category,
):
    """A held account rebuild does not block an unrelated account rebuild."""
    first_transaction = _make_transaction(user, account, category, -1000, date(2026, 3, 1))
    second_transaction = _make_transaction(user, second_account, category, -2000, date(2026, 3, 1))
    db.add_all([first_transaction, second_transaction])
    await recompute_account_snapshots(
        db,
        {
            account.id: date(2026, 3, 1),
            second_account.id: date(2026, 3, 1),
        },
    )
    await db.commit()

    async with TestSession() as holder, TestSession() as independent:
        held_transaction = await holder.get(Transaction, first_transaction.id)
        held_transaction.amount = -3000
        await recompute_account_snapshots(holder, {account.id: date(2026, 3, 1)})

        independent_transaction = await independent.get(Transaction, second_transaction.id)
        independent_transaction.amount = -4000
        async with asyncio.timeout(2):
            await recompute_account_snapshots(
                independent,
                {second_account.id: date(2026, 3, 1)},
            )
            await independent.commit()
        await holder.rollback()

    async with TestSession() as observer:
        first_snapshots = await _get_snapshots(observer, account.id)
        second_snapshots = await _get_snapshots(observer, second_account.id)
    assert [(snapshot.dt, snapshot.balance) for snapshot in first_snapshots] == [
        (date(2026, 3, 1), -1000),
    ]
    assert [(snapshot.dt, snapshot.balance) for snapshot in second_snapshots] == [
        (date(2026, 3, 1), -4000),
    ]


async def test_recompute_lock_key_collision_serializes_correct_independent_balances(
    db,
    user,
    account,
    second_account,
    category,
    monkeypatch,
):
    """A shared test lock key serializes accounts without mixing their balances."""
    db.add_all(
        [
            _make_transaction(user, account, category, 1000, date(2026, 3, 1)),
            _make_transaction(user, second_account, category, 2000, date(2026, 3, 1)),
        ]
    )
    await recompute_account_snapshots(
        db,
        {
            account.id: date(2026, 3, 1),
            second_account.id: date(2026, 3, 1),
        },
    )
    await db.commit()

    def colliding_lock_key(_account_id):
        """Force every account through one advisory key for this test."""
        return 73

    monkeypatch.setattr(snapshots_module, "_snapshot_lock_key", colliding_lock_key)

    async with TestSession() as holder, TestSession() as waiter:
        holder_pid = await holder.scalar(text("SELECT pg_backend_pid()"))
        waiter_pid = await waiter.scalar(text("SELECT pg_backend_pid()"))
        await recompute_account_snapshots(holder, {account.id: date(2026, 3, 1)})
        waiting_rebuild = asyncio.create_task(
            recompute_account_snapshots(waiter, {second_account.id: date(2026, 3, 1)}),
        )
        try:
            await _wait_until_blocked(holder_pid, waiter_pid)
            await holder.commit()
            async with asyncio.timeout(5):
                await waiting_rebuild
                await waiter.commit()
        finally:
            if not waiting_rebuild.done():
                waiting_rebuild.cancel()
            async with asyncio.timeout(5):
                await asyncio.gather(waiting_rebuild, return_exceptions=True)
            await holder.rollback()
            await waiter.rollback()

    async with TestSession() as observer:
        first_snapshots = await _get_snapshots(observer, account.id)
        second_snapshots = await _get_snapshots(observer, second_account.id)
    assert [(snapshot.dt, snapshot.balance) for snapshot in first_snapshots] == [
        (date(2026, 3, 1), 1000),
    ]
    assert [(snapshot.dt, snapshot.balance) for snapshot in second_snapshots] == [
        (date(2026, 3, 1), 2000),
    ]


async def _seed_daily_history(db, user, account, category, days):
    """Give the account one transaction of 100 on each of the given number of days and build its snapshots"""
    first_day = date(2020, 1, 1)
    transactions = [_make_transaction(user, account, category, 100, first_day + timedelta(days=offset)) for offset in range(days)]
    db.add_all(transactions)
    await recompute_account_snapshots(db, {account.id: first_day})
    return transactions


async def _measure_rebuild(db, account_id, from_dt):
    """Rebuild one account, returning the statements it ran and the snapshot rows it wrote"""
    await db.flush()
    rows_written = text(
        "SELECT coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0) FROM pg_stat_xact_user_tables WHERE relname = 'account_balance_snapshots'",
    )
    rows_before = await db.scalar(rows_written)
    statements = []

    def record(conn, cursor, statement, parameters, context, executemany):
        """Count each statement the rebuild sends"""
        statements.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", record)
    try:
        await recompute_account_snapshots(db, {account_id: from_dt})
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", record)
    return len(statements), await db.scalar(rows_written) - rows_before


async def test_recompute_after_earliest_amount_edit_writes_each_later_day_once_in_fixed_statements(
    db,
    user,
    account,
    second_account,
    category,
):
    """An old amount edit writes each later day once, with as many statements on a long history as a short one"""
    long_history = await _seed_daily_history(db, user, account, category, 1000)
    short_history = await _seed_daily_history(db, user, second_account, category, 3)
    long_history[0].amount = 50
    short_history[0].amount = 50

    long_statements, long_rows = await _measure_rebuild(db, account.id, long_history[0].dt)
    short_statements, short_rows = await _measure_rebuild(db, second_account.id, short_history[0].dt)

    assert long_statements == short_statements, "a long history needs no more statements than a short one"
    assert (long_rows, short_rows) == (1000, 3), "each later day's snapshot is written once"
    snapshots = await _get_snapshots(db, account.id)
    assert [snapshot.balance for snapshot in snapshots] == [100 * day - 50 for day in range(1, 1001)], "every balance matches a full rewrite"


async def test_recompute_after_date_move_writes_only_the_days_whose_balance_changed(db, user, account, second_account, category):
    """Moving a transaction later rewrites only the days it passes over, and a repeat rebuild writes nothing"""
    history = await _seed_daily_history(db, user, account, category, 10)
    second_day = history[1].dt
    history[1].dt = history[4].dt
    # Activity on another account that day must not keep the emptied day's snapshot
    db.add(_make_transaction(user, second_account, category, 100, second_day))

    _, rows_written = await _measure_rebuild(db, account.id, second_day)
    _, repeat_rows_written = await _measure_rebuild(db, account.id, second_day)

    assert rows_written == 3, "the emptied day is deleted and the two days after it are updated, later days untouched"
    assert repeat_rows_written == 0, "a rebuild that changes no balance writes no row"
    snapshots = await _get_snapshots(db, account.id)
    assert [(snapshot.dt.day, snapshot.balance) for snapshot in snapshots] == [
        (1, 100),
        (3, 200),
        (4, 300),
        (5, 500),
        (6, 600),
        (7, 700),
        (8, 800),
        (9, 900),
        (10, 1000),
    ], "every balance matches a full rewrite"
