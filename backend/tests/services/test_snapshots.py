"""Tests for the account balance snapshot recomputation service."""
from datetime import UTC, date, datetime

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


async def _get_snapshots(db, account_id):
    """Return all snapshots for an account ordered by date."""
    result = await db.execute(
        select(AccountBalanceSnapshot)
        .where(AccountBalanceSnapshot.account_id == account_id)
        .order_by(AccountBalanceSnapshot.date),
    )
    return list(result.scalars().all())


# --- Tests ---


async def test_recompute_with_no_transactions_writes_no_snapshots(db, account):
    """Empty transaction history leaves the snapshot table empty."""
    await recompute_snapshots_from(db, account.id, date(2026, 3, 1))

    assert await _get_snapshots(db, account.id) == []


async def test_recompute_single_day_writes_one_snapshot(db, user, account, category):
    """One day of transactions produces one snapshot with the summed balance."""
    db.add_all([
        _make_transaction(user, account, category, -1000, datetime(2026, 3, 1, 10, 0, tzinfo=UTC)),
        _make_transaction(user, account, category, -500, datetime(2026, 3, 1, 15, 0, tzinfo=UTC)),
    ])
    await db.flush()

    await recompute_snapshots_from(db, account.id, date(2026, 3, 1))

    snapshots = await _get_snapshots(db, account.id)
    assert len(snapshots) == 1
    assert snapshots[0].date == date(2026, 3, 1)
    assert snapshots[0].balance == -1500


async def test_recompute_multiple_days_accumulates_running_balance(db, user, account, category):
    """Each day's snapshot carries the running balance forward."""
    db.add_all([
        _make_transaction(user, account, category, 10000, datetime(2026, 3, 1, 10, 0, tzinfo=UTC)),
        _make_transaction(user, account, category, -2000, datetime(2026, 3, 2, 10, 0, tzinfo=UTC)),
        _make_transaction(user, account, category, -3000, datetime(2026, 3, 3, 10, 0, tzinfo=UTC)),
    ])
    await db.flush()

    await recompute_snapshots_from(db, account.id, date(2026, 3, 1))

    snapshots = await _get_snapshots(db, account.id)
    assert [(s.date, s.balance) for s in snapshots] == [
        (date(2026, 3, 1), 10000),
        (date(2026, 3, 2), 8000),
        (date(2026, 3, 3), 5000),
    ]


async def test_recompute_anchor_carries_forward_from_earlier_snapshot(db, user, account, category):
    """An existing snapshot before from_date acts as the anchor balance."""
    # Existing snapshot before the recompute window
    db.add(AccountBalanceSnapshot(account_id=account.id, date=date(2026, 2, 28), balance=5000))
    # Transaction in the window
    db.add(_make_transaction(user, account, category, -1000, datetime(2026, 3, 1, 10, 0, tzinfo=UTC)))
    await db.flush()

    await recompute_snapshots_from(db, account.id, date(2026, 3, 1))

    snapshots = await _get_snapshots(db, account.id)
    assert [(s.date, s.balance) for s in snapshots] == [
        (date(2026, 2, 28), 5000),
        (date(2026, 3, 1), 4000),
    ]


async def test_recompute_replaces_stale_snapshots_in_range(db, user, account, category):
    """Stale snapshots on or after from_date are wiped and rebuilt.

    Covers the case where a stale snapshot sits between two legitimate
    days — the day with no transactions should end up without any snapshot.
    """
    # Earlier snapshot that should survive as the anchor
    db.add(AccountBalanceSnapshot(account_id=account.id, date=date(2026, 2, 28), balance=2000))
    # Stale snapshots across the recompute window
    db.add(AccountBalanceSnapshot(account_id=account.id, date=date(2026, 3, 1), balance=99999))
    db.add(AccountBalanceSnapshot(account_id=account.id, date=date(2026, 3, 2), balance=88888))
    db.add(AccountBalanceSnapshot(account_id=account.id, date=date(2026, 3, 3), balance=77777))
    # Real transactions on 3/1 and 3/3; 3/2 has no activity
    db.add_all([
        _make_transaction(user, account, category, 1000, datetime(2026, 3, 1, 10, 0, tzinfo=UTC)),
        _make_transaction(user, account, category, -500, datetime(2026, 3, 3, 10, 0, tzinfo=UTC)),
    ])
    await db.flush()

    await recompute_snapshots_from(db, account.id, date(2026, 3, 1))

    snapshots = await _get_snapshots(db, account.id)
    # Anchor preserved, 3/1 rebuilt, 3/2 has no snapshot (stale row wiped), 3/3 rebuilt
    assert [(s.date, s.balance) for s in snapshots] == [
        (date(2026, 2, 28), 2000),
        (date(2026, 3, 1), 3000),
        (date(2026, 3, 3), 2500),
    ]


async def test_recompute_skips_days_without_transactions(db, user, account, category):
    """Days with no transactions do not get snapshot rows."""
    db.add_all([
        _make_transaction(user, account, category, 1000, datetime(2026, 3, 1, 10, 0, tzinfo=UTC)),
        # Skip 3/2 entirely
        _make_transaction(user, account, category, -500, datetime(2026, 3, 3, 10, 0, tzinfo=UTC)),
    ])
    await db.flush()

    await recompute_snapshots_from(db, account.id, date(2026, 3, 1))

    snapshots = await _get_snapshots(db, account.id)
    assert [s.date for s in snapshots] == [date(2026, 3, 1), date(2026, 3, 3)]
    assert snapshots[0].balance == 1000
    assert snapshots[1].balance == 500


