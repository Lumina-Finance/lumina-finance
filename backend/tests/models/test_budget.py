import uuid
from datetime import date

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.base import CategoryKind, RecurrenceFreq
from app.models.budget import Budget, BudgetAllocation, BudgetAllocationCategory, BudgetMember
from app.models.category import Category
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
    u = User(email="user@example.com", first_name="Test", last_name="User", tz="America/Toronto", base_currency="CAD")
    db.add(u)
    await db.flush()
    return u


@pytest.fixture
async def member(db, currency):
    """Seed a second user for budget member scoping."""
    u = User(email="member@example.com", first_name="Test", last_name="Member", tz="America/Toronto", base_currency="CAD")
    db.add(u)
    await db.flush()
    return u


@pytest.fixture
async def household(db, user):
    """Seed a household for FK references."""
    h = Household(owner_id=user.id, name="Test Household")
    db.add(h)
    await db.flush()
    return h


@pytest.fixture
async def budget(db, user):
    """Seed a personal one-off budget."""
    b = Budget(
        owner_id=user.id, name="March Budget",
        period_start=date(2026, 3, 1), period_end=date(2026, 3, 31), currency="CAD",
    )
    db.add(b)
    await db.flush()
    return b


@pytest.fixture
async def category(db, user):
    """Seed a category for allocation linking."""
    c = Category(owner_id=user.id, name="Groceries", kind=CategoryKind.EXPENSE)
    db.add(c)
    await db.flush()
    return c


@pytest.fixture
async def allocation(db, budget):
    """Seed a budget allocation."""
    a = BudgetAllocation(budget_id=budget.id, name="Groceries", amount=30000)
    db.add(a)
    await db.flush()
    return a


# --- Budget: Basic CRUD ---


async def test_create_budget(db, budget, user):
    """Insert a budget and verify fields."""
    result = await db.get(Budget, budget.id)
    assert result is not None
    assert result.owner_id == user.id
    assert result.name == "March Budget"
    assert result.period_start == date(2026, 3, 1)
    assert result.period_end == date(2026, 3, 31)
    assert result.currency == "CAD"


async def test_update_budget(db, budget):
    """Update a budget's name."""
    budget.name = "Updated Budget"
    await db.flush()

    result = await db.get(Budget, budget.id)
    assert result.name == "Updated Budget"


async def test_delete_budget(db, budget):
    """Delete a budget."""
    bid = budget.id
    await db.delete(budget)
    await db.flush()

    result = await db.get(Budget, bid)
    assert result is None


# --- Budget: Defaults ---


async def test_created_at_auto_set(db, budget):
    """created_at should be set automatically by the database."""
    await db.refresh(budget)
    assert budget.created_at is not None


async def test_recurrence_defaults_to_null(db, budget):
    """recurrence_freq and recurrence_interval should default to null for one-off budgets."""
    assert budget.recurrence_freq is None
    assert budget.recurrence_interval is None


async def test_overall_limit_defaults_to_null(db, budget):
    """overall_limit should default to null."""
    assert budget.overall_limit is None


async def test_parent_budget_defaults_to_null(db, budget):
    """parent_budget_id should default to null for templates/one-offs."""
    assert budget.parent_budget_id is None


# --- Budget: Recurring ---


async def test_recurring_budget_template(db, user):
    """Create a recurring budget template."""
    b = Budget(
        owner_id=user.id, name="Monthly Budget",
        period_start=date(2026, 3, 1), period_end=date(2026, 3, 31),
        recurrence_freq=RecurrenceFreq.MONTHLY, recurrence_interval=1, currency="CAD",
    )
    db.add(b)
    await db.flush()

    result = await db.get(Budget, b.id)
    assert result.recurrence_freq == RecurrenceFreq.MONTHLY
    assert result.recurrence_interval == 1


async def test_recurring_budget_instance(db, user):
    """Create a budget instance pointing to a template."""
    template = Budget(
        owner_id=user.id, name="Monthly Budget",
        period_start=date(2026, 3, 1), period_end=date(2026, 3, 31),
        recurrence_freq=RecurrenceFreq.MONTHLY, recurrence_interval=1, currency="CAD",
    )
    db.add(template)
    await db.flush()

    instance = Budget(
        owner_id=user.id, name="April Budget", parent_budget_id=template.id,
        period_start=date(2026, 4, 1), period_end=date(2026, 4, 30), currency="CAD",
    )
    db.add(instance)
    await db.flush()

    result = await db.get(Budget, instance.id)
    assert result.parent_budget_id == template.id


# --- Budget: Owner XOR Household Check Constraint ---


async def test_personal_budget_accepted(db, user, currency):
    """Budget with owner_id and no household_id should be valid."""
    b = Budget(
        owner_id=user.id, name="Personal",
        period_start=date(2026, 3, 1), period_end=date(2026, 3, 31), currency="CAD",
    )
    db.add(b)
    await db.flush()

    result = await db.get(Budget, b.id)
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


# --- Budget: Constraints ---


