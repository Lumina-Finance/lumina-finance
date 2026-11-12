"""Shared helpers for the bank sync service tests, including those of each provider"""

from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select

from app.models.bank_connection import BankAccountLink, BankConnection, BankProviderRequest, ProviderRequestPurpose
from app.models.bank_sync_job import BankSyncJob
from app.models.bank_transaction import BankTransaction
from app.models.currency import Currency
from app.models.user import User
from app.services.bank_sync.transaction_hash import hash_bank_transaction_id
from app.services.bank_sync.worker import run_jobs
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import _build_account, _build_bank_connection, _build_bank_link, _build_user

_NOW = datetime(2026, 10, 4, 12, 0, tzinfo=UTC)

# The date the frozen clock reads
_TODAY = date(2026, 10, 4)

# More jobs than any test here queues, so a job that keeps queueing another fails the test
_MOST_JOBS = 10

# A stored bank transaction keeps only the keyed hash of the ID the bank sent. Naming this column in what
# _bank_transactions returns reads that ID back, from the IDs the tests have sent so far
_BANK_ID = BankTransaction.external_transaction_hash.label("bank_id")
_KNOWN_BANK_IDS: set[str] = set()

# The connection's credential
_CREDENTIAL = "https://user:secret@bridge.example/simplefin"


async def _seed_connection(db, email: str):
    """Add a user and their connection, returning the connection"""
    user = _build_user(email)
    db.add(user)
    await db.flush()
    connection = _build_bank_connection(user.id)
    db.add(connection)
    await db.flush()
    return connection


async def _connection_with_requests(db, *sent_at: datetime) -> BankConnection:
    """Add a user and their connection. The connection sent a request at each of the times"""
    db.add(Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2))
    await db.flush()
    connection = await _seed_connection(db, "budget@example.com")
    db.add_all(
        BankProviderRequest(owner_id=connection.owner_id, connection_id=connection.id, purpose=ProviderRequestPurpose.SYNC, requested_at=moment)
        for moment in sent_at
    )
    await db.flush()
    return connection


async def _link(connection: BankConnection, external_id: str, **values) -> BankAccountLink:
    """Commit an account linked to the bank account, its link's fields set as given"""
    account = _build_account(connection.owner_id, name=external_id)
    link = _build_bank_link(account, connection, external_id)
    for field, value in values.items():
        setattr(link, field, value)
    async with TestSession() as session:
        session.add(account)
        await session.flush()
        session.add(link)
        await session.commit()
    return link


def _read_back_id(provider: str, bank_account: str, stored_hash: str) -> str:
    """Return the ID the tests sent that a bank transaction's keyed hash stands for, or the hash itself when none matches"""
    sent = (bank_id for bank_id in _KNOWN_BANK_IDS if hash_bank_transaction_id(provider, bank_account, bank_id) == stored_hash)
    return next(sent, stored_hash)


async def _bank_transactions(*columns) -> list[tuple]:
    """Return these columns of every stored bank transaction, by bank account and then the ID the bank sent

    Only the keyed hash of that ID is stored, so _BANK_ID reads back the ID among those the tests sent
    """
    async with TestSession() as session:
        rows = await session.execute(
            select(BankTransaction.provider, BankTransaction.external_account_id, BankTransaction.external_transaction_hash, *columns)
        )
    found = [
        (bank_account, _read_back_id(provider, bank_account, stored_hash), values) for provider, bank_account, stored_hash, *values in rows
    ]
    return [
        tuple(bank_id if column is _BANK_ID else value for column, value in zip(columns, values, strict=True))
        for _, bank_id, values in sorted(found, key=lambda stored: stored[:2])
    ]


async def _run_jobs_until_none_is_due() -> None:
    """Run jobs one at a time until none is due, failing rather than looping if jobs keep coming"""
    for _ in range(_MOST_JOBS):
        if not await run_jobs(1):
            return
    pytest.fail(f"Jobs were still queued after {_MOST_JOBS} ran")


async def _jobs() -> list[tuple]:
    """Return every job's kind, discovery flag and status"""
    async with TestSession() as session:
        return [tuple(row) for row in await session.execute(select(BankSyncJob.kind, BankSyncJob.discover, BankSyncJob.status))]


async def _checkpoints(*links: BankAccountLink) -> list[date]:
    """Return each link's committed checkpoint"""
    async with TestSession() as session:
        return [await session.scalar(select(BankAccountLink.checkpoint).where(BankAccountLink.id == link.id)) for link in links]


async def _set_owner_timezone(connection: BankConnection, timezone: ZoneInfo) -> None:
    """Commit the connection's owner's profile timezone"""
    async with TestSession() as session:
        (await session.get(User, connection.owner_id)).tz = timezone.key
        await session.commit()
