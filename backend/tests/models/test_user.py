import pytest
from sqlalchemy.exc import IntegrityError

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
    """Seed a user for tests that need one."""
    u = User(email="john@example.com", first_name="John", last_name="Doe", tz="America/Toronto", base_currency="CAD")
    db.add(u)
    await db.flush()
    return u


# --- Basic CRUD ---


async def test_create_user(db, user):
    """Insert a user and verify all fields persist."""
    result = await db.get(User, user.id)
    assert result is not None
    assert result.email == "john@example.com"
    assert result.first_name == "John"
    assert result.last_name == "Doe"
    assert result.tz == "America/Toronto"
    assert result.base_currency == "CAD"


async def test_read_user(db, user):
    """Read back a user by primary key."""
    result = await db.get(User, user.id)
    assert result is not None
    assert result.email == "john@example.com"


async def test_update_user(db, user):
    """Update a user's name."""
    user.first_name = "Caroline"
    await db.flush()

    updated = await db.get(User, user.id)
    assert updated.first_name == "Caroline"


async def test_delete_user(db, user):
    """Delete a user and verify it's gone."""
    uid = user.id
    await db.delete(user)
    await db.flush()

    result = await db.get(User, uid)
    assert result is None


# --- Defaults ---


async def test_created_at_auto_set(db, user):
    """created_at should be set automatically by the database."""
    await db.refresh(user)
    assert user.created_at is not None


async def test_last_name_nullable(db, currency):
    """last_name should be optional."""
    u = User(email="frank@example.com", first_name="Frank", tz="America/Toronto", base_currency="CAD")
    db.add(u)
    await db.flush()

    result = await db.get(User, u.id)
    assert result.last_name is None


async def test_profile_pic_nullable(db, currency):
    """profile_pic should be optional."""
    u = User(email="grace@example.com", first_name="Grace", tz="America/Toronto", base_currency="CAD")
    db.add(u)
    await db.flush()

    result = await db.get(User, u.id)
    assert result.profile_pic is None


# --- Constraints ---


async def test_duplicate_email_rejected(db, user):
    """Email uniqueness should prevent duplicate emails."""
    db.add(User(email="john@example.com", first_name="Dup", tz="America/Toronto", base_currency="CAD"))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_null_email_rejected(db, currency):
    """Email is NOT NULL."""
    db.add(User(email=None, first_name="Test", tz="America/Toronto", base_currency="CAD"))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_null_first_name_rejected(db, currency):
    """first_name is NOT NULL."""
    db.add(User(email="test@example.com", first_name=None, tz="America/Toronto", base_currency="CAD"))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_null_tz_rejected(db, currency):
    """Tz is NOT NULL."""
    db.add(User(email="test@example.com", first_name="Test", tz=None, base_currency="CAD"))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_null_base_currency_rejected(db, currency):
    """base_currency is NOT NULL."""
    db.add(User(email="test@example.com", first_name="Test", tz="America/Toronto", base_currency=None))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_invalid_base_currency_rejected(db):
    """base_currency must reference a valid currency."""
    db.add(User(email="test@example.com", first_name="Test", tz="America/Toronto", base_currency="ZZZ"))
    with pytest.raises(IntegrityError):
        await db.flush()
