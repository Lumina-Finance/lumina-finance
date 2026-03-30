import uuid

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.base import CategoryKind
from app.models.category import Category
from app.models.currency import Currency
from app.models.merchant import Merchant
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
async def category(db, user):
    """Seed a category for default_category_id."""
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


# --- Basic CRUD ---


async def test_create_merchant(db, merchant, user):
    """Insert a merchant and verify fields."""
    result = await db.get(Merchant, merchant.id)
    assert result is not None
    assert result.owner_id == user.id
    assert result.name == "Test Store"
    assert result.default_category_id is None
    assert result.created_at is not None


async def test_update_merchant(db, merchant):
    """Update a merchant's name."""
    merchant.name = "Updated Store"
    await db.flush()

    result = await db.get(Merchant, merchant.id)
    assert result.name == "Updated Store"


async def test_delete_merchant(db, merchant):
    """Delete a merchant."""
    mid = merchant.id
    await db.delete(merchant)
    await db.flush()

    result = await db.get(Merchant, mid)
    assert result is None


# --- Default Category ---


async def test_merchant_with_default_category(db, user, category):
    """Merchant can have a default category for auto-categorization."""
    m = Merchant(owner_id=user.id, name="Grocery Store", default_category_id=category.id)
    db.add(m)
    await db.flush()

    result = await db.get(Merchant, m.id)
    assert result.default_category_id == category.id


async def test_invalid_default_category_rejected(db, user):
    """default_category_id must reference a valid category."""
    db.add(Merchant(owner_id=user.id, name="Bad Store", default_category_id=uuid.uuid4()))
    with pytest.raises(IntegrityError):
        await db.flush()


# --- Constraints ---


async def test_null_owner_rejected(db):
    """owner_id is NOT NULL."""
    db.add(Merchant(owner_id=None, name="Bad"))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_null_name_rejected(db, user):
    """name is NOT NULL."""
    db.add(Merchant(owner_id=user.id, name=None))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_invalid_owner_rejected(db):
    """owner_id must reference a valid user."""
    db.add(Merchant(owner_id=uuid.uuid4(), name="Bad"))
    with pytest.raises(IntegrityError):
        await db.flush()
