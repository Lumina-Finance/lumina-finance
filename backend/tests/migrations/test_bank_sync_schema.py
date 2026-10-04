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
from app.models.bank_connection import (
    BankAccountLink,
    BankConnection,
    BankExternalAccount,
    BankLinkState,
    BankProviderRequest,
    BankSigninNotice,
    ProviderRequestPurpose,
)
from app.models.user import User
from tests.conftest import WORKER_DB_NAME
from tests.migrations.support import _create_engine_for_database, _drop_database, _recreate_database, _run_alembic_upgrade
from tests.routes.support.bank_sync_helpers import (
    _build_account,
    _build_bank_connection,
    _build_bank_link,
    _build_external_account,
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
