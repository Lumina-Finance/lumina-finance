import pytest
from sqlalchemy.exc import IntegrityError

from app.models.account import Account, AccountPermission
from app.models.base import AccountType, PermissionLevel, TaxTreatment
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
    """Seed a user."""
    u = User(email="user1@example.com", first_name="User", last_name="One", tz="America/Toronto", base_currency="CAD")
    db.add(u)
    await db.flush()
    return u


@pytest.fixture
async def member(db, currency):
    """Seed a second user for group membership."""
    u = User(email="user2@example.com", first_name="User", last_name="Two", tz="America/Toronto", base_currency="CAD")
    db.add(u)
    await db.flush()
    return u


@pytest.fixture
async def group(db, user):
    """Seed a group."""
    g = Group(owner_id=user.id, name="Test Group")
    db.add(g)
    await db.flush()
    return g


# --- Group: Basic CRUD ---


async def test_create_group(db, group, user):
    """Insert a group and verify fields."""
    result = await db.get(Group, group.id)
    assert result is not None
    assert result.owner_id == user.id
    assert result.name == "Test Group"
    assert result.created_at is not None


async def test_update_group(db, group):
    """Update a group's name."""
    group.name = "Updated Group"
    await db.flush()

    result = await db.get(Group, group.id)
    assert result.name == "Updated Group"


async def test_delete_group(db, group):
    """Delete a group."""
    hid = group.id
    await db.delete(group)
    await db.flush()

    result = await db.get(Group, hid)
    assert result is None


# --- Group: Constraints ---


async def test_null_owner_rejected(db):
    """Group owner_id is NOT NULL."""
    db.add(Group(owner_id=None, name="Invalid"))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_invalid_owner_rejected(db):
    """Group owner_id must reference a valid user."""
    db.add(Group(owner_id=NONEXISTENT_ID, name="Invalid"))
    with pytest.raises(IntegrityError):
        await db.flush()


# --- GroupMember: Basic CRUD ---


async def test_add_member(db, group, member):
    """Add a member to a group."""
    m = GroupMember(group_id=group.id, user_id=member.id)
    db.add(m)
    await db.flush()

    result = await db.get(GroupMember, (group.id, member.id))
    assert result is not None
    assert result.is_admin is False


async def test_remove_member(db, group, member):
    """Remove a member from a group."""
    m = GroupMember(group_id=group.id, user_id=member.id)
    db.add(m)
    await db.flush()

    await db.delete(m)
    await db.flush()

    result = await db.get(GroupMember, (group.id, member.id))
    assert result is None


# --- GroupMember: Defaults ---


async def test_is_admin_defaults_to_false(db, group, member):
    """is_admin should default to False."""
    m = GroupMember(group_id=group.id, user_id=member.id)
    db.add(m)
    await db.flush()

    result = await db.get(GroupMember, (group.id, member.id))
    assert result.is_admin is False


# --- GroupMember: Constraints ---


async def test_duplicate_member_rejected(db, group, member):
    """Same user can't be added to the same group twice."""
    db.add(GroupMember(group_id=group.id, user_id=member.id))
    await db.flush()

    db.add(GroupMember(group_id=group.id, user_id=member.id, is_admin=True))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_invalid_group_rejected(db, member):
    """group_id must reference a valid group."""
    db.add(GroupMember(group_id=NONEXISTENT_ID, user_id=member.id))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_invalid_user_rejected(db, group):
    """user_id must reference a valid user."""
    db.add(GroupMember(group_id=group.id, user_id=NONEXISTENT_ID))
    with pytest.raises(IntegrityError):
        await db.flush()


# --- AccountPermission fixtures ---


@pytest.fixture
async def group_membership(db, group, member):
    """Add the second user as a group member."""
    m = GroupMember(group_id=group.id, user_id=member.id)
    db.add(m)
    await db.flush()
    return m


@pytest.fixture
async def group_account(db, group, currency):
    """Seed a group-scoped account."""
    a = Account(
        group_id=group.id, owner_id=None,
        account_type=AccountType.CHECKING, tax_treatment=TaxTreatment.TAXABLE,
        name="Joint Checking", currency="CAD",
    )
    db.add(a)
    await db.flush()
    return a


