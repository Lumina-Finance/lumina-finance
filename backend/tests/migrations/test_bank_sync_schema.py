"""Bank sync storage rules, checked on a database the migrations built

The rest of the suite builds its schema from the models, where a uniqueness rule or a cascade the
migration left out would still pass. These tests share one migrated database per worker, and each
runs inside a transaction rolled back at its end, so none sees another's rows
"""

import pytest
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.account_review_preference import AccountReviewPreference
from app.models.bank_connection import (
    BankAccountLink,
    BankConnection,
    BankExternalAccount,
    BankLinkState,
    BankProviderRequest,
    BankSigninNotice,
    ProviderRequestPurpose,
)
from app.models.bank_transaction import BankTransaction, BankTransactionDisposition
from app.models.transaction import Transaction
from app.models.user import User
from tests.conftest import WORKER_DB_NAME
from tests.migrations.support import _create_engine_for_database, _drop_database, _recreate_database, _run_alembic_upgrade
from tests.routes.support.bank_sync_helpers import (
    _build_account,
    _build_bank_connection,
    _build_bank_link,
    _build_bank_transaction,
    _build_category,
    _build_external_account,
    _build_ledger_transaction,
    _build_signin_notice,
    _build_user,
)

_DATABASE_NAME = f"{WORKER_DB_NAME}_alembic_bank_sync"


@pytest.fixture(scope="module")
async def migrated_database():
    """Build one database through the migrations for every test in this module"""
    await _recreate_database(_DATABASE_NAME)
    try:
        _run_alembic_upgrade(_DATABASE_NAME)
        yield _DATABASE_NAME
    finally:
        await _drop_database(_DATABASE_NAME)


@pytest.fixture
async def session(migrated_database):
    """Yield a session on the migrated database whose work is rolled back afterwards

    A refused write is tried inside a savepoint, so the test carries on in the same transaction
    """
    engine = _create_engine_for_database(migrated_database)
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            session = AsyncSession(bind=connection, expire_on_commit=False, join_transaction_mode="create_savepoint")
            try:
                await session.execute(
                    text(
                        "INSERT INTO currencies (id, name, symbol, minor_unit_exponent) "
                        "VALUES ('CAD', 'Canadian Dollar', '$', 2) ON CONFLICT (id) DO NOTHING"
                    )
                )
                yield session
            finally:
                await session.close()
                await transaction.rollback()
    finally:
        await engine.dispose()


async def _add(session: AsyncSession, *rows) -> None:
    """Add rows and flush them, so the next level can point at them"""
    session.add_all(rows)
    await session.flush()


async def _refused(session: AsyncSession, row, constraint: str) -> None:
    """Assert that adding a row is refused by the named constraint, leaving the transaction usable"""
    with pytest.raises(IntegrityError, match=constraint):
        async with session.begin_nested():
            session.add(row)
            await session.flush()


async def _owner(session: AsyncSession, email: str = "owner@example.com") -> User:
    """Add and return a user"""
    user = _build_user(email)
    await _add(session, user)
    return user


async def test_bank_link_second_live_link_on_an_account_is_refused_until_the_first_is_unlinked(session):
    """Everyday already has an active link, so a second one waits until the first is unlinked"""
    user = await _owner(session)
    everyday = _build_account(user.id)
    connection = _build_bank_connection(user.id)
    await _add(session, everyday, connection)
    first = _build_bank_link(everyday, connection, "ACT-1")
    await _add(session, first)

    await _refused(session, _build_bank_link(everyday, connection, "ACT-2"), "uq_bank_account_links_account_id")

    await session.execute(
        update(BankAccountLink).where(BankAccountLink.id == first.id).values(state=BankLinkState.UNLINKED, unlinked_at=func.now())
    )
    await _add(session, _build_bank_link(everyday, connection, "ACT-2"))


