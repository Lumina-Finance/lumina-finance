"""Tests for the account balance snapshot recomputation service."""
from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.models.account import Account, AccountBalanceSnapshot
from app.models.base import AccountType, CategoryKind, TaxTreatment
from app.models.category import Category
from app.models.currency import Currency
from app.models.transaction import Transaction
from app.models.user import User
from app.services.snapshots import recompute_snapshots_from

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
        owner_id=user.id, account_type=AccountType.CHECKING,
        tax_treatment=TaxTreatment.TAXABLE, name="Chequing", currency="CAD",
    )
    db.add(a)
    await db.flush()
    return a


@pytest.fixture
async def second_account(db, user):
    """Seed a second personal account for isolation tests."""
    a = Account(
        owner_id=user.id, account_type=AccountType.SAVINGS,
        tax_treatment=TaxTreatment.TAXABLE, name="Savings", currency="CAD",
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


def _make_transaction(user, account, category, amount, ts):
    """Build a Transaction row with default currency/fx_rate."""
    return Transaction(
        created_by_user_id=user.id, account_id=account.id, category_id=category.id,
        ts=ts, amount=amount, currency="CAD",
    )


def _midnight(y, m, d):
    """Build a midnight-UTC datetime for snapshot ts comparisons."""
    return datetime(y, m, d, tzinfo=UTC)


async def _get_snapshots(db, account_id):
    """Return all snapshots for an account ordered by ts."""
    result = await db.execute(
        select(AccountBalanceSnapshot)
        .where(AccountBalanceSnapshot.account_id == account_id)
        .order_by(AccountBalanceSnapshot.ts),
    )
    return list(result.scalars().all())


# --- Tests ---


async def test_recompute_with_no_transactions_writes_no_snapshots(db, account):
    """Empty transaction history leaves the snapshot table empty."""
    await recompute_snapshots_from(db, account.id, _midnight(2026, 3, 1))

    assert await _get_snapshots(db, account.id) == []


async def test_recompute_single_day_writes_one_snapshot(db, user, account, category):
    """One day of transactions produces one snapshot with the summed balance."""
    db.add_all([
        _make_transaction(user, account, category, -1000, datetime(2026, 3, 1, 10, 0, tzinfo=UTC)),
        _make_transaction(user, account, category, -500, datetime(2026, 3, 1, 15, 0, tzinfo=UTC)),
    ])
    await db.flush()

    await recompute_snapshots_from(db, account.id, _midnight(2026, 3, 1))

    snapshots = await _get_snapshots(db, account.id)
    assert len(snapshots) == 1
    assert snapshots[0].ts == _midnight(2026, 3, 1)
    assert snapshots[0].balance == -1500


async def test_recompute_multiple_days_accumulates_running_balance(db, user, account, category):
    """Each day's snapshot carries the running balance forward."""
    db.add_all([
        _make_transaction(user, account, category, 10000, datetime(2026, 3, 1, 10, 0, tzinfo=UTC)),
        _make_transaction(user, account, category, -2000, datetime(2026, 3, 2, 10, 0, tzinfo=UTC)),
        _make_transaction(user, account, category, -3000, datetime(2026, 3, 3, 10, 0, tzinfo=UTC)),
    ])
    await db.flush()

    await recompute_snapshots_from(db, account.id, _midnight(2026, 3, 1))

    snapshots = await _get_snapshots(db, account.id)
    assert [(s.ts, s.balance) for s in snapshots] == [
        (_midnight(2026, 3, 1), 10000),
        (_midnight(2026, 3, 2), 8000),
        (_midnight(2026, 3, 3), 5000),
    ]


async def test_recompute_anchor_carries_forward_from_earlier_snapshot(db, user, account, category):
    """An existing snapshot before from_ts acts as the anchor balance."""
    db.add(AccountBalanceSnapshot(account_id=account.id, ts=_midnight(2026, 2, 28), balance=5000))
    db.add(_make_transaction(user, account, category, -1000, datetime(2026, 3, 1, 10, 0, tzinfo=UTC)))
    await db.flush()

    await recompute_snapshots_from(db, account.id, _midnight(2026, 3, 1))

    snapshots = await _get_snapshots(db, account.id)
    assert [(s.ts, s.balance) for s in snapshots] == [
        (_midnight(2026, 2, 28), 5000),
        (_midnight(2026, 3, 1), 4000),
    ]


async def test_recompute_replaces_stale_snapshots_in_range(db, user, account, category):
    """Stale snapshots on or after from_ts are wiped and rebuilt.

    Covers the case where a stale snapshot sits between two legitimate
    days — the day with no transactions should end up without any snapshot.
    """
    db.add(AccountBalanceSnapshot(account_id=account.id, ts=_midnight(2026, 2, 28), balance=2000))
    # Stale snapshots across the recompute window
    db.add(AccountBalanceSnapshot(account_id=account.id, ts=_midnight(2026, 3, 1), balance=99999))
    db.add(AccountBalanceSnapshot(account_id=account.id, ts=_midnight(2026, 3, 2), balance=88888))
    db.add(AccountBalanceSnapshot(account_id=account.id, ts=_midnight(2026, 3, 3), balance=77777))
    # Real transactions on 3/1 and 3/3; 3/2 has no activity
    db.add_all([
        _make_transaction(user, account, category, 1000, datetime(2026, 3, 1, 10, 0, tzinfo=UTC)),
        _make_transaction(user, account, category, -500, datetime(2026, 3, 3, 10, 0, tzinfo=UTC)),
    ])
    await db.flush()

    await recompute_snapshots_from(db, account.id, _midnight(2026, 3, 1))

    snapshots = await _get_snapshots(db, account.id)
    assert [(s.ts, s.balance) for s in snapshots] == [
        (_midnight(2026, 2, 28), 2000),
        (_midnight(2026, 3, 1), 3000),
        (_midnight(2026, 3, 3), 2500),
    ]


async def test_recompute_skips_days_without_transactions(db, user, account, category):
    """Days with no transactions do not get snapshot rows."""
    db.add_all([
        _make_transaction(user, account, category, 1000, datetime(2026, 3, 1, 10, 0, tzinfo=UTC)),
        _make_transaction(user, account, category, -500, datetime(2026, 3, 3, 10, 0, tzinfo=UTC)),
    ])
    await db.flush()

    await recompute_snapshots_from(db, account.id, _midnight(2026, 3, 1))

    snapshots = await _get_snapshots(db, account.id)
    assert [s.ts for s in snapshots] == [_midnight(2026, 3, 1), _midnight(2026, 3, 3)]
    assert snapshots[0].balance == 1000
    assert snapshots[1].balance == 500


async def test_recompute_ignores_transactions_on_other_accounts(
    db, user, account, second_account, category,
):
    """Recomputing one account must not touch snapshots for a sibling account."""
    db.add_all([
        _make_transaction(user, account, category, 1000, datetime(2026, 3, 1, 10, 0, tzinfo=UTC)),
        _make_transaction(user, second_account, category, 5000, datetime(2026, 3, 1, 10, 0, tzinfo=UTC)),
    ])
    db.add(AccountBalanceSnapshot(
        account_id=second_account.id, ts=_midnight(2026, 3, 1), balance=5000,
    ))
    await db.flush()

    await recompute_snapshots_from(db, account.id, _midnight(2026, 3, 1))

    target_snapshots = await _get_snapshots(db, account.id)
    assert [(s.ts, s.balance) for s in target_snapshots] == [(_midnight(2026, 3, 1), 1000)]

    sibling_snapshots = await _get_snapshots(db, second_account.id)
    assert [(s.ts, s.balance) for s in sibling_snapshots] == [(_midnight(2026, 3, 1), 5000)]


async def test_recompute_with_no_activity_on_or_after_from_ts_preserves_earlier_snapshots(
    db, account,
):
    """Anchor snapshots strictly before from_ts survive when nothing follows them."""
    db.add(AccountBalanceSnapshot(account_id=account.id, ts=_midnight(2026, 2, 28), balance=5000))
    await db.flush()

    await recompute_snapshots_from(db, account.id, _midnight(2026, 3, 1))

    snapshots = await _get_snapshots(db, account.id)
    assert [(s.ts, s.balance) for s in snapshots] == [(_midnight(2026, 2, 28), 5000)]


async def test_recompute_excludes_transactions_before_from_ts(db, user, account, category):
    """Transactions strictly before from_ts must not be summed into the rebuilt window."""
    db.add(AccountBalanceSnapshot(account_id=account.id, ts=_midnight(2026, 3, 1), balance=1000))
    db.add_all([
        _make_transaction(user, account, category, 1000, datetime(2026, 3, 1, 10, 0, tzinfo=UTC)),
        _make_transaction(user, account, category, -200, datetime(2026, 3, 3, 10, 0, tzinfo=UTC)),
    ])
    await db.flush()

    # Recompute from 3/2 — the 3/1 transaction must be ignored
    await recompute_snapshots_from(db, account.id, _midnight(2026, 3, 2))

    snapshots = await _get_snapshots(db, account.id)
    assert [(s.ts, s.balance) for s in snapshots] == [
        (_midnight(2026, 3, 1), 1000),
        (_midnight(2026, 3, 3), 800),
    ]


async def test_recompute_writes_snapshot_for_zero_delta_day(db, user, account, category):
    """A day where transactions sum to zero still produces a snapshot row."""
    db.add_all([
        _make_transaction(user, account, category, 1000, datetime(2026, 3, 1, 9, 0, tzinfo=UTC)),
        _make_transaction(user, account, category, -1000, datetime(2026, 3, 1, 15, 0, tzinfo=UTC)),
    ])
    await db.flush()

    await recompute_snapshots_from(db, account.id, _midnight(2026, 3, 1))

    snapshots = await _get_snapshots(db, account.id)
    assert [(s.ts, s.balance) for s in snapshots] == [(_midnight(2026, 3, 1), 0)]


async def test_recompute_anchor_balance_of_zero_is_treated_as_anchor(
    db, user, account, category,
):
    """A prior snapshot with balance=0 is a valid anchor, not treated as 'no anchor'."""
    db.add(AccountBalanceSnapshot(account_id=account.id, ts=_midnight(2026, 2, 28), balance=0))
    db.add(_make_transaction(user, account, category, 500, datetime(2026, 3, 1, 10, 0, tzinfo=UTC)))
    await db.flush()

    await recompute_snapshots_from(db, account.id, _midnight(2026, 3, 1))

    snapshots = await _get_snapshots(db, account.id)
    assert [(s.ts, s.balance) for s in snapshots] == [
        (_midnight(2026, 2, 28), 0),
        (_midnight(2026, 3, 1), 500),
    ]


async def test_recompute_from_ts_before_any_transaction(db, user, account, category):
    """from_ts far in the past rebuilds from an implicit zero anchor."""
    db.add(_make_transaction(user, account, category, 2000, datetime(2026, 3, 1, 10, 0, tzinfo=UTC)))
    await db.flush()

    await recompute_snapshots_from(db, account.id, _midnight(2020, 1, 1))

    snapshots = await _get_snapshots(db, account.id)
    assert [(s.ts, s.balance) for s in snapshots] == [(_midnight(2026, 3, 1), 2000)]


async def test_recompute_with_non_utc_from_ts_normalizes_to_utc_day(
    db, user, account, category,
):
    """A non-UTC from_ts is normalized to its UTC day before bucketing."""
    # 2026-03-01 at 23:00 in UTC-4 = 2026-03-02 03:00 UTC
    # Caller passes tz-aware datetime; service should treat it as UTC day 2026-03-02
    from datetime import timedelta, timezone
    minus_four = timezone(timedelta(hours=-4))

    db.add_all([
        _make_transaction(user, account, category, 500, datetime(2026, 3, 1, 10, 0, tzinfo=UTC)),
        _make_transaction(user, account, category, 1000, datetime(2026, 3, 2, 10, 0, tzinfo=UTC)),
    ])
    await db.flush()

    await recompute_snapshots_from(
        db, account.id, datetime(2026, 3, 1, 23, 0, tzinfo=minus_four),
    )

    snapshots = await _get_snapshots(db, account.id)
    # 3/1 UTC snapshot should be preserved (unchanged), 3/2 rebuilt
    # But since we didn't pre-seed, the recompute deletes from 3/2 UTC forward
    # Aggregation picks up only the 3/2 transaction → snapshot on 3/2 with balance 1000
    # The 3/1 transaction is before the window, so no snapshot for 3/1 (no anchor exists)
    assert [(s.ts, s.balance) for s in snapshots] == [(_midnight(2026, 3, 2), 1000)]
