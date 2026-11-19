"""Read rules that test the current user's sets grant what the per-row helpers grant

Runs as the runtime app role, as the isolation tests do, for the grants those tests leave
unexercised: a group budget's periods, a bank row once its owner loses the account, and a group's
rows for an owner who isn't among its members
"""

from datetime import date

import pytest
from sqlalchemy import delete, select

from app.models.account import Account, AccountPermission
from app.models.base import AccountKind, AccountType, PermissionLevel, RecurrenceFreq
from app.models.budget import BaseBudget, Budget, BudgetPermission
from app.models.group import Group, GroupMember
from app.models.tag import Tag
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import _build_bank_transaction, _build_pending_transaction, _build_unlinked_link
from tests.routes.support.identity_helpers import _act_as, _count_visible, _seed_users


@pytest.fixture
async def users():
    """Seed a group owner and another user, and the currency their rows are in"""
    owner, member = await _seed_users("owner@example.com", "member@example.com")
    return owner, member


@pytest.fixture
async def group(users):
    """Seed a group the owner administers and the other user belongs to without administering"""
    owner, member = users
    async with TestSession() as session:
        group = Group(owner_id=owner.id, name="Family")
        session.add(group)
        await session.flush()
        session.add_all([GroupMember(group_id=group.id, user_id=owner.id, is_admin=True), GroupMember(group_id=group.id, user_id=member.id)])
        await session.commit()
    return group


async def _visible_count(user_id, model) -> int:
    """Return how many rows of a model a user can read"""
    async with _act_as(user_id) as session:
        return await _count_visible(session, model)


async def test_group_budget_periods_follow_base_budget_access(users, group):
    """A group budget's period reads for its group's admin and a permitted member, not a plain one"""
    owner, member = users
    async with TestSession() as session:
        base_budget = BaseBudget(group_id=group.id, name="Food", currency="CAD", recurrence_freq=RecurrenceFreq.MONTHLY)
        session.add(base_budget)
        await session.flush()
        session.add(Budget(base_budget_id=base_budget.id, period_start=date(2026, 3, 1), period_end=date(2026, 3, 31), overall_limit=100000))
        await session.commit()

    assert await _visible_count(owner.id, Budget) == 1
    assert await _visible_count(member.id, Budget) == 0

    async with TestSession() as session:
        session.add(BudgetPermission(group_id=group.id, user_id=member.id, base_budget_id=base_budget.id, level=PermissionLevel.READ))
        await session.commit()

    assert await _visible_count(member.id, Budget) == 1


@pytest.mark.parametrize("build", [_build_unlinked_link, _build_bank_transaction, _build_pending_transaction])
async def test_bank_rows_leave_with_the_account_they_are_on(users, group, build):
    """A member's own bank rows on a joint account go out of sight once their grant on it is withdrawn"""
    _owner, member = users
    async with TestSession() as session:
        account = Account(group_id=group.id, account_kind=AccountKind.ASSET, account_type=AccountType.CHECKING, name="Joint", currency="CAD")
        session.add(account)
        await session.flush()
        session.add(AccountPermission(group_id=group.id, user_id=member.id, account_id=account.id, level=PermissionLevel.WRITE))
        row = build(account)
        row.owner_id = member.id
        session.add(row)
        await session.commit()

    assert await _visible_count(member.id, type(row)) == 1

    async with TestSession() as session:
        await session.execute(delete(AccountPermission).where(AccountPermission.user_id == member.id))
        await session.commit()

    assert await _visible_count(member.id, type(row)) == 0


async def test_group_owner_outside_its_members_reads_its_rows(users):
    """A group's owner reads a member's tag in it without holding a membership of their own"""
    owner, member = users
    async with TestSession() as session:
        group = Group(owner_id=owner.id, name="Family")
        session.add(group)
        await session.flush()
        session.add(GroupMember(group_id=group.id, user_id=member.id))
        tag = Tag(owner_id=member.id, group_id=group.id, name="Trip")
        session.add(tag)
        await session.commit()

    async with _act_as(owner.id) as session:
        assert (await session.scalars(select(Tag.id))).all() == [tag.id]
