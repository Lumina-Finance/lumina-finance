from datetime import date

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.budget import Budget
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


async def test_personal_budget_accepted(db, user, currency):
    """Budget with owner_id and no household_id should be valid."""
    b = Budget(
        owner_id=user.id, name="March Budget",
        period_start=date(2026, 3, 1), period_end=date(2026, 3, 31), currency="CAD",
    )
    db.add(b)
    await db.flush()

    result = await db.get(Budget, b.id)
    assert result is not None
    assert result.owner_id == user.id
    assert result.household_id is None


async def test_household_budget_accepted(db, household, currency):
    """Budget with household_id and no owner_id should be valid."""
    b = Budget(
        household_id=household.id, name="Family Budget",
        period_start=date(2026, 3, 1), period_end=date(2026, 3, 31), currency="CAD",
    )
    db.add(b)
    await db.flush()

    result = await db.get(Budget, b.id)
    assert result is not None
    assert result.owner_id is None
    assert result.household_id == household.id


async def test_both_owner_and_household_rejected(db, user, household, currency):
    """Budget with both owner_id and household_id should be rejected."""
    db.add(Budget(
        owner_id=user.id, household_id=household.id, name="Invalid",
        period_start=date(2026, 3, 1), period_end=date(2026, 3, 31), currency="CAD",
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_neither_owner_nor_household_rejected(db, currency):
    """Budget with neither owner_id nor household_id should be rejected."""
    db.add(Budget(
        name="Orphan",
        period_start=date(2026, 3, 1), period_end=date(2026, 3, 31), currency="CAD",
    ))
    with pytest.raises(IntegrityError):
        await db.flush()
