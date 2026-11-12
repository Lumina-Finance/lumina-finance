"""Row-level security isolation tests exercised as the runtime app role

Every other test connects as the table owner, which bypasses row-level security,
so the policies are present but never enforced. These tests connect as the
runtime app role, which is subject to the policies, to prove they actually keep
one user's data out of another user's reach at the database level
"""

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import delete, func, insert, select, text
from sqlalchemy.exc import ProgrammingError

from app.models.account import Account, AccountPermission
from app.models.account_import_layout import AccountImportLayout
from app.models.account_import_source import AccountImportSource
from app.models.bank_connection import (
    BankAccountLink,
    BankConnection,
    BankExternalAccount,
    BankLinkState,
    BankProviderRequest,
    ProviderRequestPurpose,
)
from app.models.bank_hold import BankHold
from app.models.bank_pending_transaction import BankPendingTransaction
from app.models.bank_sync_job import BankSyncHeartbeat, BankSyncJob, BankSyncJobKind
from app.models.bank_transaction import BankTransaction
from app.models.base import AccountKind, AccountType, CategoryKind, PermissionLevel, RecurrenceFreq
from app.models.budget import BaseBudget, Budget, BudgetTrackedCategory
from app.models.cache_state import UserCacheState
from app.models.category import Category
from app.models.currency import Currency
from app.models.group import Group, GroupMember
from app.models.transaction import Transaction
from app.models.user import User, UserCreditExcludedAccount
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    _build_bank_connection,
    _build_bank_link,
    _build_bank_transaction,
    _build_external_account,
    _build_ledger_transaction,
    _build_pending_transaction,
)
from tests.routes.support.identity_helpers import _act_as


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
        session.add(
            BudgetTrackedCategory(
                base_budget_id=base_budget.id,
                category_id=system_category_id,
                added_at=date(2026, 1, 1),
            )
        )
        session.add(
            Transaction(
                created_by_user_id=user_a.id,
                account_id=account.id,
                dt=date(2026, 3, 15),
                category_id=system_category_id,
                amount=-5000,
                currency="CAD",
            )
        )
        await session.commit()

    spend_query = text("SELECT id FROM public.budget_spend_rows(:budget_ids, :now)")
    params = {"budget_ids": [budget.id], "now": datetime.now(UTC)}

    async with _act_as(user_a.id) as session:
        owner_rows = (await session.execute(spend_query, params)).all()
        assert len(owner_rows) > 0

    async with _act_as(user_b.id) as session:
        other_rows = (await session.execute(spend_query, params)).all()
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
        session.add_all(
            [
                GroupMember(group_id=group.id, user_id=user_a.id, is_admin=True),
                GroupMember(group_id=group.id, user_id=user_b.id),
            ]
        )
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
        return await session.scalar(select(UserCacheState.changed_at).where(UserCacheState.user_id == user_id))


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
        await session.execute(delete(GroupMember).where(GroupMember.group_id == group.id, GroupMember.user_id == user_b.id))
        with pytest.raises(ProgrammingError, match="Not authorized"):
            await session.execute(_BUMP_MEMBER_CACHE, {"user_id": user_b.id, "group_id": group.id})


async def test_user_can_bump_their_own_cache_leaving_a_group(group_with_admin_and_member):
    """A member leaving a group invalidates their own cache through the same call

    Their own membership is gone by then, so the group branch is false and the self branch
    is what carries it
    """
    group, _, user_b = group_with_admin_and_member
    async with _act_as(user_b.id) as session:
        await session.execute(delete(GroupMember).where(GroupMember.group_id == group.id, GroupMember.user_id == user_b.id))
        await session.execute(_BUMP_MEMBER_CACHE, {"user_id": user_b.id, "group_id": group.id})
        await session.commit()

    assert await _read_cache_changed_at(user_b.id) is not None


def _build_import_layout(account_id) -> AccountImportLayout:
    """Return an unsaved CSV import layout saved for the given account"""
    return AccountImportLayout(
        account_id=account_id,
        header_key="0" * 64,
        headers=["Date", "Amount"],
        delimiter=",",
        header_row=1,
        column_map={"dt": "Date", "amount": "Amount"},
        date_format="yearFirst",
        amount_format={"decimal_separator": ".", "grouping_separator": ","},
    )