async def test_recompute_ignores_transactions_on_other_accounts(
    db, user, account, second_account, category,
):
    """Recomputing one account must not touch snapshots for a sibling account."""
    # Transactions on both accounts on the same day
    db.add_all([
        _make_transaction(user, account, category, 1000, datetime(2026, 3, 1, 10, 0, tzinfo=UTC)),
        _make_transaction(user, second_account, category, 5000, datetime(2026, 3, 1, 10, 0, tzinfo=UTC)),
    ])
    # Pre-existing snapshot on the sibling account that should survive untouched
    db.add(AccountBalanceSnapshot(
        account_id=second_account.id, date=date(2026, 3, 1), balance=5000,
    ))
    await db.flush()

    await recompute_snapshots_from(db, account.id, date(2026, 3, 1))

    # Target account: correct running balance (only its own 1000)
    target_snapshots = await _get_snapshots(db, account.id)
    assert [(s.date, s.balance) for s in target_snapshots] == [(date(2026, 3, 1), 1000)]

    # Sibling account: snapshot untouched
    sibling_snapshots = await _get_snapshots(db, second_account.id)
    assert [(s.date, s.balance) for s in sibling_snapshots] == [(date(2026, 3, 1), 5000)]


async def test_recompute_with_no_activity_on_or_after_from_date_preserves_earlier_snapshots(
    db, account,
):
    """Anchor snapshots strictly before from_date survive when nothing follows them."""
    # Anchor snapshot from the prior month
    db.add(AccountBalanceSnapshot(account_id=account.id, date=date(2026, 2, 28), balance=5000))
    await db.flush()

    # Recompute from a date with no transactions on or after it
    await recompute_snapshots_from(db, account.id, date(2026, 3, 1))

    snapshots = await _get_snapshots(db, account.id)
    assert [(s.date, s.balance) for s in snapshots] == [(date(2026, 2, 28), 5000)]


async def test_recompute_excludes_transactions_before_from_date(db, user, account, category):
    """Transactions strictly before from_date must not be summed into the rebuilt window."""
    # An anchor snapshot reflecting the pre-window state
    db.add(AccountBalanceSnapshot(account_id=account.id, date=date(2026, 3, 1), balance=1000))
    # Transaction on 3/1 (before the recompute window) and 3/3 (inside)
    db.add_all([
        _make_transaction(user, account, category, 1000, datetime(2026, 3, 1, 10, 0, tzinfo=UTC)),
        _make_transaction(user, account, category, -200, datetime(2026, 3, 3, 10, 0, tzinfo=UTC)),
    ])
    await db.flush()

    # Recompute from 3/2 — the 3/1 transaction must be ignored
    await recompute_snapshots_from(db, account.id, date(2026, 3, 2))

    snapshots = await _get_snapshots(db, account.id)
    # Anchor stays, only 3/3 is written (anchor 1000 + -200 = 800)
    assert [(s.date, s.balance) for s in snapshots] == [
        (date(2026, 3, 1), 1000),
        (date(2026, 3, 3), 800),
    ]


async def test_recompute_writes_snapshot_for_zero_delta_day(db, user, account, category):
    """A day where transactions sum to zero still produces a snapshot row."""
    db.add_all([
        _make_transaction(user, account, category, 1000, datetime(2026, 3, 1, 9, 0, tzinfo=UTC)),
        _make_transaction(user, account, category, -1000, datetime(2026, 3, 1, 15, 0, tzinfo=UTC)),
    ])
    await db.flush()

    await recompute_snapshots_from(db, account.id, date(2026, 3, 1))

    snapshots = await _get_snapshots(db, account.id)
    assert [(s.date, s.balance) for s in snapshots] == [(date(2026, 3, 1), 0)]


async def test_recompute_anchor_balance_of_zero_is_treated_as_anchor(
    db, user, account, category,
):
    """A prior snapshot with balance=0 is a valid anchor, not treated as 'no anchor'."""
    # Anchor with a literal zero balance
    db.add(AccountBalanceSnapshot(account_id=account.id, date=date(2026, 2, 28), balance=0))
    db.add(_make_transaction(user, account, category, 500, datetime(2026, 3, 1, 10, 0, tzinfo=UTC)))
    await db.flush()

    await recompute_snapshots_from(db, account.id, date(2026, 3, 1))

    snapshots = await _get_snapshots(db, account.id)
    assert [(s.date, s.balance) for s in snapshots] == [
        (date(2026, 2, 28), 0),
        (date(2026, 3, 1), 500),
    ]


async def test_recompute_from_date_before_any_transaction(db, user, account, category):
    """from_date far in the past rebuilds from an implicit zero anchor."""
    db.add(_make_transaction(user, account, category, 2000, datetime(2026, 3, 1, 10, 0, tzinfo=UTC)))
    await db.flush()

    await recompute_snapshots_from(db, account.id, date(2020, 1, 1))

    snapshots = await _get_snapshots(db, account.id)
    assert [(s.date, s.balance) for s in snapshots] == [(date(2026, 3, 1), 2000)]
