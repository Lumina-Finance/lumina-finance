"""Deleting a marked profile in batches, acting as its user, and finishing one a restart cut short"""

import asyncio
import uuid
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError

from app.db.rls.functions import LIST_PROFILES_TO_DELETE
from app.models.account import TaxAdvantagedCategory
from app.models.base import Base, RecurrenceFreq, TaxTreatment
from app.models.budget import BaseBudget, Budget, BudgetTrackedCategory
from app.models.currency import Currency
from app.models.group import Group, GroupMember
from app.models.merchant import Merchant
from app.models.tag import Tag, TransactionTag
from app.models.transaction_link import TransactionLink
from app.models.user import User
from app.services.profile_deletion import delete_marked_profiles, delete_profile, removal
from tests.conftest import ScopedSession, TestSession
from tests.routes.support.bank_sync_helpers import (
    _build_account,
    _build_bank_connection,
    _build_bank_link,
    _build_bank_transaction,
    _build_category,
    _build_external_account,
    _build_ledger_transaction,
    _build_user,
)
from tests.routes.support.identity_helpers import _act_as

# Enough transactions that a batch of two takes several rounds
_TRANSACTIONS = 5


async def _seed_ledger(user: User) -> None:
    """Commit a ledger for the user with a row in each kind of table a person fills"""
    async with TestSession() as session:
        session.add(user)
        await session.flush()
        account = _build_account(user.id)
        category = _build_category(user.id)
        connection = _build_bank_connection(user.id)
        group = Group(owner_id=user.id, name="Household")
        session.add_all([account, category, connection, group])
        await session.flush()
        session.add(GroupMember(group_id=group.id, user_id=user.id, is_admin=True))
        transactions = [_build_ledger_transaction(account, category.id, -100 * (index + 1)) for index in range(_TRANSACTIONS)]
        tag = Tag(owner_id=user.id, name="Trip")
        merchant = Merchant(owner_id=user.id, name="Corner Store", default_category_id=category.id)
        base_budget = BaseBudget(owner_id=user.id, name="Food", currency="CAD", recurrence_freq=RecurrenceFreq.MONTHLY)
        tax_category = TaxAdvantagedCategory(
            category_owner_user_id=user.id, name="Savings", tax_treatment=TaxTreatment.TAX_FREE, currency="CAD"
        )
        external = _build_external_account(connection)
        session.add_all([*transactions, tag, merchant, base_budget, tax_category, external])
        await session.flush()
        link = _build_bank_link(account, connection)
        session.add_all(
            [
                *(TransactionTag(transaction_id=row.id, tag_id=tag.id) for row in transactions),
                TransactionLink(refund_transaction_id=transactions[1].id, original_transaction_id=transactions[0].id),
                Budget(base_budget_id=base_budget.id, period_start=date(2026, 3, 1), period_end=date(2026, 3, 31), overall_limit=10000),
                BudgetTrackedCategory(base_budget_id=base_budget.id, category_id=category.id, added_at=date(2026, 1, 1)),
                link,
                _build_bank_transaction(account, transaction=transactions[0]),
            ]
        )
        await session.commit()


async def _row_counts() -> dict[str, int]:
    """Every table's row count"""
    async with TestSession() as session:
        return {table.name: await session.scalar(select(func.count()).select_from(table)) for table in Base.metadata.sorted_tables}


async def _mark(user_id: uuid.UUID) -> None:
    """Mark the user for deletion, as the request does"""
    async with TestSession() as session:
        user = await session.get(User, user_id)
        user.deletion_requested_at = datetime.now(UTC)
        await session.commit()


