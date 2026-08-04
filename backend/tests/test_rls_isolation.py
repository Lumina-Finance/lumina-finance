"""Row-level security isolation tests exercised as the runtime app role

Every other test connects as the table owner, which bypasses row-level security,
so the policies are present but never enforced. These tests connect as the
runtime app role, which is subject to the policies, to prove they actually keep
one user's data out of another user's reach at the database level
"""

import uuid
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import delete, select, text
from sqlalchemy.exc import ProgrammingError

from app.database import current_user_id_ctx
from app.models.account import Account
from app.models.base import AccountKind, AccountType, CategoryKind, RecurrenceFreq
from app.models.budget import BaseBudget, Budget, BudgetTrackedCategory
from app.models.cache_state import UserCacheState
from app.models.category import Category
from app.models.currency import Currency
from app.models.group import Group, GroupMember
from app.models.transaction import Transaction
from app.models.user import User
from tests.conftest import ScopedSession, TestSession


@asynccontextmanager
async def _act_as(user_id):
    """Yield a scoped session whose statements run as the given user

    The identity is set on the same context variable the app uses, so the session's
    begin listener stamps it for the policies, mirroring a real request. Nothing is
    committed here, so a write inside the block is discarded unless the test commits it
    deliberately, and the per-test truncation clears whatever a test does commit
    """
    token = current_user_id_ctx.set(user_id)
    try:
        async with ScopedSession() as session:
            yield session
    finally:
        current_user_id_ctx.reset(token)


def _build_user(email: str) -> User:
    """Return an unsaved user with the shared fields every test user needs"""
    return User(email=email, first_name="Test", tz="America/Toronto", base_currency="CAD")


def _build_account(owner_id, name: str) -> Account:
    """Return an unsaved personal chequing account owned by the given user"""
    return Account(
        owner_id=owner_id,
        account_kind=AccountKind.ASSET,
        account_type=AccountType.CHECKING,
        name=name,
        currency="CAD",
    )


@pytest.fixture
async def users():
    """Seed two unrelated users and the currency their accounts reference"""
    user_a = _build_user("a@example.com")
    user_b = _build_user("b@example.com")
    async with TestSession() as session:
        session.add(Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2))
        session.add_all([user_a, user_b])
        await session.commit()
    return user_a, user_b


async def test_personal_account_is_invisible_to_other_users(users):
    """A personal account is readable by its owner and no one else"""
    user_a, user_b = users
    account = _build_account(user_a.id, "A Chequing")
    async with TestSession() as session:
        session.add(account)
        await session.commit()

    async with _act_as(user_a.id) as session:
        owner_view = (await session.scalars(select(Account.id))).all()
        assert account.id in owner_view

    async with _act_as(user_b.id) as session:
        other_view = (await session.scalars(select(Account.id))).all()
        assert account.id not in other_view


async def test_user_cannot_create_account_owned_by_another(users):
    """Writing an account owned by another user is rejected by the write check"""
    user_a, user_b = users
    async with _act_as(user_b.id) as session:
        session.add(_build_account(user_a.id, "Forged"))
        with pytest.raises(ProgrammingError, match="row-level security"):
            await session.flush()


async def test_transactions_follow_account_access(users):
    """A transaction is visible only to a user who can reach its account"""
    user_a, user_b = users
    async with TestSession() as session:

        # Reuse a seeded system category so the transaction has a valid category
        system_category_id = await session.scalar(select(Category.id).where(Category.is_system).limit(1))
        account = _build_account(user_a.id, "A Chequing")
        session.add(account)
        await session.flush()
        transaction = Transaction(
            created_by_user_id=user_a.id,
            account_id=account.id,
            dt=datetime.now(UTC),
            category_id=system_category_id,
            amount=Decimal("12.34"),
            currency="CAD",
        )
        session.add(transaction)
        await session.commit()

    async with _act_as(user_b.id) as session:
        assert (await session.scalars(select(Transaction.id))).all() == []

    async with _act_as(user_a.id) as session:
        assert transaction.id in (await session.scalars(select(Transaction.id))).all()


async def test_users_table_exposes_only_the_current_user(users):
    """The users table returns only the row matching the request identity"""
    user_a, _ = users
    async with _act_as(user_a.id) as session:
        assert (await session.scalars(select(User.id))).all() == [user_a.id]


