import pytest
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from app.models.base import CategoryKind, PermissionLevel, RecurrenceFreq
from app.models.budget import BaseBudget, BudgetPermission, BudgetTrackedCategory
from app.models.category import Category
from app.models.currency import Currency
from app.models.group import Group, GroupMember
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
    """Seed a second user for permission-target scoping."""
    u = User(email="member@example.com", first_name="Test", last_name="Member", tz="America/Toronto", base_currency="CAD")
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
    """Seed a personal monthly base budget."""
    b = BaseBudget(
        owner_id=user.id, name="March Budget", currency="CAD",
        recurrence_freq=RecurrenceFreq.MONTHLY, recurrence_dom=1,
    )
    db.add(b)
    await db.flush()
    return b


@pytest.fixture
async def category(db, user):
    """Seed a personal category for tracked-category linking."""
    c = Category(owner_id=user.id, name="Groceries", kind=CategoryKind.EXPENSE)
    db.add(c)
    await db.flush()
    return c


# --- BaseBudget: Basic CRUD ---


async def test_create_base_budget(db, base_budget, user):
    """Insert a base budget and verify fields."""
    result = await db.get(BaseBudget, base_budget.id)
    assert result is not None
    assert result.owner_id == user.id
    assert result.name == "March Budget"
    assert result.currency == "CAD"
    assert result.recurrence_freq == RecurrenceFreq.MONTHLY
    assert result.instance_length == 1
    assert result.recurrence_dom == 1
    assert result.recurrence_weekday is None
    assert result.recurrence_month is None
    assert result.recurs is False


async def test_update_base_budget(db, base_budget):
    """Update a base budget's name; created_at stays pinned so history isn't rewritten."""
    original_created_at = base_budget.created_at
    base_budget.name = "Updated Budget"
    await db.flush()

    result = await db.get(BaseBudget, base_budget.id)
    assert result.name == "Updated Budget"
    assert result.created_at == original_created_at


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


async def test_instance_length_defaults_to_one(db, base_budget):
    """instance_length defaults to 1 when not explicitly set."""
    assert base_budget.instance_length == 1


async def test_recurs_defaults_to_false(db, base_budget):
    """Recurs defaults to False when not explicitly set."""
    assert base_budget.recurs is False


# --- BaseBudget: Recurring ---


async def test_recurring_base_budget(db, user):
    """Create a recurring base budget with monthly cadence."""
    b = BaseBudget(
        owner_id=user.id, name="Monthly Budget", currency="CAD",
        recurrence_freq=RecurrenceFreq.MONTHLY, instance_length=1,
        recurrence_dom=1, recurs=True,
    )
    db.add(b)
    await db.flush()

    result = await db.get(BaseBudget, b.id)
    assert result.recurrence_freq == RecurrenceFreq.MONTHLY
    assert result.instance_length == 1
    assert result.recurrence_dom == 1
    assert result.recurs is True


# --- BaseBudget: Owner XOR Group Check Constraint ---


async def test_personal_base_budget_accepted(db, user):
    """BaseBudget with owner_id and no group_id should be valid."""
    b = BaseBudget(owner_id=user.id, name="Personal", currency="CAD", recurrence_freq=RecurrenceFreq.MONTHLY, recurrence_dom=1)
    db.add(b)
    await db.flush()

    result = await db.get(BaseBudget, b.id)
    assert result.owner_id == user.id
    assert result.group_id is None


async def test_group_base_budget_accepted(db, group):
    """BaseBudget with group_id and no owner_id should be valid."""
    b = BaseBudget(group_id=group.id, name="Family Budget", currency="CAD", recurrence_freq=RecurrenceFreq.MONTHLY, recurrence_dom=1)
    db.add(b)
    await db.flush()

    result = await db.get(BaseBudget, b.id)
    assert result.owner_id is None
    assert result.group_id == group.id


