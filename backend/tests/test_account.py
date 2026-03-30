import pytest
from sqlalchemy.exc import IntegrityError

from app.models.account import Account
from app.models.base import AccountType
from app.models.currency import Currency
from app.models.household import Household
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
async def household(db, user):
    """Seed a household for FK references."""
    h = Household(owner_id=user.id, name="Doe Family")
    db.add(h)
    await db.flush()
    return h


# --- Owner XOR Household Check Constraint ---


async def test_personal_account_accepted(db, user, currency):
    """Account with owner_id and no household_id should be valid."""
    a = Account(owner_id=user.id, account_type=AccountType.CHECKING, name="Checking", currency="CAD")
    db.add(a)
    await db.flush()

    result = await db.get(Account, a.id)
    assert result is not None
    assert result.owner_id == user.id
    assert result.household_id is None


async def test_household_account_accepted(db, household, currency):
    """Account with household_id and no owner_id should be valid."""
    a = Account(household_id=household.id, account_type=AccountType.CHECKING, name="Joint Checking", currency="CAD")
    db.add(a)
    await db.flush()

    result = await db.get(Account, a.id)
    assert result is not None
    assert result.owner_id is None
    assert result.household_id == household.id


async def test_both_owner_and_household_rejected(db, user, household, currency):
    """Account with both owner_id and household_id should be rejected."""
    db.add(Account(
        owner_id=user.id, household_id=household.id,
        account_type=AccountType.CHECKING, name="Invalid", currency="CAD",
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_neither_owner_nor_household_rejected(db, currency):
    """Account with neither owner_id nor household_id should be rejected."""
    db.add(Account(account_type=AccountType.CHECKING, name="Orphan", currency="CAD"))
    with pytest.raises(IntegrityError):
        await db.flush()
