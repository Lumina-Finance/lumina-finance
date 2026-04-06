from datetime import date

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.base import CategoryKind, PermissionLevel, RecurrenceFreq
from app.models.budget import Budget, BudgetPermission, BudgetTrackedCategory
from app.models.category import Category
from app.models.currency import Currency
from app.models.household import Household, HouseholdMember
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


async def test_delete_budget_cascades_tracked_categories(db, budget, category):
    """Deleting a budget cascades to its tracked categories."""
    tracked = BudgetTrackedCategory(budget_id=budget.id, category_id=category.id)
    db.add(tracked)
    await db.flush()
    tracked_id = tracked.id

    await db.delete(budget)
    await db.commit()

    # Expire cache so the next query hits the DB and sees the cascade
    db.expire_all()
    result = await db.get(BudgetTrackedCategory, tracked_id)
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


async def test_base_budget_defaults_to_null(db, budget):
    """base_budget_id should default to null for standalone budgets."""
    assert budget.base_budget_id is None


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
        owner_id=user.id, name="April Budget", base_budget_id=template.id,
        period_start=date(2026, 4, 1), period_end=date(2026, 4, 30), currency="CAD",
    )
    db.add(instance)
    await db.flush()

    result = await db.get(Budget, instance.id)
    assert result.base_budget_id == template.id


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


# --- BudgetTrackedCategory: Basic CRUD ---


async def test_link_budget_to_category(db, budget, category):
    """Link a budget to a tracked category."""
    bcp = BudgetTrackedCategory(budget_id=budget.id, category_id=category.id)
    db.add(bcp)
    await db.flush()

    result = await db.get(BudgetTrackedCategory, bcp.id)
    assert result is not None
    assert result.budget_id == budget.id
    assert result.category_id == category.id
    assert result.added_at is not None
    assert result.removed_at is None


async def test_soft_delete_budget_category(db, budget, category):
    """Setting removed_at soft-deletes the category link."""
    from sqlalchemy import func

    bcp = BudgetTrackedCategory(budget_id=budget.id, category_id=category.id)
    db.add(bcp)
    await db.flush()

    bcp.removed_at = func.now()
    await db.flush()
    await db.refresh(bcp)

    assert bcp.removed_at is not None


async def test_multiple_tracked_categories(db, budget, user):
    """A budget can track multiple categories."""
    cat1 = Category(owner_id=user.id, name="Groceries 2", kind=CategoryKind.EXPENSE)
    cat2 = Category(owner_id=user.id, name="Dining", kind=CategoryKind.EXPENSE)
    db.add(cat1)
    db.add(cat2)
    await db.flush()

    bcp1 = BudgetTrackedCategory(budget_id=budget.id, category_id=cat1.id)
    bcp2 = BudgetTrackedCategory(budget_id=budget.id, category_id=cat2.id)
    db.add(bcp1)
    db.add(bcp2)
    await db.flush()

    r1 = await db.get(BudgetTrackedCategory, bcp1.id)
    r2 = await db.get(BudgetTrackedCategory, bcp2.id)
    assert r1 is not None
    assert r2 is not None


# --- BudgetTrackedCategory: Constraints ---


async def test_invalid_tracked_budget_rejected(db, category):
    """budget_id must reference a valid budget."""
    db.add(BudgetTrackedCategory(budget_id=NONEXISTENT_ID, category_id=category.id))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_invalid_tracked_category_rejected(db, budget):
    """category_id must reference a valid category."""
    db.add(BudgetTrackedCategory(budget_id=budget.id, category_id=NONEXISTENT_ID))
    with pytest.raises(IntegrityError):
        await db.flush()


# --- BudgetPermission fixtures ---


@pytest.fixture
async def household_membership(db, household, member):
    """Add the second user as a household member."""
    m = HouseholdMember(household_id=household.id, user_id=member.id)
    db.add(m)
    await db.flush()
    return m


@pytest.fixture
async def household_budget(db, household):
    """Seed a household-scoped budget."""
    b = Budget(
        household_id=household.id, owner_id=None, name="Family Budget",
        period_start=date(2026, 3, 1), period_end=date(2026, 3, 31), currency="CAD",
    )
    db.add(b)
    await db.flush()
    return b


# --- BudgetPermission: Basic CRUD ---


