"""Cascade deletion tests for the Group model.

Verifies that deleting a group cascades through its accounts to their
transactions at the DB level.
"""
from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.models.account import Account
from app.models.base import AccountType, CategoryKind, TaxTreatment
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
async def group(db, user):
    """Seed a group owned by the user."""
    g = Group(owner_id=user.id, name="Test Group")
    db.add(g)
    await db.flush()
    return g


@pytest.fixture
async def group_account(db, group):
    """Seed a group-scoped checking account."""
    a = Account(
        group_id=group.id, owner_id=None,
        account_type=AccountType.CHECKING, tax_treatment=TaxTreatment.TAXABLE,
        name="Joint Chequing", currency="CAD",
    )
    db.add(a)
    await db.flush()
    return a


# --- Tests ---


async def test_delete_group_cascades_to_accounts_and_transactions(
    db, user, group, group_account, category,
):
    """Deleting a group cascades through its accounts to their transactions."""
    t1 = Transaction(
        created_by_user_id=user.id, account_id=group_account.id, category_id=category.id,
        ts=datetime.now(UTC), amount=-1000, currency="CAD",
    )
    t2 = Transaction(
        created_by_user_id=user.id, account_id=group_account.id, category_id=category.id,
        ts=datetime.now(UTC), amount=-2000, currency="CAD",
    )
    db.add_all([t1, t2])
    await db.flush()
    account_id = group_account.id
    txn_ids = [t1.id, t2.id]

    await db.delete(group)
    await db.flush()
    db.expire_all()

    # Group account should be gone
    assert await db.get(Account, account_id) is None

    # Transactions should also be gone
    result = await db.execute(select(Transaction).where(Transaction.id.in_(txn_ids)))
    assert result.scalars().all() == []