async def test_import_layouts_follow_account_access(users):
    """Another user read or wrote the CSV settings saved for an account they can't reach"""
    user_a, user_b = users
    account = _build_account(user_a.id, "A Chequing")
    async with TestSession() as session:
        session.add(account)
        await session.flush()
        layout = _build_import_layout(account.id)
        session.add(layout)
        await session.commit()

    async with _act_as(user_a.id) as session:
        assert (await session.scalars(select(AccountImportLayout.id))).all() == [layout.id]

    async with _act_as(user_b.id) as session:
        assert (await session.scalars(select(AccountImportLayout.id))).all() == []
        forged = _build_import_layout(account.id)
        forged.header_key = "1" * 64
        session.add(forged)
        with pytest.raises(ProgrammingError, match="row-level security"):
            await session.flush()


async def test_import_sources_follow_account_access(users):
    """Another user read or wrote the importer remembered for an account they can't reach"""
    user_a, user_b = users
    account = _build_account(user_a.id, "A Chequing")
    async with TestSession() as session:
        session.add(account)
        await session.flush()
        remembered = AccountImportSource(account_id=account.id, source="ofx")
        session.add(remembered)
        await session.commit()

    async with _act_as(user_a.id) as session:
        assert (await session.scalars(select(AccountImportSource.id))).all() == [remembered.id]

    async with _act_as(user_b.id) as session:
        assert (await session.scalars(select(AccountImportSource.id))).all() == []
        session.add(AccountImportSource(account_id=account.id, source="generic"))
        with pytest.raises(ProgrammingError, match="row-level security"):
            await session.flush()


async def test_credit_exclusions_follow_their_user_and_account_access(users):
    """Another user read a credit exclusion, or left out an account they can't reach"""
    user_a, user_b = users
    account = _build_account(user_a.id, "A Card")
    async with TestSession() as session:
        session.add(account)
        await session.flush()
        session.add(UserCreditExcludedAccount(user_id=user_a.id, account_id=account.id))
        await session.commit()

    async with _act_as(user_a.id) as session:
        assert (await session.scalars(select(UserCreditExcludedAccount.account_id))).all() == [account.id]

    async with _act_as(user_b.id) as session:
        assert (await session.scalars(select(UserCreditExcludedAccount.account_id))).all() == []
        session.add(UserCreditExcludedAccount(user_id=user_b.id, account_id=account.id))
        with pytest.raises(ProgrammingError, match="row-level security"):
            await session.flush()


async def test_credit_exclusions_on_a_shared_account_stay_each_users_own(users):
    """A user left out an account both reach in another user's name, or lost their own row for it"""
    user_a, user_b = users
    group = Group(owner_id=user_a.id, name="Shared")
    async with TestSession() as session:
        session.add(group)
        await session.flush()
        session.add_all(
            [
                GroupMember(group_id=group.id, user_id=user_a.id, is_admin=True),
                GroupMember(group_id=group.id, user_id=user_b.id, is_admin=True),
            ]
        )
        account = Account(
            group_id=group.id,
            account_kind=AccountKind.ASSET,
            account_type=AccountType.CHECKING,
            name="Shared card",
            currency="CAD",
        )
        session.add(account)
        await session.flush()
        session.add(UserCreditExcludedAccount(user_id=user_a.id, account_id=account.id))
        await session.commit()

    async with _act_as(user_b.id) as session:
        assert (await session.scalars(select(UserCreditExcludedAccount.user_id))).all() == []
        session.add(UserCreditExcludedAccount(user_id=user_a.id, account_id=account.id))
        with pytest.raises(ProgrammingError, match="row-level security"):
            await session.flush()

    async with _act_as(user_b.id) as session:
        session.add(UserCreditExcludedAccount(user_id=user_b.id, account_id=account.id))
        await session.flush()
        assert (await session.scalars(select(UserCreditExcludedAccount.user_id))).all() == [user_b.id]


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


_BANK_MODELS = [
    BankConnection,
    BankProviderRequest,
    BankExternalAccount,
    BankAccountLink,
    BankTransaction,
    BankPendingTransaction,
    BankHold,
    BankSyncJob,
]


