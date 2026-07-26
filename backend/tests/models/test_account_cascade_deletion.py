"""Cascade deletion tests for the Account model

Verifies that deleting an account removes its transactions at the DB level
Covers both personal and group-scoped accounts
"""
from datetime import date

import pytest
from sqlalchemy import select

from app.models.account import Account, AccountBalanceSnapshot
from app.models.base import AccountKind, AccountType, CategoryKind
from app.models.category import Category
from app.models.currency import Currency
from app.models.group import Group
from app.models.transaction import Transaction
from app.models.user import User

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
    u = User(email="cascade@example.com", first_name="Test", tz="America/Toronto", base_currency="CAD")
    db.add(u)
    await db.flush()
    return u


@pytest.fixture
async def category(db, user):
    """Seed an expense category."""
    c = Category(owner_id=user.id, name="Groceries", kind=CategoryKind.EXPENSE)
    db.add(c)
    await db.flush()
    return c


@pytest.fixture
async def personal_account(db, user):
    """Seed a personal checking account."""
    a = Account(
        owner_id=user.id, account_kind=AccountKind.ASSET, account_type=AccountType.CHECKING,
        name="Personal Chequing", currency="CAD",
    )
    db.add(a)
    await db.flush()
    return a


@pytest.fixture
async def group_account(db, user):
    """Seed a group-scoped checking account."""
    g = Group(owner_id=user.id, name="Test Group")
    db.add(g)
    await db.flush()

    a = Account(
        group_id=g.id, owner_id=None,
        account_kind=AccountKind.ASSET, account_type=AccountType.CHECKING,
        name="Joint Chequing", currency="CAD",
    )
    db.add(a)
    await db.flush()
    return a


def _make_transaction(user, account, category, amount):
    """Build a Transaction instance with default fields."""
    return Transaction(
        created_by_user_id=user.id, account_id=account.id, category_id=category.id,
        dt=date.today(), amount=amount, currency="CAD",
    )


# --- Tests ---


async def test_delete_personal_account_cascades_to_transactions(
    db, user, personal_account, category,
):
    """Deleting a personal account removes all of its transactions."""
    t1 = _make_transaction(user, personal_account, category, -1000)
    t2 = _make_transaction(user, personal_account, category, -2000)
    db.add_all([t1, t2])
    await db.flush()
    txn_ids = [t1.id, t2.id]

    await db.delete(personal_account)
    await db.flush()
    db.expire_all()

    result = await db.execute(select(Transaction).where(Transaction.id.in_(txn_ids)))
    assert result.scalars().all() == []


async def test_delete_group_account_cascades_to_transactions(
    db, user, group_account, category,
):
    """Deleting a group-scoped account removes all of its transactions."""
    t1 = _make_transaction(user, group_account, category, -1000)
    t2 = _make_transaction(user, group_account, category, -2000)
    db.add_all([t1, t2])
    await db.flush()
    txn_ids = [t1.id, t2.id]

    await db.delete(group_account)
    await db.flush()
    db.expire_all()

    result = await db.execute(select(Transaction).where(Transaction.id.in_(txn_ids)))
    assert result.scalars().all() == []


async def test_delete_account_cascades_to_balance_snapshots(
    db, personal_account,
):
    """Deleting an account removes all of its balance snapshots."""
    s1 = AccountBalanceSnapshot(
        account_id=personal_account.id, balance=10000, dt=date(2026, 3, 1),
    )
    s2 = AccountBalanceSnapshot(
        account_id=personal_account.id, balance=15000, dt=date(2026, 3, 2),
    )
    db.add_all([s1, s2])
    await db.flush()
    account_id = personal_account.id

    await db.delete(personal_account)
    await db.flush()
    db.expire_all()

    result = await db.execute(
        select(AccountBalanceSnapshot).where(AccountBalanceSnapshot.account_id == account_id),
    )
    assert result.scalars().all() == []