async def test_null_name_rejected(db, user):
    """Name is NOT NULL."""
    db.add(Budget(
        owner_id=user.id, name=None,
        period_start=date(2026, 3, 1), period_end=date(2026, 3, 31), currency="CAD",
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_null_currency_rejected(db, user):
    """Currency is NOT NULL."""
    db.add(Budget(
        owner_id=user.id, name="Bad",
        period_start=date(2026, 3, 1), period_end=date(2026, 3, 31), currency=None,
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_invalid_currency_rejected(db, user):
    """Currency must reference a valid currency."""
    db.add(Budget(
        owner_id=user.id, name="Bad",
        period_start=date(2026, 3, 1), period_end=date(2026, 3, 31), currency="ZZZ",
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


# --- BudgetAllocation: Basic CRUD ---


async def test_create_allocation(db, allocation, budget):
    """Insert a budget allocation and verify fields."""
    result = await db.get(BudgetAllocation, allocation.id)
    assert result is not None
    assert result.budget_id == budget.id
    assert result.name == "Groceries"
    assert result.amount == 30000


async def test_update_allocation(db, allocation):
    """Update an allocation's amount."""
    allocation.amount = 40000
    await db.flush()

    result = await db.get(BudgetAllocation, allocation.id)
    assert result.amount == 40000


async def test_delete_allocation(db, allocation):
    """Delete a budget allocation."""
    aid = allocation.id
    await db.delete(allocation)
    await db.flush()

    result = await db.get(BudgetAllocation, aid)
    assert result is None


# --- BudgetAllocation: Constraints ---


async def test_null_allocation_budget_rejected(db):
    """budget_id is NOT NULL."""
    db.add(BudgetAllocation(budget_id=None, name="Bad", amount=1000))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_invalid_allocation_budget_rejected(db):
    """budget_id must reference a valid budget."""
    db.add(BudgetAllocation(budget_id=uuid.uuid4(), name="Bad", amount=1000))
    with pytest.raises(IntegrityError):
        await db.flush()


# --- BudgetAllocationCategory: Basic CRUD ---


async def test_link_allocation_to_category(db, allocation, category):
    """Link a budget allocation to a category."""
    bac = BudgetAllocationCategory(allocation_id=allocation.id, category_id=category.id)
    db.add(bac)
    await db.flush()

    result = await db.get(BudgetAllocationCategory, (allocation.id, category.id))
    assert result is not None


async def test_unlink_allocation_from_category(db, allocation, category):
    """Remove a category from a budget allocation."""
    bac = BudgetAllocationCategory(allocation_id=allocation.id, category_id=category.id)
    db.add(bac)
    await db.flush()

    await db.delete(bac)
    await db.flush()

    result = await db.get(BudgetAllocationCategory, (allocation.id, category.id))
    assert result is None


async def test_multiple_categories_per_allocation(db, allocation, user):
    """An allocation can cover multiple categories (e.g., 'All Food' = Groceries + Dining)."""
    cat2 = Category(owner_id=user.id, name="Dining", kind=CategoryKind.EXPENSE)
    db.add(cat2)
    await db.flush()

    # Need a first category
    cat1 = Category(owner_id=user.id, name="Groceries 2", kind=CategoryKind.EXPENSE)
    db.add(cat1)
    await db.flush()

    db.add(BudgetAllocationCategory(allocation_id=allocation.id, category_id=cat1.id))
    db.add(BudgetAllocationCategory(allocation_id=allocation.id, category_id=cat2.id))
    await db.flush()

    r1 = await db.get(BudgetAllocationCategory, (allocation.id, cat1.id))
    r2 = await db.get(BudgetAllocationCategory, (allocation.id, cat2.id))
    assert r1 is not None
    assert r2 is not None


# --- BudgetAllocationCategory: Constraints ---


async def test_invalid_allocation_rejected(db, category):
    """allocation_id must reference a valid allocation."""
    db.add(BudgetAllocationCategory(allocation_id=uuid.uuid4(), category_id=category.id))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_invalid_category_rejected(db, allocation):
    """category_id must reference a valid category."""
    db.add(BudgetAllocationCategory(allocation_id=allocation.id, category_id=uuid.uuid4()))
    with pytest.raises(IntegrityError):
        await db.flush()


# --- BudgetMember: Basic CRUD ---


async def test_add_budget_member(db, household, member, currency):
    """Scope a household budget to a specific member."""
    b = Budget(
        household_id=household.id, name="Scoped Budget",
        period_start=date(2026, 3, 1), period_end=date(2026, 3, 31), currency="CAD",
    )
    db.add(b)
    await db.flush()

    bm = BudgetMember(budget_id=b.id, user_id=member.id)
    db.add(bm)
    await db.flush()

    result = await db.get(BudgetMember, (b.id, member.id))
    assert result is not None


async def test_remove_budget_member(db, household, member, currency):
    """Remove a member from a budget's scope."""
    b = Budget(
        household_id=household.id, name="Scoped Budget",
        period_start=date(2026, 3, 1), period_end=date(2026, 3, 31), currency="CAD",
    )
    db.add(b)
    await db.flush()

    bm = BudgetMember(budget_id=b.id, user_id=member.id)
    db.add(bm)
    await db.flush()

    await db.delete(bm)
    await db.flush()

    result = await db.get(BudgetMember, (b.id, member.id))
    assert result is None


# --- BudgetMember: Constraints ---


async def test_invalid_budget_member_budget_rejected(db, member):
    """budget_id must reference a valid budget."""
    db.add(BudgetMember(budget_id=uuid.uuid4(), user_id=member.id))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_invalid_budget_member_user_rejected(db, budget):
    """user_id must reference a valid user."""
    db.add(BudgetMember(budget_id=budget.id, user_id=uuid.uuid4()))
    with pytest.raises(IntegrityError):
        await db.flush()