async def _count_visible(session, model) -> int:
    """Return how many rows of a model the session's user can see"""
    return await session.scalar(select(func.count()).select_from(model))


async def _create_bank_records(session, owner_id) -> tuple[Account, BankConnection]:
    """Create one of each bank sync record for a user in a session, returning the account and connection"""
    account = _build_account(owner_id, "Everyday")
    connection = _build_bank_connection(owner_id)
    session.add_all([account, connection])
    await session.flush()
    session.add_all(
        [
            BankProviderRequest(owner_id=owner_id, connection_id=connection.id, purpose=ProviderRequestPurpose.SYNC),
            _build_external_account(connection),
            _build_bank_link(account, connection),
            _build_bank_transaction(account),
            _build_pending_transaction(account, "P-1"),
            BankHold(
                owner_id=owner_id,
                account_id=account.id,
                provider="fake",
                external_account_id="ACT-1",
                external_transaction_hash="h" * 64,
                hold_date=date(2026, 10, 4),
                description="CARD CHECK",
                observed_at=datetime(2026, 10, 4, 9, 0, tzinfo=UTC),
            ),
            BankSyncJob(owner_id=owner_id, connection_id=connection.id, kind=BankSyncJobKind.SCHEDULED),
        ]
    )
    await session.flush()
    return account, connection


def _owned_by(row, owner_id):
    """Return a row with its owner replaced"""
    row.owner_id = owner_id
    return row


@pytest.fixture
async def bank_records(users):
    """Seed one of each bank sync record for user A, returning A's connection"""
    user_a, _ = users
    async with TestSession() as session:
        _, connection = await _create_bank_records(session, user_a.id)
        await session.commit()
    return connection


async def test_bank_records_owner_can_create_and_read_back(users):
    """The owner writes every bank sync record through the app role and reads each back"""
    user_a, _ = users
    async with _act_as(user_a.id) as session:
        await _create_bank_records(session, user_a.id)

        for model in _BANK_MODELS:
            assert await _count_visible(session, model) == 1


@pytest.mark.parametrize("model", _BANK_MODELS, ids=lambda model: model.__tablename__)
async def test_bank_records_are_invisible_to_other_users(users, bank_records, model):
    """Another user sees none of a user's bank sync records"""
    user_a, user_b = users
    async with _act_as(user_b.id) as session:
        assert await _count_visible(session, model) == 0

    async with _act_as(user_a.id) as session:
        assert await _count_visible(session, model) == 1


@pytest.mark.parametrize(
    "build",
    [
        lambda connection, owner_id, _: BankProviderRequest(
            owner_id=owner_id,
            connection_id=connection.id,
            purpose=ProviderRequestPurpose.SYNC,
        ),
        lambda connection, owner_id, _: _owned_by(_build_external_account(connection, "ACT-B"), owner_id),
        lambda connection, _, account: _build_bank_link(account, connection, "ACT-B"),
        lambda connection, owner_id, _: BankSyncJob(
            owner_id=owner_id,
            connection_id=connection.id,
            kind=BankSyncJobKind.MANUAL,
        ),
    ],
    ids=["provider_request", "external_account", "account_link", "sync_job"],
)
async def test_bank_record_naming_another_users_connection_is_refused(users, bank_records, build):
    """A user can't attach their own records to a connection that isn't theirs

    Foreign keys skip row-level security, so the write check is what stops a guessed connection ID
    """
    _, user_b = users
    async with TestSession() as session:
        account_b = _build_account(user_b.id, "B Everyday")
        session.add(account_b)
        await session.commit()

    async with _act_as(user_b.id) as session:
        session.add(build(bank_records, user_b.id, account_b))
        with pytest.raises(ProgrammingError, match="row-level security"):
            await session.flush()


