from datetime import date

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.budget import BaseBudget, Budget
from app.models.currency import Currency
from app.models.user import User

NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000"

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
async def base_budget(db, user):
    """Seed a personal one-off base budget to host instances."""
    b = BaseBudget(owner_id=user.id, name="March Budget", currency="CAD")
    db.add(b)
    await db.flush()
    return b


@pytest.fixture
async def instance(db, base_budget):
    """Seed a per-period budget instance under the base fixture."""
    b = Budget(
        base_budget_id=base_budget.id,
        period_start=date(2026, 3, 1), period_end=date(2026, 3, 31),
        overall_limit=10000,
    )
    db.add(b)
    await db.flush()
    return b


# --- Budget instance: Basic CRUD ---


async def test_create_instance(db, instance, base_budget):
    """Insert a budget instance and verify fields."""
    result = await db.get(Budget, instance.id)
    assert result is not None
    assert result.base_budget_id == base_budget.id
    assert result.period_start == date(2026, 3, 1)
    assert result.period_end == date(2026, 3, 31)
    assert result.overall_limit == 10000


async def test_update_instance(db, instance):
    """Update an instance's overall_limit."""
    instance.overall_limit = 25000
    await db.flush()

    result = await db.get(Budget, instance.id)
    assert result.overall_limit == 25000


async def test_delete_instance(db, instance):
    """Delete an instance."""
    iid = instance.id
    await db.delete(instance)
    await db.flush()

    result = await db.get(Budget, iid)
    assert result is None


async def test_instance_created_at_auto_set(db, instance):
    """created_at should be set automatically by the database."""
    await db.refresh(instance)
    assert instance.created_at is not None


# --- Budget instance: Constraints ---


async def test_instance_requires_base_budget(db):
    """base_budget_id is NOT NULL."""
    db.add(Budget(
        base_budget_id=None,
        period_start=date(2026, 3, 1), period_end=date(2026, 3, 31),
        overall_limit=10000,
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_instance_invalid_base_budget_rejected(db):
    """base_budget_id must reference a valid base budget."""
    db.add(Budget(
        base_budget_id=NONEXISTENT_ID,
        period_start=date(2026, 3, 1), period_end=date(2026, 3, 31),
        overall_limit=10000,
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_instance_overall_limit_zero_rejected(db, base_budget):
    """overall_limit must be > 0 (zero boundary)."""
    db.add(Budget(
        base_budget_id=base_budget.id,
        period_start=date(2026, 3, 1), period_end=date(2026, 3, 31),
        overall_limit=0,
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_instance_overall_limit_negative_rejected(db, base_budget):
    """overall_limit must be > 0 (rejects negatives)."""
    db.add(Budget(
        base_budget_id=base_budget.id,
        period_start=date(2026, 3, 1), period_end=date(2026, 3, 31),
        overall_limit=-500,
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_instance_null_period_start_rejected(db, base_budget):
    """period_start is NOT NULL."""
    db.add(Budget(
        base_budget_id=base_budget.id,
        period_start=None, period_end=date(2026, 3, 31),
        overall_limit=10000,
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_instance_null_period_end_rejected(db, base_budget):
    """period_end is NOT NULL."""
    db.add(Budget(
        base_budget_id=base_budget.id,
        period_start=date(2026, 3, 1), period_end=None,
        overall_limit=10000,
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_instance_null_overall_limit_rejected(db, base_budget):
    """overall_limit is NOT NULL."""
    db.add(Budget(
        base_budget_id=base_budget.id,
        period_start=date(2026, 3, 1), period_end=date(2026, 3, 31),
        overall_limit=None,
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_instance_period_end_before_start_rejected(db, base_budget):
    """period_end must be on or after period_start."""
    db.add(Budget(
        base_budget_id=base_budget.id,
        period_start=date(2026, 3, 31), period_end=date(2026, 3, 1),
        overall_limit=10000,
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_instance_period_same_day_accepted(db, base_budget):
    """period_end may equal period_start (one-day budget)."""
    b = Budget(
        base_budget_id=base_budget.id,
        period_start=date(2026, 3, 1), period_end=date(2026, 3, 1),
        overall_limit=10000,
    )
    db.add(b)
    await db.flush()
    assert b.id is not None


async def test_instance_duplicate_base_period_rejected(db, base_budget, instance):
    """Same (base_budget_id, period_start, period_end) cannot appear twice."""
    db.add(Budget(
        base_budget_id=base_budget.id,
        period_start=instance.period_start, period_end=instance.period_end,
        overall_limit=5000,
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_instance_duplicate_period_across_bases_accepted(db, user, instance):
    """The uniqueness is per-base: two different bases may both hold the same period."""
    other_base = BaseBudget(owner_id=user.id, name="Other Budget", currency="CAD")
    db.add(other_base)
    await db.flush()

    b = Budget(
        base_budget_id=other_base.id,
        period_start=instance.period_start, period_end=instance.period_end,
        overall_limit=5000,
    )
    db.add(b)
    await db.flush()

    assert b.id is not None
    assert b.id != instance.id


# --- Budget instance: Cascades ---


async def test_instance_cascades_on_base_budget_deletion(db, base_budget, instance):
    """Deleting a base budget cascades to its instances."""
    iid = instance.id
    await db.delete(base_budget)
    await db.commit()

    db.expire_all()
    result = await db.get(Budget, iid)
    assert result is None
