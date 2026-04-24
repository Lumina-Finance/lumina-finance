import pytest
from sqlalchemy.exc import IntegrityError

from app.models.account import Account
from app.models.base import AccountKind, AccountType
from app.models.currency import Currency
from app.models.group import Group
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
    u = User(email="john@example.com", first_name="John", last_name="Doe", tz="America/Toronto", base_currency="CAD")
    db.add(u)
    await db.flush()
    return u


@pytest.fixture
async def group(db, user):
    """Seed a group for FK references."""
    g = Group(owner_id=user.id, name="Doe Family")
    db.add(g)
    await db.flush()
    return g


# --- Defaults ---


async def test_created_at_auto_set(db, user, currency):
    """created_at should be set automatically by the database."""
    a = Account(owner_id=user.id, account_kind=AccountKind.ASSET, account_type=AccountType.CHECKING, name="Checking", currency="CAD")
    db.add(a)
    await db.flush()
    await db.refresh(a)

    assert a.created_at is not None


async def test_is_hidden_defaults_to_false(db, user, currency):
    """is_hidden should default to false."""
    a = Account(owner_id=user.id, account_kind=AccountKind.ASSET, account_type=AccountType.CHECKING, name="Checking", currency="CAD")
    db.add(a)
    await db.flush()

    result = await db.get(Account, a.id)
    assert result.is_hidden is False


async def test_nullable_fields_default_to_null(db, user, currency):
    """institution_id and closed_at should default to null."""
    a = Account(owner_id=user.id, account_kind=AccountKind.ASSET, account_type=AccountType.CHECKING, name="Checking", currency="CAD")
    db.add(a)
    await db.flush()

    result = await db.get(Account, a.id)
    assert result.institution_id is None
    assert result.closed_at is None


# --- Owner XOR Group Check Constraint ---


async def test_personal_account_accepted(db, user, currency):
    """Account with owner_id and no group_id should be valid."""
    a = Account(owner_id=user.id, account_kind=AccountKind.ASSET, account_type=AccountType.CHECKING, name="Checking", currency="CAD")
    db.add(a)
    await db.flush()

    result = await db.get(Account, a.id)
    assert result is not None
    assert result.owner_id == user.id
    assert result.group_id is None


async def test_group_account_accepted(db, group, currency):
    """Account with group_id and no owner_id should be valid."""
    a = Account(group_id=group.id, account_kind=AccountKind.ASSET, account_type=AccountType.CHECKING, name="Joint Checking", currency="CAD")
    db.add(a)
    await db.flush()

    result = await db.get(Account, a.id)
    assert result is not None
    assert result.owner_id is None
    assert result.group_id == group.id


async def test_both_owner_and_group_rejected(db, user, group, currency):
    """Account with both owner_id and group_id should be rejected."""
    db.add(Account(
        owner_id=user.id, group_id=group.id,
        account_kind=AccountKind.ASSET, account_type=AccountType.CHECKING, name="Invalid", currency="CAD",
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_neither_owner_nor_group_rejected(db, currency):
    """Account with neither owner_id nor group_id should be rejected."""
    db.add(Account(account_kind=AccountKind.ASSET, account_type=AccountType.CHECKING, name="Orphan", currency="CAD"))
    with pytest.raises(IntegrityError):
        await db.flush()
