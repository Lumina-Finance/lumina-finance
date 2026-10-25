"""Bank sync storage rules, checked on a database the migrations built

The rest of the suite builds its schema from the models, where a uniqueness rule or a cascade the
migration left out would still pass. These tests share one migrated database per worker, and each
runs inside a transaction rolled back at its end, so none sees another's rows
"""

from datetime import UTC, datetime
from pathlib import Path

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.exc import IntegrityError, ProgrammingError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.config.database import APP_DB_USER
from app.db.credentials import resolve_role_password
from app.models.account import Account
from app.models.account_review_preference import AccountReviewPreference
from app.models.bank_connection import (
    BankAccountLink,
    BankConnection,
    BankExternalAccount,
    BankLinkState,
    BankProviderRequest,
    ProviderRequestPurpose,
)
from app.models.bank_pending_transaction import BankPendingTransaction
from app.models.bank_sync_job import BankSyncJob, BankSyncJobKind, BankSyncJobStatus
from app.models.bank_transaction import BankTransaction, BankTransactionDisposition, OpenReviewKind
from app.models.transaction import Transaction
from app.models.user import User
from app.services.bank_sync.worker import is_database_migrated
from tests.conftest import DB_HOST, DB_PORT, WORKER_DB_NAME
from tests.migrations.support import _create_engine_for_database, _drop_database, _recreate_database, _run_alembic_upgrade
from tests.routes.support.bank_sync_helpers import (
    _build_account,
    _build_bank_connection,
    _build_bank_link,
    _build_bank_transaction,
    _build_category,
    _build_external_account,
    _build_ledger_transaction,
    _build_pending_transaction,
    _build_user,
)

_DATABASE_NAME = f"{WORKER_DB_NAME}_alembic_bank_sync"
_BACKEND_DIR = Path(__file__).resolve().parents[2]


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
    await _add(session, link, _build_external_account(connection), request)

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
    for model in (BankExternalAccount, BankProviderRequest):
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


async def test_account_review_preferences_go_with_the_account(session):
    """Deleting an account deletes its stored choices"""
    user = await _owner(session)
    everyday = _build_account(user.id)
    await _add(session, everyday)
    await _add(session, AccountReviewPreference(account_id=everyday.id, owner_id=user.id, corrections="trust"))

    await session.execute(delete(Account).where(Account.id == everyday.id))

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


async def test_bank_transaction_previous_values_belong_to_an_accepted_record(session):
    """The bank's values before a correction are kept on an accepted record, never on one still waiting"""
    everyday, ledger_row = await _everyday_with_ledger_row(session)
    waiting = _build_bank_transaction(everyday, "TRN-1")
    waiting.previous_values = {"amount": -1000}
    corrected = _build_bank_transaction(everyday, "TRN-2", amount=-1050, transaction=ledger_row)
    corrected.open_kind = OpenReviewKind.CORRECTION
    corrected.previous_values = {"amount": -1000}

    await _refused(session, waiting, "ck_bank_transactions_review_state")
    await _add(session, corrected)


async def test_bank_transaction_kept_description_belongs_to_an_accepted_record(session):
    """A description the user kept over the bank's is kept on an accepted record, never on one still waiting"""
    everyday, ledger_row = await _everyday_with_ledger_row(session)
    waiting = _build_bank_transaction(everyday, "TRN-1")
    waiting.kept_description = "SQ *BLUE BOTTLE"
    kept = _build_bank_transaction(everyday, "TRN-2", transaction=ledger_row)
    kept.kept_description = "SQ *BLUE BOTTLE"

    await _refused(session, waiting, "ck_bank_transactions_review_state")
    await _add(session, kept)


async def test_bank_transaction_removal_is_opened_only_once_the_provider_reported_it_on_an_accepted_record(session):
    """A removal needs the time the provider reported it, and only an accepted record holds that time"""
    everyday, ledger_row = await _everyday_with_ledger_row(session)
    reported_at = datetime(2026, 10, 4, 9, tzinfo=UTC)
    waiting = _build_bank_transaction(everyday, "TRN-1")
    waiting.removed_at = reported_at
    unreported = _build_bank_transaction(everyday, "TRN-2", transaction=ledger_row)
    unreported.open_kind = OpenReviewKind.REMOVAL
    removed = _build_bank_transaction(everyday, "TRN-3", transaction=ledger_row)
    removed.open_kind = OpenReviewKind.REMOVAL
    removed.removed_at = reported_at

    await _refused(session, waiting, "ck_bank_transactions_review_state")
    await _refused(session, unreported, "ck_bank_transactions_removal")
    await _add(session, removed)


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


async def test_bank_pending_transaction_amount_is_stored_exactly_or_as_sent(session):
    """A pending amount the currency can't hold is kept as written, never both or neither"""
    user = await _owner(session)
    everyday = _build_account(user.id)
    await _add(session, everyday)
    as_sent = _build_pending_transaction(everyday, "P-1")
    as_sent.amount = None
    as_sent.raw_amount = "-25.005"
    neither = _build_pending_transaction(everyday, "P-2")
    neither.amount = None

    await _add(session, as_sent)
    await _refused(session, neither, "ck_bank_pending_transactions_amount")