@pytest.mark.parametrize(
    "build",
    [
        lambda account, connection, owner_id: _owned_by(_build_bank_link(account, connection, "ACT-B"), owner_id),
        lambda account, _, owner_id: _owned_by(_build_bank_transaction(account, "TRN-B"), owner_id),
        lambda account, _, owner_id: _owned_by(_build_pending_transaction(account, "P-B"), owner_id),
        lambda account, _, owner_id: BankHold(
            owner_id=owner_id,
            account_id=account.id,
            provider="fake",
            external_account_id="ACT-B",
            external_transaction_hash="b" * 64,
            hold_date=date(2026, 10, 4),
            description="CARD CHECK",
            observed_at=datetime(2026, 10, 4, 9, 0, tzinfo=UTC),
        ),
    ],
    ids=["account_link", "bank_transaction", "pending_transaction", "bank_hold"],
)
async def test_bank_record_on_another_users_account_is_refused(users, bank_records, build):
    """A user can't put bank records on someone else's account, even as the row's owner"""
    user_a, user_b = users
    async with TestSession() as session:
        account_a = (await session.scalars(select(Account).where(Account.owner_id == user_a.id))).one()
        connection_b = _build_bank_connection(user_b.id)
        session.add(connection_b)
        await session.commit()

    async with _act_as(user_b.id) as session:
        session.add(build(account_a, connection_b, user_b.id))
        with pytest.raises(ProgrammingError, match="row-level security"):
            await session.flush()


async def test_bank_transaction_naming_another_users_ledger_row_is_refused(users):
    """A user can't claim someone else's ledger transaction as bank-sourced on their own account"""
    user_a, user_b = users
    async with TestSession() as session:
        system_category_id = await session.scalar(select(Category.id).where(Category.is_system).limit(1))
        account_a = _build_account(user_a.id, "A Everyday")
        account_b = _build_account(user_b.id, "B Everyday")
        session.add_all([account_a, account_b])
        await session.flush()
        ledger_row_a = _build_ledger_transaction(account_a, system_category_id)
        session.add(ledger_row_a)
        await session.commit()

    async with _act_as(user_b.id) as session:
        session.add(_build_bank_transaction(account_b, transaction=ledger_row_a))
        with pytest.raises(ProgrammingError, match="row-level security"):
            await session.flush()


@pytest.fixture
async def group_account(users):
    """Seed a group account A administers and B holds a write grant on, returning the account

    Both users pass the account check on it, so only the owner condition keeps A's bank rows from B
    """
    user_a, user_b = users
    async with TestSession() as session:
        group = Group(owner_id=user_a.id, name="A Family")
        session.add(group)
        await session.flush()
        session.add_all([GroupMember(group_id=group.id, user_id=user_a.id, is_admin=True), GroupMember(group_id=group.id, user_id=user_b.id)])
        account = Account(group_id=group.id, account_kind=AccountKind.ASSET, account_type=AccountType.CHECKING, name="Joint", currency="CAD")
        session.add(account)
        await session.flush()
        session.add(AccountPermission(group_id=group.id, user_id=user_b.id, account_id=account.id, level=PermissionLevel.WRITE))
        await session.commit()
    return account


def _unlinked(link: BankAccountLink) -> BankAccountLink:
    """Return a link unlinked from a connection since deleted, so it names no connection"""
    link.state = BankLinkState.UNLINKED
    link.unlinked_at = datetime(2026, 10, 2, tzinfo=UTC)
    return link


# Bank rows on an account, owned by the given user, none of which names a connection, so the
# account check and the owner condition are all their policies weigh
_GROUP_ACCOUNT_ROWS = [
    pytest.param(lambda account, owner_id: _owned_by(_unlinked(_build_bank_link(account, None)), owner_id), id="account_link"),
    pytest.param(lambda account, owner_id: _owned_by(_build_bank_transaction(account), owner_id), id="bank_transaction"),
    pytest.param(lambda account, owner_id: _owned_by(_build_pending_transaction(account, "P-1"), owner_id), id="pending_transaction"),
]


@pytest.mark.parametrize("build", _GROUP_ACCOUNT_ROWS)
async def test_bank_rows_on_a_shared_group_account_stay_with_their_owner(users, group_account, build):
    """B can use the joint account but sees none of the bank rows A owns on it"""
    user_a, user_b = users
    row = build(group_account, user_a.id)
    async with TestSession() as session:
        session.add(row)
        await session.commit()

    async with _act_as(user_b.id) as session:
        assert group_account.id in (await session.scalars(select(Account.id))).all()
        assert await _count_visible(session, type(row)) == 0

    async with _act_as(user_a.id) as session:
        assert await _count_visible(session, type(row)) == 1


