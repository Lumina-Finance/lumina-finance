"""Row-level security isolation tests exercised as the runtime app role

Every other test connects as the table owner, which bypasses row-level security,
so the policies are present but never enforced. These tests connect as the
runtime app role, which is subject to the policies, to prove they actually keep
one user's data out of another user's reach at the database level
"""

from contextlib import asynccontextmanager
from datetime import UTC, datetime
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.exc import ProgrammingError

from app.database import current_user_id_ctx
from app.models.account import Account
from app.models.base import AccountKind, AccountType, CategoryKind
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
    committed, so writes attempted inside the block never persist
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