async def test_both_owner_and_group_rejected(db, user, group):
    """BaseBudget with both owner_id and group_id should be rejected."""
    db.add(BaseBudget(
        owner_id=user.id, group_id=group.id, name="Invalid", currency="CAD",
        recurrence_freq=RecurrenceFreq.MONTHLY, recurrence_dom=1,
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_neither_owner_nor_group_rejected(db, currency):
    """BaseBudget with neither owner_id nor group_id should be rejected."""
    db.add(BaseBudget(name="Orphan", currency="CAD", recurrence_freq=RecurrenceFreq.MONTHLY, recurrence_dom=1))
    with pytest.raises(IntegrityError):
        await db.flush()


# --- BaseBudget: Constraints ---


async def test_null_name_rejected(db, user):
    """Name is NOT NULL."""
    db.add(BaseBudget(owner_id=user.id, name=None, currency="CAD", recurrence_freq=RecurrenceFreq.MONTHLY, recurrence_dom=1))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_null_currency_rejected(db, user):
    """Currency is NOT NULL."""
    db.add(BaseBudget(owner_id=user.id, name="Bad", currency=None, recurrence_freq=RecurrenceFreq.MONTHLY, recurrence_dom=1))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_invalid_currency_rejected(db, user):
    """Currency must reference a valid currency."""
    db.add(BaseBudget(owner_id=user.id, name="Bad", currency="ZZZ", recurrence_freq=RecurrenceFreq.MONTHLY, recurrence_dom=1))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_instance_length_zero_rejected(db, user):
    """instance_length must be > 0 (zero boundary)."""
    db.add(BaseBudget(
        owner_id=user.id, name="Bad", currency="CAD",
        recurrence_freq=RecurrenceFreq.MONTHLY, instance_length=0, recurrence_dom=1,
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_instance_length_negative_rejected(db, user):
    """instance_length must be > 0 (rejects negatives)."""
    db.add(BaseBudget(
        owner_id=user.id, name="Bad", currency="CAD",
        recurrence_freq=RecurrenceFreq.MONTHLY, instance_length=-3, recurrence_dom=1,
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_invalid_owner_rejected(db, currency):
    """owner_id must reference a valid user."""
    db.add(BaseBudget(owner_id=NONEXISTENT_ID, name="Bad", currency="CAD", recurrence_freq=RecurrenceFreq.MONTHLY, recurrence_dom=1))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_invalid_group_rejected(db, currency):
    """group_id must reference a valid group."""
    db.add(BaseBudget(group_id=NONEXISTENT_ID, name="Bad", currency="CAD", recurrence_freq=RecurrenceFreq.MONTHLY, recurrence_dom=1))
    with pytest.raises(IntegrityError):
        await db.flush()


# --- BaseBudget: Cascades ---


async def test_base_budget_cascades_on_group_deletion(db, group):
    """Deleting a group cascades to its group-owned base budgets."""
    b = BaseBudget(group_id=group.id, name="Family Budget", currency="CAD", recurrence_freq=RecurrenceFreq.MONTHLY, recurrence_dom=1)
    db.add(b)
    await db.flush()
    bid = b.id

    await db.delete(group)
    await db.commit()

    db.expire_all()
    result = await db.get(BaseBudget, bid)
    assert result is None


# --- BudgetTrackedCategory: Basic CRUD ---


async def test_link_base_budget_to_category(db, base_budget, category):
    """Link a base budget to a tracked category."""
    btc = BudgetTrackedCategory(base_budget_id=base_budget.id, category_id=category.id)
    db.add(btc)
    await db.flush()

    result = await db.get(BudgetTrackedCategory, btc.id)
    assert result is not None
    assert result.base_budget_id == base_budget.id
    assert result.category_id == category.id
    assert result.added_at is not None
    assert result.removed_at is None


async def test_soft_delete_tracked_category(db, base_budget, category):
    """Setting removed_at soft-deletes the row; the PK is still retrievable."""
    btc = BudgetTrackedCategory(base_budget_id=base_budget.id, category_id=category.id)
    db.add(btc)
    await db.flush()
    btc_id = btc.id

    btc.removed_at = func.now()
    await db.flush()
    db.expire_all()

    result = await db.get(BudgetTrackedCategory, btc_id)
    assert result is not None
    assert result.removed_at is not None


async def test_multiple_tracked_categories(db, base_budget, user):
    """A base budget can track multiple distinct categories."""
    cat1 = Category(owner_id=user.id, name="Groceries 2", kind=CategoryKind.EXPENSE)
    cat2 = Category(owner_id=user.id, name="Dining", kind=CategoryKind.EXPENSE)
    db.add(cat1)
    db.add(cat2)
    await db.flush()

    btc1 = BudgetTrackedCategory(base_budget_id=base_budget.id, category_id=cat1.id)
    btc2 = BudgetTrackedCategory(base_budget_id=base_budget.id, category_id=cat2.id)
    db.add(btc1)
    db.add(btc2)
    await db.flush()

    r1 = await db.get(BudgetTrackedCategory, btc1.id)
    r2 = await db.get(BudgetTrackedCategory, btc2.id)
    assert r1 is not None
    assert r2 is not None


# --- BudgetTrackedCategory: Constraints ---


async def test_tracked_category_invalid_base_budget_rejected(db, category):
    """base_budget_id must reference a valid base budget."""
    db.add(BudgetTrackedCategory(base_budget_id=NONEXISTENT_ID, category_id=category.id))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_tracked_category_invalid_category_rejected(db, base_budget):
    """category_id must reference a valid category."""
    db.add(BudgetTrackedCategory(base_budget_id=base_budget.id, category_id=NONEXISTENT_ID))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_duplicate_active_tracked_category_rejected(db, base_budget, category):
    """Partial unique index blocks two active rows for the same (base, category)."""
    db.add(BudgetTrackedCategory(base_budget_id=base_budget.id, category_id=category.id))
    await db.flush()

    db.add(BudgetTrackedCategory(base_budget_id=base_budget.id, category_id=category.id))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_active_tracked_category_scoped_per_base(db, user, category):
    """The partial unique index is per-base: two bases may both track the same category."""
    base_a = BaseBudget(owner_id=user.id, name="Base A", currency="CAD", recurrence_freq=RecurrenceFreq.MONTHLY, recurrence_dom=1)
    base_b = BaseBudget(owner_id=user.id, name="Base B", currency="CAD", recurrence_freq=RecurrenceFreq.MONTHLY, recurrence_dom=1)
    db.add(base_a)
    db.add(base_b)
    await db.flush()

    btc_a = BudgetTrackedCategory(base_budget_id=base_a.id, category_id=category.id)
    btc_b = BudgetTrackedCategory(base_budget_id=base_b.id, category_id=category.id)
    db.add(btc_a)
    db.add(btc_b)
    await db.flush()

    assert btc_a.id != btc_b.id
    assert btc_a.removed_at is None
    assert btc_b.removed_at is None


async def test_historical_tracked_category_rows_allowed(db, base_budget, category):
    """Re-adding a category after removal is allowed; the partial index ignores removed rows."""
    # First addition — then soft-delete it
    first = BudgetTrackedCategory(base_budget_id=base_budget.id, category_id=category.id)
    db.add(first)
    await db.flush()
    first.removed_at = func.now()
    await db.flush()

    # Re-add the same category — should succeed as a second historical row
    second = BudgetTrackedCategory(base_budget_id=base_budget.id, category_id=category.id)
    db.add(second)
    await db.flush()

    assert first.id != second.id
    assert second.removed_at is None


async def test_tracked_categories_cascade_on_base_budget_deletion(db, base_budget, category):
    """Deleting a base budget cascades to its tracked-category rows."""
    btc = BudgetTrackedCategory(base_budget_id=base_budget.id, category_id=category.id)
    db.add(btc)
    await db.flush()
    btc_id = btc.id

    await db.delete(base_budget)
    await db.commit()

    db.expire_all()
    result = await db.get(BudgetTrackedCategory, btc_id)
    assert result is None


# --- BudgetPermission fixtures ---


@pytest.fixture
async def group_membership(db, group, member):
    """Add the second user as a group member for permission scoping."""
    m = GroupMember(group_id=group.id, user_id=member.id)
    db.add(m)
    await db.flush()
    return m


@pytest.fixture
async def group_base_budget(db, group):
    """Seed a group-owned base budget for permission scoping."""
    b = BaseBudget(
        group_id=group.id, owner_id=None, name="Family Budget", currency="CAD",
        recurrence_freq=RecurrenceFreq.MONTHLY, recurrence_dom=1,
    )
    db.add(b)
    await db.flush()
    return b


# --- BudgetPermission: Basic CRUD ---


async def test_create_budget_permission(db, group, member, group_membership, group_base_budget):
    """Grant a base-budget permission and verify fields."""
    perm = BudgetPermission(
        group_id=group.id, user_id=member.id,
        base_budget_id=group_base_budget.id, level=PermissionLevel.READ,
    )
    db.add(perm)
    await db.flush()

    result = await db.get(BudgetPermission, perm.id)
    assert result is not None
    assert result.group_id == group.id
    assert result.user_id == member.id
    assert result.base_budget_id == group_base_budget.id
    assert result.level == PermissionLevel.READ
    assert result.created_at is not None


async def test_delete_budget_permission(db, group, member, group_membership, group_base_budget):
    """Revoke a base-budget permission by deleting the row."""
    perm = BudgetPermission(
        group_id=group.id, user_id=member.id,
        base_budget_id=group_base_budget.id, level=PermissionLevel.WRITE,
    )
    db.add(perm)
    await db.flush()
    perm_id = perm.id

    await db.delete(perm)
    await db.flush()

    result = await db.get(BudgetPermission, perm_id)
    assert result is None


async def test_update_budget_permission_level(db, group, member, group_membership, group_base_budget):
    """Permission level is mutable in place — the route layer relies on this for regrants."""
    perm = BudgetPermission(
        group_id=group.id, user_id=member.id,
        base_budget_id=group_base_budget.id, level=PermissionLevel.READ,
    )
    db.add(perm)
    await db.flush()

    perm.level = PermissionLevel.WRITE
    await db.flush()
    await db.refresh(perm)

    assert perm.level == PermissionLevel.WRITE


# --- BudgetPermission: Constraints ---


async def test_duplicate_budget_permission_rejected(db, group, member, group_membership, group_base_budget):
    """Same (group, user, base_budget) combo cannot have two permission rows."""
    db.add(BudgetPermission(
        group_id=group.id, user_id=member.id,
        base_budget_id=group_base_budget.id, level=PermissionLevel.READ,
    ))
    await db.flush()

    db.add(BudgetPermission(
        group_id=group.id, user_id=member.id,
        base_budget_id=group_base_budget.id, level=PermissionLevel.WRITE,
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_budget_permission_invalid_base_budget_rejected(db, group, member, group_membership):
    """base_budget_id must reference a valid base budget."""
    db.add(BudgetPermission(
        group_id=group.id, user_id=member.id,
        base_budget_id=NONEXISTENT_ID, level=PermissionLevel.READ,
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_budget_permission_invalid_group_rejected(db, member, group_base_budget):
    """group_id must reference a valid group."""
    db.add(BudgetPermission(
        group_id=NONEXISTENT_ID, user_id=member.id,
        base_budget_id=group_base_budget.id, level=PermissionLevel.READ,
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_budget_permission_invalid_user_rejected(db, group, group_base_budget):
    """user_id must reference a valid user."""
    db.add(BudgetPermission(
        group_id=group.id, user_id=NONEXISTENT_ID,
        base_budget_id=group_base_budget.id, level=PermissionLevel.READ,
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_budget_permission_non_member_rejected(db, group, member, group_base_budget):
    """User must be a group member to receive a budget permission."""
    db.add(BudgetPermission(
        group_id=group.id, user_id=member.id,
        base_budget_id=group_base_budget.id, level=PermissionLevel.READ,
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


# --- BudgetPermission: Cascades ---


async def test_budget_permission_cascades_on_member_removal(
    db, group, member, group_membership, group_base_budget,
):
    """Removing a group member cascades to their budget permissions."""
    perm = BudgetPermission(
        group_id=group.id, user_id=member.id,
        base_budget_id=group_base_budget.id, level=PermissionLevel.READ,
    )
    db.add(perm)
    await db.flush()
    perm_id = perm.id

    await db.delete(group_membership)
    await db.commit()

    db.expire_all()
    result = await db.get(BudgetPermission, perm_id)
    assert result is None


async def test_budget_permission_cascades_on_base_budget_deletion(
    db, group, member, group_membership, group_base_budget,
):
    """Deleting a base budget cascades to its permissions."""
    perm = BudgetPermission(
        group_id=group.id, user_id=member.id,
        base_budget_id=group_base_budget.id, level=PermissionLevel.WRITE,
    )
    db.add(perm)
    await db.flush()
    perm_id = perm.id

    await db.delete(group_base_budget)
    await db.commit()

    db.expire_all()
    result = await db.get(BudgetPermission, perm_id)
    assert result is None


async def test_budget_permission_cascades_on_group_deletion(
    db, group, member, group_membership, group_base_budget,
):
    """Deleting a group cascades to all its budget permissions."""
    perm = BudgetPermission(
        group_id=group.id, user_id=member.id,
        base_budget_id=group_base_budget.id, level=PermissionLevel.ADMIN,
    )
    db.add(perm)
    await db.flush()
    perm_id = perm.id

    await db.delete(group)
    await db.commit()

    db.expire_all()
    result = await db.get(BudgetPermission, perm_id)
    assert result is None