async def test_bank_link_same_bank_account_through_a_second_connection_is_refused(session):
    """Two setup tokens for one Bridge account can't import one bank account into two ledgers"""
    user = await _owner(session)
    everyday = _build_account(user.id, "Everyday")
    savings = _build_account(user.id, "Savings")
    connection_a = _build_bank_connection(user.id)
    connection_b = _build_bank_connection(user.id)
    await _add(session, everyday, savings, connection_a, connection_b)
    await _add(session, _build_bank_link(everyday, connection_a, "ACT-1"))

    await _refused(session, _build_bank_link(savings, connection_b, "ACT-1"), "uq_bank_account_links_bank_account")


async def test_bank_link_same_bank_account_id_for_another_user_is_allowed(session):
    """The one-link rule is per user, so another user's bank account with the same ID links freely"""
    user = await _owner(session)
    other = await _owner(session, "other@example.com")
    everyday = _build_account(user.id)
    other_everyday = _build_account(other.id)
    connection = _build_bank_connection(user.id)
    other_connection = _build_bank_connection(other.id)
    await _add(session, everyday, other_everyday, connection, other_connection)
    await _add(session, _build_bank_link(everyday, connection, "ACT-1"))

    await _add(session, _build_bank_link(other_everyday, other_connection, "ACT-1"))


async def test_bank_connection_deleted_after_unlinking_keeps_the_links_previous_details(session):
    """Disconnecting removes the bank accounts and records, while the link still names what it followed"""
    user = await _owner(session)
    everyday = _build_account(user.id)
    connection = _build_bank_connection(user.id)
    await _add(session, everyday, connection)
    link = _build_bank_link(everyday, connection)
    link.state = BankLinkState.UNLINKED
    link.unlinked_at = func.now()
    request = BankProviderRequest(
        owner_id=user.id,
        connection_id=connection.id,
        purpose=ProviderRequestPurpose.SYNC,
    )
    await _add(session, link, _build_external_account(connection), _build_signin_notice(connection), request)

    await session.execute(delete(BankConnection).where(BankConnection.id == connection.id))

    kept = (
        await session.execute(
            select(
                BankAccountLink.connection_id,
                BankAccountLink.provider,
                BankAccountLink.external_account_id,
                BankAccountLink.external_account_name,
                BankAccountLink.institution_name,
            ).where(BankAccountLink.id == link.id)
        )
    ).one()
    assert tuple(kept) == (None, "simplefin", "ACT-1", "Everyday Chequing", "Harbour Bank")
    for model in (BankExternalAccount, BankSigninNotice, BankProviderRequest):
        assert (await session.scalars(select(model.id))).all() == []


async def test_bank_connection_still_feeding_a_link_cannot_be_deleted(session):
    """Deleting a connection an active link syncs from is refused rather than stranding the link"""
    user = await _owner(session)
    everyday = _build_account(user.id)
    connection = _build_bank_connection(user.id)
    await _add(session, everyday, connection)
    await _add(session, _build_bank_link(everyday, connection))

    with pytest.raises(IntegrityError, match="ck_bank_account_links_connection"):
        async with session.begin_nested():
            await session.execute(delete(BankConnection).where(BankConnection.id == connection.id))


async def test_account_deleted_removes_its_link_and_keeps_the_connection(session):
    """Deleting Travel takes its link, and Travel Wallet stays listed and free to link elsewhere"""
    user = await _owner(session)
    travel = _build_account(user.id, "Travel")
    holidays = _build_account(user.id, "Holidays")
    connection = _build_bank_connection(user.id)
    await _add(session, travel, holidays, connection)
    wallet = _build_external_account(connection, "ACT-TRAVEL")
    other_bank_account = _build_external_account(connection, "ACT-OTHER")
    link = _build_bank_link(travel, connection, "ACT-TRAVEL")
    await _add(session, wallet, other_bank_account, link)

    await session.execute(delete(Account).where(Account.id == travel.id))

    assert await session.scalar(select(BankAccountLink.id).where(BankAccountLink.id == link.id)) is None
    assert await session.scalar(select(BankConnection.id)) == connection.id
    assert set(await session.scalars(select(BankExternalAccount.external_id))) == {"ACT-TRAVEL", "ACT-OTHER"}
    await _add(session, _build_bank_link(holidays, connection, "ACT-TRAVEL"))