async def test_create_budget_permission(db, household, member, household_membership, household_budget):
    """Grant a budget permission and verify fields."""
    perm = BudgetPermission(
        household_id=household.id, user_id=member.id,
        budget_id=household_budget.id, level=PermissionLevel.READ,
    )
    db.add(perm)
    await db.flush()

    result = await db.get(BudgetPermission, perm.id)
    assert result is not None
    assert result.household_id == household.id
    assert result.user_id == member.id
    assert result.budget_id == household_budget.id
    assert result.level == PermissionLevel.READ
    assert result.created_at is not None


async def test_delete_budget_permission(db, household, member, household_membership, household_budget):
    """Revoke a budget permission by deleting the row."""
    perm = BudgetPermission(
        household_id=household.id, user_id=member.id,
        budget_id=household_budget.id, level=PermissionLevel.WRITE,
    )
    db.add(perm)
    await db.flush()
    perm_id = perm.id

    await db.delete(perm)
    await db.flush()

    result = await db.get(BudgetPermission, perm_id)
    assert result is None


# --- BudgetPermission: Constraints ---


async def test_duplicate_budget_permission_rejected(db, household, member, household_membership, household_budget):
    """Same (household, user, budget) combo cannot have two permission rows."""
    db.add(BudgetPermission(
        household_id=household.id, user_id=member.id,
        budget_id=household_budget.id, level=PermissionLevel.READ,
    ))
    await db.flush()

    db.add(BudgetPermission(
        household_id=household.id, user_id=member.id,
        budget_id=household_budget.id, level=PermissionLevel.WRITE,
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_budget_permission_invalid_budget_rejected(db, household, member, household_membership):
    """budget_id must reference a valid budget."""
    db.add(BudgetPermission(
        household_id=household.id, user_id=member.id,
        budget_id=NONEXISTENT_ID, level=PermissionLevel.READ,
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_budget_permission_invalid_household_rejected(db, member, household_budget):
    """household_id must reference a valid household."""
    db.add(BudgetPermission(
        household_id=NONEXISTENT_ID, user_id=member.id,
        budget_id=household_budget.id, level=PermissionLevel.READ,
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_budget_permission_invalid_user_rejected(db, household, household_budget):
    """user_id must reference a valid user."""
    db.add(BudgetPermission(
        household_id=household.id, user_id=NONEXISTENT_ID,
        budget_id=household_budget.id, level=PermissionLevel.READ,
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_budget_permission_non_member_rejected(db, household, member, household_budget):
    """User must be a household member to receive a budget permission."""
    db.add(BudgetPermission(
        household_id=household.id, user_id=member.id,
        budget_id=household_budget.id, level=PermissionLevel.READ,
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


# --- BudgetPermission: Cascades ---


async def test_budget_permission_cascades_on_member_removal(db, household, member, household_membership, household_budget):
    """Removing a member cascades to their budget permissions."""
    perm = BudgetPermission(
        household_id=household.id, user_id=member.id,
        budget_id=household_budget.id, level=PermissionLevel.READ,
    )
    db.add(perm)
    await db.flush()
    perm_id = perm.id

    await db.delete(household_membership)
    await db.commit()

    db.expire_all()
    result = await db.get(BudgetPermission, perm_id)
    assert result is None


async def test_budget_permission_cascades_on_budget_deletion(db, household, member, household_membership, household_budget):
    """Deleting a budget cascades to its permissions."""
    perm = BudgetPermission(
        household_id=household.id, user_id=member.id,
        budget_id=household_budget.id, level=PermissionLevel.WRITE,
    )
    db.add(perm)
    await db.flush()
    perm_id = perm.id

    await db.delete(household_budget)
    await db.commit()

    db.expire_all()
    result = await db.get(BudgetPermission, perm_id)
    assert result is None


async def test_budget_permission_cascades_on_household_deletion(db, household, member, household_membership, household_budget):
    """Deleting a household cascades to all its budget permissions."""
    perm = BudgetPermission(
        household_id=household.id, user_id=member.id,
        budget_id=household_budget.id, level=PermissionLevel.ADMIN,
    )
    db.add(perm)
    await db.flush()
    perm_id = perm.id

    await db.delete(household)
    await db.commit()

    db.expire_all()
    result = await db.get(BudgetPermission, perm_id)
    assert result is None