async def _insert_without_returning(session, row) -> None:
    """Insert a row's set columns without RETURNING

    A RETURNING clause makes the new row pass the read policy too, so leaving it out leaves the
    write check as the only thing that can refuse the row
    """
    values = {column.key: getattr(row, column.key) for column in row.__table__.columns if getattr(row, column.key) is not None}
    await session.execute(insert(type(row)).values(**values))


async def _refused_as(user_id, row) -> None:
    """Assert the write check refuses a user's insert of a row"""
    async with _act_as(user_id) as session:
        with pytest.raises(ProgrammingError, match="row-level security"):
            await _insert_without_returning(session, row)


@pytest.mark.parametrize("build", _GROUP_ACCOUNT_ROWS)
async def test_bank_row_owned_by_another_user_on_a_shared_group_account_is_refused(users, group_account, build):
    """B can't write a bank row in A's name on the joint account they both use"""
    user_a, user_b = users
    await _refused_as(user_b.id, build(group_account, user_a.id))


async def test_bank_connection_owned_by_another_user_is_refused(users):
    """A user can't add a connection in someone else's name"""
    user_a, user_b = users
    await _refused_as(user_b.id, _build_bank_connection(user_a.id))


# Rows tied to a connection, built on B's connection and, for a link, on B's account, so the
# connection and account checks pass for B and only the owner condition is left to weigh
_CONNECTION_ROWS = [
    pytest.param(
        lambda connection, _: BankProviderRequest(connection_id=connection.id, purpose=ProviderRequestPurpose.SYNC),
        id="provider_request",
    ),
    pytest.param(lambda connection, _: _build_external_account(connection), id="external_account"),
    pytest.param(lambda connection, _: BankSyncJob(connection_id=connection.id, kind=BankSyncJobKind.MANUAL), id="sync_job"),
    pytest.param(lambda connection, account: _build_bank_link(account, connection), id="account_link"),
]


@pytest.mark.parametrize("build", _CONNECTION_ROWS)
async def test_bank_row_on_the_users_own_connection_owned_by_another_user_is_refused(users, build):
    """B can write the row on their own connection in their own name, but not in A's"""
    user_a, user_b = users
    async with TestSession() as session:
        account_b = _build_account(user_b.id, "B Everyday")
        connection_b = _build_bank_connection(user_b.id)
        session.add_all([account_b, connection_b])
        await session.commit()

    # The same row in B's own name goes in, so only its owner can be what refuses it below
    async with _act_as(user_b.id) as session:
        await _insert_without_returning(session, _owned_by(build(connection_b, account_b), user_b.id))

    await _refused_as(user_b.id, _owned_by(build(connection_b, account_b), user_a.id))


@pytest.mark.parametrize(
    "call",
    [
        "SELECT * FROM public.claim_bank_sync_jobs(10)",
        "SELECT * FROM public.list_due_bank_connections(now())",
        "SELECT public.record_bank_sync_scan(now())",
    ],
    ids=["claim", "list_due", "record_scan"],
)
async def test_bank_sync_worker_functions_refuse_a_request_identity(users, bank_records, call):
    """A request runs as one user, so it can't reach the functions that see every user's jobs"""
    user_a, _ = users
    async with _act_as(user_a.id) as session:
        with pytest.raises(ProgrammingError, match="Only the bank sync worker may call this"):
            await session.execute(text(call))


async def test_bank_sync_heartbeat_is_read_by_the_app_and_written_only_by_the_worker(users):
    """Any request can tell whether sync is running, while only the worker's scan stamps it"""
    user_a, _ = users
    async with _act_as(None) as worker:
        await worker.execute(text("SELECT public.record_bank_sync_scan(now())"))
        await worker.commit()

    async with _act_as(user_a.id) as session:
        assert await _count_visible(session, BankSyncHeartbeat) == 1
        with pytest.raises(ProgrammingError, match="permission denied"):
            await session.execute(text("UPDATE bank_sync_heartbeat SET last_scan_at = now()"))