async def test_bank_external_account_is_listed_once_per_connection(session):
    """A connection lists a bank account once, while another connection may list the same ID"""
    user = await _owner(session)
    connection_a = _build_bank_connection(user.id)
    connection_b = _build_bank_connection(user.id)
    await _add(session, connection_a, connection_b)
    await _add(session, _build_external_account(connection_a))

    await _refused(session, _build_external_account(connection_a), "uq_bank_external_accounts_connection_external_id")
    await _add(session, _build_external_account(connection_b))


async def test_bank_signin_notice_is_recorded_once_per_bank_login(session):
    """A bank login waiting for a sign-in has one notice, so its email goes out once"""
    user = await _owner(session)
    connection = _build_bank_connection(user.id)
    await _add(session, connection)
    await _add(session, _build_signin_notice(connection, "login-1"))

    await _refused(session, _build_signin_notice(connection, "login-1"), "uq_bank_signin_notices_connection_login")
    await _add(session, _build_signin_notice(connection, "login-2"))


async def test_account_review_preferences_start_on_review_and_go_with_the_account(session):
    """A row stored without choices reads Review all, and deleting the account deletes it"""
    user = await _owner(session)
    everyday = _build_account(user.id)
    await _add(session, everyday)
    await session.execute(
        text("INSERT INTO account_review_preferences (account_id, owner_id) VALUES (:account_id, :owner_id)"),
        {"account_id": everyday.id, "owner_id": user.id},
    )

    stored = (
        await session.execute(
            select(
                AccountReviewPreference.new_transactions,
                AccountReviewPreference.corrections,
                AccountReviewPreference.removals,
            )
        )
    ).one()
    await session.execute(delete(Account).where(Account.id == everyday.id))

    assert tuple(stored) == ("review", "review", "review")
    assert await session.scalar(select(func.count()).select_from(AccountReviewPreference)) == 0


def _dismissed(record: BankTransaction) -> BankTransaction:
    """Return a record dismissed the way the review stores it, keeping only its identity"""
    record.disposition = BankTransactionDisposition.DISMISSED
    for column in ("observed_date", "observed_amount", "description", "observed_at"):
        setattr(record, column, None)
    return record


async def _everyday_with_ledger_row(session: AsyncSession) -> tuple[Account, Transaction]:
    """Add a user's Everyday account with one ledger transaction, returning both"""
    user = await _owner(session)
    everyday = _build_account(user.id)
    category = _build_category(user.id)
    await _add(session, everyday, category)
    ledger_row = _build_ledger_transaction(everyday, category.id, -1000)
    await _add(session, ledger_row)
    return everyday, ledger_row


async def test_bank_transaction_identity_is_namespaced_by_account_and_bank_account(session):
    """TRN-1001 for Everyday Chequing and TRN-1001 for Rewards Visa are two records"""
    user = await _owner(session)
    everyday = _build_account(user.id, "Everyday")
    rewards = _build_account(user.id, "Rewards Visa")
    await _add(session, everyday, rewards)
    await _add(
        session,
        _build_bank_transaction(everyday, "TRN-1001", external_account_id="ACT-CHQ"),
        _build_bank_transaction(rewards, "TRN-1001", external_account_id="ACT-VISA"),
        # A Lumina account that follows another bank account later keeps both namespaces apart
        _build_bank_transaction(everyday, "TRN-1001", external_account_id="ACT-SAV"),
    )

    await _refused(
        session,
        _build_bank_transaction(everyday, "TRN-1001", external_account_id="ACT-CHQ"),
        "uq_bank_transactions_identity",
    )