async def test_system_categories_are_shared_but_personal_ones_are_isolated(users):
    """System categories are readable by everyone while personal ones stay private"""
    user_a, user_b = users
    personal_category = Category(owner_id=user_a.id, name="A Private", kind=CategoryKind.EXPENSE, is_system=False)
    async with TestSession() as session:
        session.add(personal_category)
        await session.commit()

    async with _act_as(user_b.id) as session:
        visible = (await session.scalars(select(Category.id))).all()
        assert personal_category.id not in visible

        # The shared system categories remain readable, so the isolation above is
        # not just an empty result for everyone
        assert len(visible) > 0


async def test_group_is_hidden_until_the_user_is_a_member(users):
    """A group becomes visible to a user only once they are added as a member"""
    user_a, user_b = users
    group = Group(owner_id=user_a.id, name="A Family")
    async with TestSession() as session:
        session.add(group)
        await session.commit()

    async with _act_as(user_b.id) as session:
        assert group.id not in (await session.scalars(select(Group.id))).all()

    async with TestSession() as session:
        session.add(GroupMember(group_id=group.id, user_id=user_b.id))
        await session.commit()

    async with _act_as(user_b.id) as session:
        assert group.id in (await session.scalars(select(Group.id))).all()


async def test_owner_can_create_and_read_back_account(users):
    """An owner can insert an account and read it back in the same transaction

    The flush issues INSERT ... RETURNING, whose SELECT policy runs against the new
    row. The policy must accept it for the owner that just created it, even though the
    access helper queries a snapshot that predates the insert
    """
    user_a, _ = users
    async with _act_as(user_a.id) as session:
        account = _build_account(user_a.id, "Fresh")
        session.add(account)
        await session.flush()
        assert account.id in (await session.scalars(select(Account.id))).all()


async def test_owner_can_create_and_read_back_group(users):
    """An owner can insert a group and read it back in the same transaction"""
    user_a, _ = users
    async with _act_as(user_a.id) as session:
        group = Group(owner_id=user_a.id, name="Fresh Family")
        session.add(group)
        await session.flush()
        assert group.id in (await session.scalars(select(Group.id))).all()


async def test_budget_spend_rows_returns_nothing_to_unauthorized_readers(users):
    """The privileged spend aggregation only returns rows for budgets the caller can access

    The function bypasses account-level policies to compute totals, so it must authorize
    itself rather than trusting callers, otherwise it would leak another user's spend
    """
    user_a, user_b = users
    async with TestSession() as session:

        # The tracked category and the transaction share a seeded system category
        system_category_id = await session.scalar(select(Category.id).where(Category.is_system).limit(1))
        account = _build_account(user_a.id, "A Chequing")
        base_budget = BaseBudget(
            owner_id=user_a.id,
            name="A Groceries",
            currency="CAD",
            recurrence_freq=RecurrenceFreq.MONTHLY,
        )
        session.add_all([account, base_budget])
        await session.flush()
        budget = Budget(
            base_budget_id=base_budget.id,
            period_start=date(2026, 3, 1),
            period_end=date(2026, 3, 31),
            overall_limit=100000,
        )
        session.add(budget)
        session.add(BudgetTrackedCategory(
            base_budget_id=base_budget.id,
            category_id=system_category_id,
            added_at=date(2026, 1, 1),
        ))
        session.add(Transaction(
            created_by_user_id=user_a.id,
            account_id=account.id,
            dt=date(2026, 3, 15),
            category_id=system_category_id,
            amount=-5000,
            currency="CAD",
        ))
        await session.commit()

    spend_query = text("SELECT id FROM public.budget_spend_rows(:budget_ids)")

    async with _act_as(user_a.id) as session:
        owner_rows = (await session.execute(spend_query, {"budget_ids": [budget.id]})).all()
        assert len(owner_rows) > 0

    async with _act_as(user_b.id) as session:
        other_rows = (await session.execute(spend_query, {"budget_ids": [budget.id]})).all()
        assert other_rows == []


_BUMP_MEMBER_CACHE = text("SELECT public.bump_group_member_cache(:user_id, :group_id)")


@pytest.fixture
async def group_with_admin_and_member(users):
    """Seed a group whose owner is an admin and whose second user is a plain member"""
    user_a, user_b = users
    group = Group(owner_id=user_a.id, name="A Family")
    async with TestSession() as session:
        session.add(group)
        await session.flush()
        session.add_all([
            GroupMember(group_id=group.id, user_id=user_a.id, is_admin=True),
            GroupMember(group_id=group.id, user_id=user_b.id),
        ])
        await session.commit()
    return group, user_a, user_b