async def test_bank_pending_transactions_go_with_the_account(session):
    """Deleting the Lumina account deletes its pending items and no one else's"""
    user = await _owner(session)
    everyday = _build_account(user.id, "Everyday")
    rewards = _build_account(user.id, "Rewards Visa")
    await _add(session, everyday, rewards)
    await _add(session, _build_pending_transaction(everyday, "P-1"), _build_pending_transaction(rewards, "P-2"))

    await session.execute(delete(Account).where(Account.id == everyday.id))

    assert (await session.scalars(select(BankPendingTransaction.description))).all() == ["P-2"]


async def test_bank_sync_jobs_one_running_and_one_queued_per_connection(session):
    """A second running or queued job on a connection is refused, and finished ones pile up freely"""
    user = await _owner(session)
    connection = _build_bank_connection(user.id)
    await _add(session, connection)

    def job(status: BankSyncJobStatus) -> BankSyncJob:
        finished = status in (BankSyncJobStatus.SUCCEEDED, BankSyncJobStatus.FAILED)
        return BankSyncJob(
            owner_id=user.id,
            connection_id=connection.id,
            kind=BankSyncJobKind.SCHEDULED,
            status=status,
            lease_expires_at=func.now() if status == BankSyncJobStatus.RUNNING else None,
            finished_at=func.now() if finished else None,
        )

    await _add(session, job(BankSyncJobStatus.RUNNING), job(BankSyncJobStatus.QUEUED))
    await _add(session, job(BankSyncJobStatus.SUCCEEDED), job(BankSyncJobStatus.FAILED), job(BankSyncJobStatus.SUCCEEDED))

    await _refused(session, job(BankSyncJobStatus.RUNNING), "uq_bank_sync_jobs_running")
    await _refused(session, job(BankSyncJobStatus.QUEUED), "uq_bank_sync_jobs_queued")


def _app_role_engine(database_name: str) -> AsyncEngine:
    """Return an engine connecting to a migrated database as the app role, with no request identity"""
    url = f"postgresql+asyncpg://{APP_DB_USER}:{resolve_role_password('app', generate=False)}@{DB_HOST}:{DB_PORT}/{database_name}"
    return create_async_engine(url, poolclass=NullPool)


async def test_migration_revisions_tell_the_app_role_the_database_is_at_head(migrated_database):
    """The worker checks the migration level through its own role, which can't read the history"""
    head = ScriptDirectory.from_config(Config(str(_BACKEND_DIR / "alembic.ini"))).get_current_head()
    engine = _app_role_engine(migrated_database)
    try:
        async with engine.connect() as connection:
            assert (await connection.scalars(text("SELECT public.migration_revisions()"))).all() == [head]
            assert await is_database_migrated(connection)
            with pytest.raises(ProgrammingError, match="permission denied"):
                await connection.execute(text("SELECT version_num FROM alembic_version"))
    finally:
        await engine.dispose()


async def test_is_database_migrated_is_false_while_the_database_is_at_an_earlier_revision(session):
    """After an upgrade the worker claims nothing until the app has migrated the database to this release

    The worker reads the revision through the definer function, so recording the revision before
    head is what a database the app hasn't migrated yet looks like to it
    """
    script = ScriptDirectory.from_config(Config(str(_BACKEND_DIR / "alembic.ini")))
    earlier = script.get_revision(script.get_current_head()).down_revision
    await session.execute(text("UPDATE alembic_version SET version_num = :earlier"), {"earlier": earlier})

    assert await is_database_migrated(await session.connection()) is False


async def test_bank_sync_heartbeat_written_by_the_worker_is_readable_by_the_app_role(migrated_database):
    """The app tells whether sync is running from the heartbeat the worker's scan stamps"""
    scanned_at = datetime(2026, 10, 4, 12, 0, tzinfo=UTC)
    engine = _app_role_engine(migrated_database)
    try:
        async with engine.connect() as connection:
            await connection.execute(text("SELECT public.record_bank_sync_scan(:now)"), {"now": scanned_at})
            heartbeat = (await connection.execute(text("SELECT id, last_scan_at FROM bank_sync_heartbeat"))).all()
            await connection.rollback()
    finally:
        await engine.dispose()

    assert [tuple(row) for row in heartbeat] == [(1, scanned_at)]


# Every bank sync table holding a user's rows
_SECURED_BANK_TABLES = (
    "bank_connections",
    "bank_provider_requests",
    "bank_external_accounts",
    "bank_account_links",
    "account_review_preferences",
    "bank_transactions",
    "bank_pending_transactions",
    "bank_sync_jobs",
)


async def test_bank_tables_have_row_level_security_and_a_policy_from_the_migrations(session):
    """A bank table the migrations left unsecured would show one user's bank data to every user"""
    secured = (
        await session.execute(
            text(
                "SELECT c.relname, c.relrowsecurity, EXISTS (SELECT 1 FROM pg_policies p "
                "WHERE p.schemaname = 'public' AND p.tablename = c.relname) "
                "FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY(:tables)"
            ),
            {"tables": list(_SECURED_BANK_TABLES)},
        )
    ).all()

    assert {name: (enabled, has_policy) for name, enabled, has_policy in secured} == dict.fromkeys(_SECURED_BANK_TABLES, (True, True))
