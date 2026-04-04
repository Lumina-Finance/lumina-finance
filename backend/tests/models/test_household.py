import pytest
from sqlalchemy.exc import IntegrityError

from app.models.account import Account, AccountPermission
from app.models.base import AccountType, PermissionLevel, TaxTreatment
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
    """Seed a user."""
    u = User(email="user1@example.com", first_name="User", last_name="One", tz="America/Toronto", base_currency="CAD")
    db.add(u)
    await db.flush()
    return u


@pytest.fixture
async def member(db, currency):
    """Seed a second user for household membership."""
    u = User(email="user2@example.com", first_name="User", last_name="Two", tz="America/Toronto", base_currency="CAD")
    db.add(u)
    await db.flush()
    return u


@pytest.fixture
async def household(db, user):
    """Seed a household."""
    h = Household(owner_id=user.id, name="Test Household")
    db.add(h)
    await db.flush()
    return h


# --- Household: Basic CRUD ---


async def test_create_household(db, household, user):
    """Insert a household and verify fields."""
    result = await db.get(Household, household.id)
    assert result is not None
    assert result.owner_id == user.id
    assert result.name == "Test Household"
    assert result.created_at is not None


async def test_update_household(db, household):
    """Update a household's name."""
    household.name = "Updated Household"
    await db.flush()

    result = await db.get(Household, household.id)
    assert result.name == "Updated Household"


async def test_delete_household(db, household):
    """Delete a household."""
    hid = household.id
    await db.delete(household)
    await db.flush()

    result = await db.get(Household, hid)
    assert result is None


# --- Household: Constraints ---


async def test_null_owner_rejected(db):
    """Household owner_id is NOT NULL."""
    db.add(Household(owner_id=None, name="Invalid"))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_invalid_owner_rejected(db):
    """Household owner_id must reference a valid user."""
    db.add(Household(owner_id=NONEXISTENT_ID, name="Invalid"))
    with pytest.raises(IntegrityError):
        await db.flush()


# --- HouseholdMember: Basic CRUD ---


async def test_add_member(db, household, member):
    """Add a member to a household."""
    m = HouseholdMember(household_id=household.id, user_id=member.id)
    db.add(m)
    await db.flush()

    result = await db.get(HouseholdMember, (household.id, member.id))
    assert result is not None
    assert result.is_admin is False


async def test_remove_member(db, household, member):
    """Remove a member from a household."""
    m = HouseholdMember(household_id=household.id, user_id=member.id)
    db.add(m)
    await db.flush()

    await db.delete(m)
    await db.flush()

    result = await db.get(HouseholdMember, (household.id, member.id))
    assert result is None


# --- HouseholdMember: Defaults ---


async def test_is_admin_defaults_to_false(db, household, member):
    """is_admin should default to False."""
    m = HouseholdMember(household_id=household.id, user_id=member.id)
    db.add(m)
    await db.flush()

    result = await db.get(HouseholdMember, (household.id, member.id))
    assert result.is_admin is False


# --- HouseholdMember: Constraints ---


async def test_duplicate_member_rejected(db, household, member):
    """Same user can't be added to the same household twice."""
    db.add(HouseholdMember(household_id=household.id, user_id=member.id))
    await db.flush()

    db.add(HouseholdMember(household_id=household.id, user_id=member.id, is_admin=True))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_invalid_household_rejected(db, member):
    """household_id must reference a valid household."""
    db.add(HouseholdMember(household_id=NONEXISTENT_ID, user_id=member.id))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_invalid_user_rejected(db, household):
    """user_id must reference a valid user."""
    db.add(HouseholdMember(household_id=household.id, user_id=NONEXISTENT_ID))
    with pytest.raises(IntegrityError):
        await db.flush()


# --- AccountPermission fixtures ---


@pytest.fixture
async def household_membership(db, household, member):
    """Add the second user as a household member."""
    m = HouseholdMember(household_id=household.id, user_id=member.id)
    db.add(m)
    await db.flush()
    return m


@pytest.fixture
async def household_account(db, household, currency):
    """Seed a household-scoped account."""
    a = Account(
        household_id=household.id, owner_id=None,
        account_type=AccountType.CHECKING, tax_treatment=TaxTreatment.TAXABLE,
        name="Joint Checking", currency="CAD",
    )
    db.add(a)
    await db.flush()
    return a


