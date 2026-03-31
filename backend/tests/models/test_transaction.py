import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.account import Account
from app.models.base import AccountType, CategoryKind
from app.models.category import Category
from app.models.currency import Currency
from app.models.merchant import Merchant
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
    """Seed a user for FK references."""
    u = User(email="user@example.com", first_name="Test", last_name="User", tz="America/Toronto", base_currency="CAD")
    db.add(u)
    await db.flush()
    return u


@pytest.fixture
async def account(db, user):
    """Seed a checking account."""
    a = Account(owner_id=user.id, account_type=AccountType.CHECKING, name="Checking", currency="CAD")
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


@pytest.fixture
async def merchant(db, user):
    """Seed a merchant."""
    m = Merchant(owner_id=user.id, name="Test Store")
    db.add(m)
    await db.flush()
    return m


@pytest.fixture
async def transaction(db, user, account, category):
    """Seed an expense transaction."""
    t = Transaction(
        created_by_user_id=user.id, account_id=account.id, category_id=category.id,
        ts=datetime.now(UTC), amount=-5000, currency="CAD",
    )
    db.add(t)
    await db.flush()
    return t


# --- Basic CRUD ---


async def test_create_transaction(db, transaction, user, account, category):
    """Insert a transaction and verify fields."""
    result = await db.get(Transaction, transaction.id)
    assert result is not None
    assert result.created_by_user_id == user.id
    assert result.account_id == account.id
    assert result.category_id == category.id
    assert result.amount == -5000
    assert result.currency == "CAD"
    assert result.merchant_id is None
    assert result.fx_rate is None
    assert result.notes is None
    assert result.updated_at is not None


async def test_update_transaction(db, transaction):
    """Update a transaction's amount."""
    transaction.amount = -7500
    await db.flush()

    result = await db.get(Transaction, transaction.id)
    assert result.amount == -7500


async def test_delete_transaction(db, transaction):
    """Delete a transaction."""
    tid = transaction.id
    await db.delete(transaction)
    await db.flush()

    result = await db.get(Transaction, tid)
    assert result is None


# --- Defaults ---


async def test_updated_at_auto_set(db, transaction):
    """updated_at should be set automatically by the database."""
    await db.refresh(transaction)
    assert transaction.updated_at is not None


async def test_fx_rate_defaults_to_null(db, transaction):
    """fx_rate should default to null."""
    assert transaction.fx_rate is None


async def test_merchant_defaults_to_null(db, transaction):
    """merchant_id should default to null."""
    assert transaction.merchant_id is None


async def test_notes_defaults_to_null(db, transaction):
    """Notes should default to null."""
    assert transaction.notes is None


# --- Optional Fields ---


async def test_transaction_with_merchant(db, user, account, category, merchant):
    """Transaction can reference a merchant."""
    t = Transaction(
        created_by_user_id=user.id, account_id=account.id, category_id=category.id,
        merchant_id=merchant.id, ts=datetime.now(UTC), amount=-3000, currency="CAD",
    )
    db.add(t)
    await db.flush()

    result = await db.get(Transaction, t.id)
    assert result.merchant_id == merchant.id


async def test_transaction_with_fx_rate(db, user, account, category, currency):
    """Transaction can have an FX rate."""
    db.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
    await db.flush()

    t = Transaction(
        created_by_user_id=user.id, account_id=account.id, category_id=category.id,
        ts=datetime.now(UTC), amount=-10000, currency="USD", fx_rate=1.35,
    )
    db.add(t)
    await db.flush()

    result = await db.get(Transaction, t.id)
    assert result.currency == "USD"
    assert float(result.fx_rate) == pytest.approx(1.35)


async def test_transaction_with_notes(db, user, account, category):
    """Transaction can have notes."""
    t = Transaction(
        created_by_user_id=user.id, account_id=account.id, category_id=category.id,
        ts=datetime.now(UTC), amount=-1500, currency="CAD", notes="Weekly groceries",
    )
    db.add(t)
    await db.flush()

    result = await db.get(Transaction, t.id)
    assert result.notes == "Weekly groceries"


# --- Constraints ---


async def test_null_user_rejected(db, account, category):
    """created_by_user_id is NOT NULL."""
    db.add(Transaction(
        created_by_user_id=None, account_id=account.id, category_id=category.id,
        ts=datetime.now(UTC), amount=-1000, currency="CAD",
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_null_account_rejected(db, user, category):
    """account_id is NOT NULL."""
    db.add(Transaction(
        created_by_user_id=user.id, account_id=None, category_id=category.id,
        ts=datetime.now(UTC), amount=-1000, currency="CAD",
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_null_category_rejected(db, user, account):
    """category_id is NOT NULL."""
    db.add(Transaction(
        created_by_user_id=user.id, account_id=account.id, category_id=None,
        ts=datetime.now(UTC), amount=-1000, currency="CAD",
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_null_amount_rejected(db, user, account, category):
    """Amount is NOT NULL."""
    db.add(Transaction(
        created_by_user_id=user.id, account_id=account.id, category_id=category.id,
        ts=datetime.now(UTC), amount=None, currency="CAD",
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_null_currency_rejected(db, user, account, category):
    """Currency is NOT NULL."""
    db.add(Transaction(
        created_by_user_id=user.id, account_id=account.id, category_id=category.id,
        ts=datetime.now(UTC), amount=-1000, currency=None,
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_invalid_account_rejected(db, user, category):
    """account_id must reference a valid account."""
    db.add(Transaction(
        created_by_user_id=user.id, account_id=uuid.uuid4(), category_id=category.id,
        ts=datetime.now(UTC), amount=-1000, currency="CAD",
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_invalid_currency_rejected(db, user, account, category):
    """Currency must reference a valid currency."""
    db.add(Transaction(
        created_by_user_id=user.id, account_id=account.id, category_id=category.id,
        ts=datetime.now(UTC), amount=-1000, currency="ZZZ",
    ))
    with pytest.raises(IntegrityError):
        await db.flush()