async def test_cache_bump_is_refused_for_a_group_the_caller_does_not_administer(group_with_admin_and_member):
    """A plain member cannot invalidate another member's cache through the privileged helper"""
    group, user_a, user_b = group_with_admin_and_member
    async with _act_as(user_b.id) as session:
        with pytest.raises(ProgrammingError, match="Not authorized"):
            await session.execute(_BUMP_MEMBER_CACHE, {"user_id": user_a.id, "group_id": group.id})


async def test_cache_bump_is_refused_for_a_stranger(users):
    """A user outside every group of the target cannot invalidate the target's cache"""
    user_a, user_b = users
    async with _act_as(user_b.id) as session:
        with pytest.raises(ProgrammingError, match="Not authorized"):
            await session.execute(_BUMP_MEMBER_CACHE, {"user_id": user_a.id, "group_id": uuid.uuid4()})


async def _read_cache_changed_at(user_id):
    """Return a user's cache timestamp, read as the owner so the per-user policy does not hide it

    Args:
        user_id: User whose cache row is read

    Returns:
        The recorded change time, or None when no row exists
    """
    async with TestSession() as session:
        return await session.scalar(
            select(UserCacheState.changed_at).where(UserCacheState.user_id == user_id)
        )


async def test_group_admin_can_bump_a_member_of_that_group(group_with_admin_and_member):
    """An admin can invalidate the cache of someone who belongs to the group they administer"""
    group, user_a, user_b = group_with_admin_and_member
    async with _act_as(user_a.id) as session:
        await session.execute(_BUMP_MEMBER_CACHE, {"user_id": user_b.id, "group_id": group.id})

        # Committed so the row can be read back as the owner, since another user's cache
        # row is exactly what the caller's own policy would hide from them
        await session.commit()

    assert await _read_cache_changed_at(user_b.id) is not None


async def test_cache_bump_is_refused_for_a_group_the_target_does_not_belong_to(users):
    """Administering a group is not enough on its own, since anyone can create one

    A user who creates a group is made its admin, so a check resting on that alone would let
    anyone invalidate anyone's cache by naming a group of their own
    """
    user_a, user_b = users
    own_group = Group(owner_id=user_b.id, name="B Only")
    async with TestSession() as session:
        session.add(own_group)
        await session.flush()
        session.add(GroupMember(group_id=own_group.id, user_id=user_b.id, is_admin=True))
        await session.commit()

    async with _act_as(user_b.id) as session:
        with pytest.raises(ProgrammingError, match="Not authorized"):
            await session.execute(_BUMP_MEMBER_CACHE, {"user_id": user_a.id, "group_id": own_group.id})


async def test_cache_bump_is_refused_once_the_member_is_gone(group_with_admin_and_member):
    """The membership has to still be there, which is what forces the bump before the removal

    Swapping those two lines in the removal route fails here rather than passing silently
    """
    group, user_a, user_b = group_with_admin_and_member
    async with _act_as(user_a.id) as session:
        await session.execute(
            delete(GroupMember).where(GroupMember.group_id == group.id, GroupMember.user_id == user_b.id)
        )
        with pytest.raises(ProgrammingError, match="Not authorized"):
            await session.execute(_BUMP_MEMBER_CACHE, {"user_id": user_b.id, "group_id": group.id})


async def test_user_can_bump_their_own_cache_leaving_a_group(group_with_admin_and_member):
    """A member leaving a group invalidates their own cache through the same call

    Their own membership is gone by then, so the group branch is false and the self branch
    is what carries it
    """
    group, _, user_b = group_with_admin_and_member
    async with _act_as(user_b.id) as session:
        await session.execute(
            delete(GroupMember).where(GroupMember.group_id == group.id, GroupMember.user_id == user_b.id)
        )
        await session.execute(_BUMP_MEMBER_CACHE, {"user_id": user_b.id, "group_id": group.id})
        await session.commit()

    assert await _read_cache_changed_at(user_b.id) is not None


async def test_cache_bump_is_refused_without_a_request_identity():
    """A connection carrying no identity is refused rather than treated as a match"""
    async with _act_as(None) as session:
        with pytest.raises(ProgrammingError, match="Not authorized"):
            await session.execute(_BUMP_MEMBER_CACHE, {"user_id": uuid.uuid4(), "group_id": uuid.uuid4()})


async def test_cache_bump_is_refused_for_a_null_target():
    """A null target is refused rather than matching a null identity and skipping the check"""
    async with _act_as(None) as session:
        with pytest.raises(ProgrammingError, match="Not authorized"):
            await session.execute(_BUMP_MEMBER_CACHE, {"user_id": None, "group_id": uuid.uuid4()})
