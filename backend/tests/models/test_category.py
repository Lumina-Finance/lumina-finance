import uuid

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.base import CategoryKind
from app.models.category import Category
from app.models.currency import Currency
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
    """Seed a top-level expense category."""
    c = Category(owner_id=user.id, name="Food", kind=CategoryKind.EXPENSE)
    db.add(c)
    await db.flush()
    return c


# --- Basic CRUD ---


async def test_create_category(db, category, user):
    """Insert a category and verify fields."""
    result = await db.get(Category, category.id)
    assert result is not None
    assert result.owner_id == user.id
    assert result.name == "Food"
    assert result.kind == CategoryKind.EXPENSE
    assert result.created_at is not None


async def test_update_category(db, category):
    """Update a category's name."""
    category.name = "Food & Drink"
    await db.flush()

    result = await db.get(Category, category.id)
    assert result.name == "Food & Drink"


async def test_delete_category(db, category):
    """Delete a category."""
    cid = category.id
    await db.delete(category)
    await db.flush()

    result = await db.get(Category, cid)
    assert result is None


# --- Defaults ---


async def test_created_at_auto_set(db, category):
    """created_at should be set automatically by the database."""
    await db.refresh(category)
    assert category.created_at is not None


async def test_group_defaults_to_null(db, category):
    """group_id should default to null for personal categories."""
    assert category.group_id is None


# --- Constraints ---


async def test_null_owner_rejected(db):
    """Custom categories require an owner or group scope."""
    db.add(Category(owner_id=None, name="Bad", kind=CategoryKind.EXPENSE))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_null_name_rejected(db, user):
    """Name is NOT NULL."""
    db.add(Category(owner_id=user.id, name=None, kind=CategoryKind.EXPENSE))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_null_kind_rejected(db, user):
    """Kind is NOT NULL."""
    db.add(Category(owner_id=user.id, name="Bad", kind=None))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_invalid_owner_rejected(db):
    """owner_id must reference a valid user."""
    db.add(Category(owner_id=uuid.uuid4(), name="Bad", kind=CategoryKind.EXPENSE))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_duplicate_name_rejected(db, user):
    """Same owner + name combination is rejected by unique constraint."""
    db.add(Category(owner_id=user.id, name="Food", kind=CategoryKind.EXPENSE))
    await db.flush()

    db.add(Category(owner_id=user.id, name="Food", kind=CategoryKind.EXPENSE))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_same_name_different_kind_rejected(db, user):
    """Same name with a different kind is still a duplicate."""
    db.add(Category(owner_id=user.id, name="Misc", kind=CategoryKind.EXPENSE))
    await db.flush()

    db.add(Category(owner_id=user.id, name="Misc", kind=CategoryKind.INCOME))
    with pytest.raises(IntegrityError):
        await db.flush()