async def test_bank_transaction_one_record_per_ledger_row(session):
    """A ledger transaction comes from at most one bank transaction"""
    everyday, ledger_row = await _everyday_with_ledger_row(session)
    await _add(session, _build_bank_transaction(everyday, "TRN-1", transaction=ledger_row))

    await _refused(
        session,
        _build_bank_transaction(everyday, "TRN-2", transaction=ledger_row),
        "uq_bank_transactions_transaction_id",
    )


async def test_bank_transaction_dismissed_keeps_only_its_identity(session):
    """A dismissed record holding any of the bank's values is refused, and one without is stored"""
    user = await _owner(session)
    everyday = _build_account(user.id)
    await _add(session, everyday)
    holding_description = _dismissed(_build_bank_transaction(everyday, "TRN-1"))
    holding_description.description = "HARBOUR COFFEE"

    await _refused(session, holding_description, "ck_bank_transactions_dismissed")
    await _add(session, _dismissed(_build_bank_transaction(everyday, "TRN-2")))


async def test_bank_transaction_amount_is_stored_exactly_or_as_sent(session):
    """An amount the account currency can't hold is kept as the bank wrote it, never both or neither"""
    user = await _owner(session)
    everyday = _build_account(user.id)
    await _add(session, everyday)
    as_sent = _build_bank_transaction(everyday, "TRN-1")
    as_sent.observed_amount = None
    as_sent.raw_amount = "-12.505"
    both = _build_bank_transaction(everyday, "TRN-2")
    both.raw_amount = "-12.50"
    neither = _build_bank_transaction(everyday, "TRN-3")
    neither.observed_amount = None

    await _add(session, as_sent)
    await _refused(session, both, "ck_bank_transactions_observation")
    await _refused(session, neither, "ck_bank_transactions_observation")


async def test_bank_transaction_accepted_needs_its_ledger_row_and_aligned_date(session):
    """Accepted points at one ledger row with an aligned date, and nothing else carries either"""
    everyday, ledger_row = await _everyday_with_ledger_row(session)
    without_ledger_row = _build_bank_transaction(everyday, "TRN-1")
    without_ledger_row.disposition = BankTransactionDisposition.ACCEPTED
    without_ledger_row.aligned_date = without_ledger_row.observed_date
    waiting_with_ledger_row = _build_bank_transaction(everyday, "TRN-2")
    waiting_with_ledger_row.transaction_id = ledger_row.id

    await _refused(session, without_ledger_row, "ck_bank_transactions_accepted")
    await _refused(session, waiting_with_ledger_row, "ck_bank_transactions_accepted")


async def test_bank_transaction_version_moves_with_every_update(session):
    """A bulk approval reads the version to skip an item that changed after its preview"""
    user = await _owner(session)
    everyday = _build_account(user.id)
    await _add(session, everyday)
    record = _build_bank_transaction(everyday)
    await _add(session, record)
    first_version = record.version

    record.description = "HARBOUR COFFEE"
    await session.flush()

    assert (first_version, record.version) == (1, 2)


async def test_bank_transaction_deleted_with_its_ledger_row(session):
    """Deleting the ledger row leaves no marker of its bank identity, so it can return as new"""
    everyday, ledger_row = await _everyday_with_ledger_row(session)
    await _add(session, _build_bank_transaction(everyday, transaction=ledger_row))

    await session.execute(delete(Transaction).where(Transaction.id == ledger_row.id))

    assert await session.scalar(select(func.count()).select_from(BankTransaction)) == 0
    await _add(session, _build_bank_transaction(everyday))


async def test_bank_transaction_records_go_with_the_account_dismissals_included(session):
    """Deleting the Lumina account deletes every record, waiting, accepted and dismissed"""
    everyday, ledger_row = await _everyday_with_ledger_row(session)
    await _add(
        session,
        _build_bank_transaction(everyday, "TRN-1"),
        _build_bank_transaction(everyday, "TRN-2", transaction=ledger_row),
        _dismissed(_build_bank_transaction(everyday, "TRN-3")),
    )

    await session.execute(delete(Account).where(Account.id == everyday.id))

    assert await session.scalar(select(func.count()).select_from(BankTransaction)) == 0