# --- AccountPermission: Basic CRUD ---


async def test_create_account_permission(db, household, member, household_membership, household_account):
    """Grant a permission and verify fields."""
    perm = AccountPermission(
        household_id=household.id, user_id=member.id,
        account_id=household_account.id, level=PermissionLevel.READ,
    )
    db.add(perm)
    await db.flush()

    result = await db.get(AccountPermission, perm.id)
    assert result is not None
    assert result.household_id == household.id
    assert result.user_id == member.id
    assert result.account_id == household_account.id
    assert result.level == PermissionLevel.READ
    assert result.created_at is not None


async def test_delete_account_permission(db, household, member, household_membership, household_account):
    """Revoke a permission by deleting the row."""
    perm = AccountPermission(
        household_id=household.id, user_id=member.id,
        account_id=household_account.id, level=PermissionLevel.WRITE,
    )
    db.add(perm)
    await db.flush()
    perm_id = perm.id

    await db.delete(perm)
    await db.flush()

    result = await db.get(AccountPermission, perm_id)
    assert result is None


# --- AccountPermission: Constraints ---


async def test_duplicate_account_permission_rejected(db, household, member, household_membership, household_account):
    """Same (household, user, account) combo cannot have two permission rows."""
    db.add(AccountPermission(
        household_id=household.id, user_id=member.id,
        account_id=household_account.id, level=PermissionLevel.READ,
    ))
    await db.flush()

    db.add(AccountPermission(
        household_id=household.id, user_id=member.id,
        account_id=household_account.id, level=PermissionLevel.WRITE,
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_account_permission_invalid_account_rejected(db, household, member, household_membership):
    """account_id must reference a valid account."""
    db.add(AccountPermission(
        household_id=household.id, user_id=member.id,
        account_id=NONEXISTENT_ID, level=PermissionLevel.READ,
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_account_permission_invalid_household_rejected(db, member, household_account):
    """household_id must reference a valid household."""
    db.add(AccountPermission(
        household_id=NONEXISTENT_ID, user_id=member.id,
        account_id=household_account.id, level=PermissionLevel.READ,
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_account_permission_invalid_user_rejected(db, household, household_account):
    """user_id must reference a valid user."""
    db.add(AccountPermission(
        household_id=household.id, user_id=NONEXISTENT_ID,
        account_id=household_account.id, level=PermissionLevel.READ,
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_account_permission_non_member_rejected(db, household, member, household_account):
    """User must be a household member to receive a permission."""
    db.add(AccountPermission(
        household_id=household.id, user_id=member.id,
        account_id=household_account.id, level=PermissionLevel.READ,
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


# --- AccountPermission: Cascades ---


async def test_account_permission_cascades_on_member_removal(db, household, member, household_membership, household_account):
    """Removing a member cascades to their account permissions."""
    perm = AccountPermission(
        household_id=household.id, user_id=member.id,
        account_id=household_account.id, level=PermissionLevel.READ,
    )
    db.add(perm)
    await db.flush()
    perm_id = perm.id

    await db.delete(household_membership)
    await db.commit()

    db.expire_all()
    result = await db.get(AccountPermission, perm_id)
    assert result is None


async def test_account_permission_cascades_on_account_deletion(db, household, member, household_membership, household_account):
    """Deleting an account cascades to its permissions."""
    perm = AccountPermission(
        household_id=household.id, user_id=member.id,
        account_id=household_account.id, level=PermissionLevel.WRITE,
    )
    db.add(perm)
    await db.flush()
    perm_id = perm.id

    await db.delete(household_account)
    await db.commit()

    db.expire_all()
    result = await db.get(AccountPermission, perm_id)
    assert result is None


async def test_account_permission_cascades_on_household_deletion(db, household, member, household_membership, household_account):
    """Deleting a household cascades to all its account permissions."""
    perm = AccountPermission(
        household_id=household.id, user_id=member.id,
        account_id=household_account.id, level=PermissionLevel.ADMIN,
    )
    db.add(perm)
    await db.flush()
    perm_id = perm.id

    await db.delete(household)
    await db.commit()

    db.expire_all()
    result = await db.get(AccountPermission, perm_id)
    assert result is None
