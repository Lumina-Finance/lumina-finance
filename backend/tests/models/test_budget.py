from datetime import date

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.base import RecurrenceFreq
from app.models.budget import BaseBudget, Budget
from app.models.currency import Currency
from app.models.group import Group
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
async def group(db, user):
    """Seed a group for FK references."""
    g = Group(owner_id=user.id, name="Test Group")
    db.add(g)
    await db.flush()
    return g


@pytest.fixture
async def base_budget(db, user):
    """Seed a personal one-off base budget."""
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


# --- BaseBudget: Basic CRUD ---


async def test_create_base_budget(db, base_budget, user):
    """Insert a base budget and verify fields."""
    result = await db.get(BaseBudget, base_budget.id)
    assert result is not None
    assert result.owner_id == user.id
    assert result.name == "March Budget"
    assert result.currency == "CAD"


async def test_update_base_budget(db, base_budget):
    """Update a base budget's name."""
    base_budget.name = "Updated Budget"
    await db.flush()

    result = await db.get(BaseBudget, base_budget.id)
    assert result.name == "Updated Budget"


async def test_delete_base_budget(db, base_budget):
    """Delete a base budget."""
    bid = base_budget.id
    await db.delete(base_budget)
    await db.flush()

    result = await db.get(BaseBudget, bid)
    assert result is None


# --- BaseBudget: Defaults ---


async def test_created_at_auto_set(db, base_budget):
    """created_at should be set automatically by the database."""
    await db.refresh(base_budget)
    assert base_budget.created_at is not None


async def test_recurrence_defaults_to_null(db, base_budget):
    """recurrence_freq and recurrence_interval default to null for one-off base budgets."""
    assert base_budget.recurrence_freq is None
    assert base_budget.recurrence_interval is None


# --- BaseBudget: Recurring ---


async def test_recurring_base_budget(db, user):
    """Create a recurring base budget with monthly cadence."""
    b = BaseBudget(
        owner_id=user.id, name="Monthly Budget", currency="CAD",
        recurrence_freq=RecurrenceFreq.MONTHLY, recurrence_interval=1,
    )
    db.add(b)
    await db.flush()

    result = await db.get(BaseBudget, b.id)
    assert result.recurrence_freq == RecurrenceFreq.MONTHLY
    assert result.recurrence_interval == 1


# --- BaseBudget: Owner XOR Group Check Constraint ---


async def test_personal_base_budget_accepted(db, user):
    """BaseBudget with owner_id and no group_id should be valid."""
    b = BaseBudget(owner_id=user.id, name="Personal", currency="CAD")
    db.add(b)
    await db.flush()

    result = await db.get(BaseBudget, b.id)
    assert result.owner_id == user.id
    assert result.group_id is None


async def test_group_base_budget_accepted(db, group):
    """BaseBudget with group_id and no owner_id should be valid."""
    b = BaseBudget(group_id=group.id, name="Family Budget", currency="CAD")
    db.add(b)
    await db.flush()

    result = await db.get(BaseBudget, b.id)
    assert result.owner_id is None
    assert result.group_id == group.id


async def test_both_owner_and_group_rejected(db, user, group):
    """BaseBudget with both owner_id and group_id should be rejected."""
    db.add(BaseBudget(owner_id=user.id, group_id=group.id, name="Invalid", currency="CAD"))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_neither_owner_nor_group_rejected(db, currency):
    """BaseBudget with neither owner_id nor group_id should be rejected."""
    db.add(BaseBudget(name="Orphan", currency="CAD"))
    with pytest.raises(IntegrityError):
        await db.flush()


# --- BaseBudget: Constraints ---


async def test_null_name_rejected(db, user):
    """Name is NOT NULL."""
    db.add(BaseBudget(owner_id=user.id, name=None, currency="CAD"))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_null_currency_rejected(db, user):
    """Currency is NOT NULL."""
    db.add(BaseBudget(owner_id=user.id, name="Bad", currency=None))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_invalid_currency_rejected(db, user):
    """Currency must reference a valid currency."""
    db.add(BaseBudget(owner_id=user.id, name="Bad", currency="ZZZ"))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_recurrence_interval_must_be_positive(db, user):
    """recurrence_interval must be > 0 when set."""
    db.add(BaseBudget(
        owner_id=user.id, name="Bad", currency="CAD",
        recurrence_freq=RecurrenceFreq.MONTHLY, recurrence_interval=0,
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


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


async def test_instance_overall_limit_must_be_positive(db, base_budget):
    """overall_limit must be > 0."""
    db.add(Budget(
        base_budget_id=base_budget.id,
        period_start=date(2026, 3, 1), period_end=date(2026, 3, 31),
        overall_limit=0,
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


# --- Budget instance: Cascades ---


async def test_instance_cascades_on_base_budget_deletion(db, base_budget, instance):
    """Deleting a base budget cascades to its instances."""
    iid = instance.id
    await db.delete(base_budget)
    await db.commit()

    db.expire_all()
    result = await db.get(Budget, iid)
    assert result is None