@pytest.fixture
async def two_ledgers(fake_provider, monkeypatch):
    """Another user's ledger, every table's count with only theirs, then the marked user's ledger beside it, deleted two rows a statement"""
    monkeypatch.setattr(removal, "DELETION_BATCH_SIZE", 2)
    async with TestSession() as session:
        session.add(Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()
    await _seed_ledger(_build_user("other@example.com"))
    without_user = await _row_counts()
    user = _build_user("gone@example.com")
    await _seed_ledger(user)
    await _mark(user.id)
    return user, without_user


async def test_deleting_a_profile_leaves_every_table_as_it_was_without_the_user(two_ledgers, profile_deletions):
    """Every table holds exactly the rows it held before the user's ledger was added, and the observers hear once"""
    user, without_user = two_ledgers

    await delete_profile(ScopedSession, user.id)

    assert await _row_counts() == without_user
    assert [deletion.user_id for deletion in profile_deletions] == [user.id]


async def test_the_batches_delete_the_users_rows_before_the_user_row_goes(two_ledgers, monkeypatch):
    """With the user row's own delete left out, the batches alone have emptied every table of the user's rows"""
    user, without_user = two_ledgers

    async def keep_the_user_row(session_factory, user_id):
        return None

    monkeypatch.setattr(removal, "_delete_user_row", keep_the_user_row)

    await delete_profile(ScopedSession, user.id)

    assert await _row_counts() == {**without_user, "users": without_user["users"] + 1}


async def test_a_deletion_a_restart_cut_short_finishes_on_the_next_cleanup(two_ledgers, monkeypatch, profile_deletions):
    """A pass that stops part-way leaves the user marked and unable to sign in, and the cleanup finishes it once"""
    user, without_user = two_ledgers
    real_steps = list(removal._deletion_steps())

    def stops_after_three_steps():
        yield from real_steps[:3]
        raise RuntimeError("The server restarted")

    monkeypatch.setattr(removal, "_deletion_steps", stops_after_three_steps)
    await delete_profile(ScopedSession, user.id)

    async with TestSession() as session:
        stored = await session.get(User, user.id)
        assert stored is not None
        assert stored.deletion_requested_at is not None
    assert profile_deletions == []

    monkeypatch.setattr(removal, "_deletion_steps", lambda: real_steps)
    await delete_marked_profiles(ScopedSession)

    assert await _row_counts() == without_user
    assert [deletion.user_id for deletion in profile_deletions] == [user.id]


async def test_two_passes_at_once_delete_the_profile_and_tell_the_observers_once(two_ledgers, profile_deletions):
    """A request's pass and the cleanup's take turns on the user row, and only the one that deleted it reports"""
    user, without_user = two_ledgers

    await asyncio.gather(delete_profile(ScopedSession, user.id), delete_profile(ScopedSession, user.id))

    assert await _row_counts() == without_user
    assert [deletion.user_id for deletion in profile_deletions] == [user.id]


async def test_a_profile_not_marked_is_left_alone(profile_deletions):
    """Nothing is deleted for a user who never asked"""
    async with TestSession() as session:
        session.add(Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()
    user = _build_user("kept@example.com")
    await _seed_ledger(user)
    before = await _row_counts()

    await delete_profile(ScopedSession, user.id)
    await delete_marked_profiles(ScopedSession)

    assert await _row_counts() == before
    assert profile_deletions == []


async def test_listing_the_profiles_to_delete_is_refused_under_a_user_identity():
    """Only the cleanup, with no request identity, may see which users are being deleted"""
    async with TestSession() as session:
        session.add(Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2))
        user = _build_user("asker@example.com")
        session.add(user)
        await session.commit()

    async with _act_as(user.id) as session:
        with pytest.raises(DBAPIError, match="Only the cleanup may list the profiles to delete"):
            await session.execute(text(f"SELECT {LIST_PROFILES_TO_DELETE}()"))


async def test_every_table_naming_a_user_is_deleted_from_before_the_tables_it_names():
    """A table comes before every table it has a foreign key to, so no batch deletes a row another of the user's rows still names"""
    order = [table.name for table, _ in removal._deletion_steps()]
    for position, name in enumerate(order):
        table = Base.metadata.tables[name]
        for foreign_key in table.foreign_keys:
            target = foreign_key.column.table.name
            if target != name and target in order:
                assert order.index(target) > position, f"{name} must come before {target}"


def test_every_foreign_key_to_users_deletes_with_its_user():
    """A row the batches miss can never keep a user row in place, so a deletion can't stop half done"""
    keys = [key for table in Base.metadata.sorted_tables for key in table.foreign_keys if key.column.table.name == "users"]

    assert keys
    assert [key.parent for key in keys if key.ondelete != "CASCADE"] == []