# --- AccountPermission: Basic CRUD ---


async def test_create_account_permission(db, group, member, group_membership, group_account):
    """Grant a permission and verify fields."""
    perm = AccountPermission(
        group_id=group.id, user_id=member.id,
        account_id=group_account.id, level=PermissionLevel.READ,
    )
    db.add(perm)
    await db.flush()

    result = await db.get(AccountPermission, perm.id)
    assert result is not None
    assert result.group_id == group.id
    assert result.user_id == member.id
    assert result.account_id == group_account.id
    assert result.level == PermissionLevel.READ
    assert result.created_at is not None


async def test_delete_account_permission(db, group, member, group_membership, group_account):
    """Revoke a permission by deleting the row."""
    perm = AccountPermission(
        group_id=group.id, user_id=member.id,
        account_id=group_account.id, level=PermissionLevel.WRITE,
    )
    db.add(perm)
    await db.flush()
    perm_id = perm.id

    await db.delete(perm)
    await db.flush()

    result = await db.get(AccountPermission, perm_id)
    assert result is None


# --- AccountPermission: Constraints ---


async def test_duplicate_account_permission_rejected(db, group, member, group_membership, group_account):
    """Same (group, user, account) combo cannot have two permission rows."""
    db.add(AccountPermission(
        group_id=group.id, user_id=member.id,
        account_id=group_account.id, level=PermissionLevel.READ,
    ))
    await db.flush()

    db.add(AccountPermission(
        group_id=group.id, user_id=member.id,
        account_id=group_account.id, level=PermissionLevel.WRITE,
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_account_permission_invalid_account_rejected(db, group, member, group_membership):
    """account_id must reference a valid account."""
    db.add(AccountPermission(
        group_id=group.id, user_id=member.id,
        account_id=NONEXISTENT_ID, level=PermissionLevel.READ,
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_account_permission_invalid_group_rejected(db, member, group_account):
    """group_id must reference a valid group."""
    db.add(AccountPermission(
        group_id=NONEXISTENT_ID, user_id=member.id,
        account_id=group_account.id, level=PermissionLevel.READ,
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_account_permission_invalid_user_rejected(db, group, group_account):
    """user_id must reference a valid user."""
    db.add(AccountPermission(
        group_id=group.id, user_id=NONEXISTENT_ID,
        account_id=group_account.id, level=PermissionLevel.READ,
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_account_permission_non_member_rejected(db, group, member, group_account):
    """User must be a group member to receive a permission."""
    db.add(AccountPermission(
        group_id=group.id, user_id=member.id,
        account_id=group_account.id, level=PermissionLevel.READ,
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


# --- AccountPermission: Cascades ---


async def test_account_permission_cascades_on_member_removal(db, group, member, group_membership, group_account):
    """Removing a member cascades to their account permissions."""
    perm = AccountPermission(
        group_id=group.id, user_id=member.id,
        account_id=group_account.id, level=PermissionLevel.READ,
    )
    db.add(perm)
    await db.flush()
    perm_id = perm.id

    await db.delete(group_membership)
    await db.commit()

    db.expire_all()
    result = await db.get(AccountPermission, perm_id)
    assert result is None


async def test_account_permission_cascades_on_account_deletion(db, group, member, group_membership, group_account):
    """Deleting an account cascades to its permissions."""
    perm = AccountPermission(
        group_id=group.id, user_id=member.id,
        account_id=group_account.id, level=PermissionLevel.WRITE,
    )
    db.add(perm)
    await db.flush()
    perm_id = perm.id

    await db.delete(group_account)
    await db.commit()

    db.expire_all()
    result = await db.get(AccountPermission, perm_id)
    assert result is None


async def test_account_permission_cascades_on_group_deletion(db, group, member, group_membership, group_account):
    """Deleting a group cascades to all its account permissions."""
    perm = AccountPermission(
        group_id=group.id, user_id=member.id,
        account_id=group_account.id, level=PermissionLevel.ADMIN,
    )
    db.add(perm)
    await db.flush()
    perm_id = perm.id

    await db.delete(group)
    await db.commit()

    db.expire_all()
    result = await db.get(AccountPermission, perm_id)
    assert result is None
