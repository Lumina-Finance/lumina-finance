"""Shared bank sync test builders

Tests build bank sync records directly, so each starts from exactly the state it needs. Each builder
returns an unsaved row with the fields every test needs, for the caller to add to whichever session
it is testing through. Rows other rows point at get their id up front, so a dependent row can be
built before the first is flushed, though each level still has to be flushed before the next.
Route tests sign up, link accounts and read the review list through the API, and record a bank source on a transaction they created there.
Jobs are committed, since the worker reaches them through sessions of its own
"""

import asyncio
import uuid
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import select, update

from app.models.account import Account
from app.models.bank_connection import (
    BankAccountLink,
    BankConnection,
    BankExternalAccount,
    BankImportKind,
    BankProvider,
    BankSigninNotice,
)
from app.models.bank_pending_transaction import BankPendingTransaction
from app.models.bank_sync_job import BankSyncJob, BankSyncJobKind
from app.models.bank_transaction import BankTransaction, BankTransactionDisposition
from app.models.base import AccountKind, AccountType, CategoryKind
from app.models.category import Category
from app.models.currency import Currency
from app.models.transaction import Transaction
from app.models.user import User
from app.services.bank_sync import links
from tests.conftest import TestSession
from tests.fake_simplefin_bridge import FakeBridgeTransport
from tests.routes.support.account_helpers import _create_account
from tests.routes.support.auth_helpers import SIGNUP_PAYLOAD, _create_user, _get_auth_header

BANK_ACCOUNT_ID = "ACT-1"
LINK_START = date(2026, 9, 1)
BANK_DATE = date(2026, 10, 3)
BANK_DESCRIPTION = "HARBOUR COFFEE 0412"

# When the app received the record of a bank-sourced transaction, which a test pins where it reads it back
BANK_RECEIVED_AT = datetime(2026, 10, 4, 9, 5, tzinfo=UTC)

# The review list with nothing waiting
EMPTY_REVIEW_PAGE = {"items": [], "counts": {"new": 0, "correction": 0, "removal": 0}, "next_cursor": None}


async def _sign_up(client) -> tuple[dict, uuid.UUID]:
    """Sign up the default user, with USD available for accounts, and return their auth headers and id"""
    signup = await _create_user(client)
    assert signup.status_code == 201, signup.text
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()
    return _get_auth_header(signup), uuid.UUID(signup.json()["user"]["id"])


def _build_user(email: str) -> User:
    """Return an unsaved user with the fields every test user needs"""
    return User(id=uuid.uuid4(), email=email, first_name="Test", tz="America/Toronto", base_currency="CAD")


def _build_account(owner_id: uuid.UUID, name: str = "Everyday") -> Account:
    """Return an unsaved personal chequing account in CAD"""
    return Account(
        id=uuid.uuid4(),
        owner_id=owner_id,
        account_kind=AccountKind.ASSET,
        account_type=AccountType.CHECKING,
        name=name,
        currency="CAD",
    )


def _build_bank_connection(owner_id: uuid.UUID) -> BankConnection:
    """Return an unsaved SimpleFIN connection whose credential is a placeholder token"""
    return BankConnection(
        id=uuid.uuid4(),
        owner_id=owner_id,
        provider=BankProvider.SIMPLEFIN,
        credential_encrypted="not-a-real-token",
        server_host="bridge.example",
    )


async def _commit_bank_connection(
    owner_id: uuid.UUID,
    *,
    created_at: datetime,
    nickname: str | None = None,
    rejected: bool = False,
) -> BankConnection:
    """Commit a SimpleFIN connection for the owner, rejected a day after it was made when asked"""
    async with TestSession() as session:
        connection = _build_bank_connection(owner_id)
        connection.created_at = created_at
        connection.nickname = nickname
        if rejected:
            connection.credential_rejected_at = created_at + timedelta(days=1)
        session.add(connection)
        await session.commit()
    return connection


async def _commit_listed_connection(owner_id: uuid.UUID, *external_ids: str, discovered_at: datetime | None = None) -> BankConnection:
    """Commit a SimpleFIN connection listing a CAD chequing account at Harbour Bank under each external id

    It lists BANK_ACCOUNT_ID when given no id, and was never discovered unless told when
    """
    async with TestSession() as session:
        connection = _build_bank_connection(owner_id)
        connection.discovered_at = discovered_at
        session.add(connection)
        await session.flush()
        session.add_all([_build_external_account(connection, external_id) for external_id in external_ids or (BANK_ACCOUNT_ID,)])
        await session.commit()
    return connection


async def _new_account(client, headers, name: str, **fields) -> str:
    """Create a CAD account through the API and return its id"""
    created = await _create_account(client, headers, name=name, **fields)
    assert created.status_code == 201, created.text
    return created.json()["id"]


async def _link(client, headers, account_id, connection_id, external_account_id: str = BANK_ACCOUNT_ID, *, start_date: date | None = None):
    """Link an account to a bank account through the route, from 30 days before the user's today unless told otherwise

    Today is read from the clock the link route reads, so it agrees with the route when a test pins it
    """
    if start_date is None:
        start_date = links.datetime.now(ZoneInfo(SIGNUP_PAYLOAD["tz"])).date() - timedelta(days=30)
    return await client.post(
        f"/accounts/{account_id}/bank-link",
        json={"connection_id": str(connection_id), "external_account_id": external_account_id, "start_date": start_date.isoformat()},
        headers=headers,
    )


def _build_external_account(connection: BankConnection, external_id: str = BANK_ACCOUNT_ID) -> BankExternalAccount:
    """Return an unsaved bank account listed by a connection"""
    return BankExternalAccount(
        owner_id=connection.owner_id,
        connection_id=connection.id,
        external_id=external_id,
        name="Everyday Chequing",
        institution_key="harbour",
        institution_name="Harbour Bank",
        login_key="login-1",
        currency="CAD",
        last_seen_at=datetime(2026, 10, 1, tzinfo=UTC),
    )


def _build_bank_link(
    account: Account,
    connection: BankConnection | None,
    external_account_id: str = BANK_ACCOUNT_ID,
    **values,
) -> BankAccountLink:
    """Return an unsaved link from a Lumina account to a bank account on a connection, active unless told otherwise

    The link is owned by the account's owner and names the connection's provider
    """
    return BankAccountLink(
        id=uuid.uuid4(),
        owner_id=account.owner_id,
        account_id=account.id,
        connection_id=connection.id if connection else None,
        provider=BankProvider.SIMPLEFIN,
        external_account_id=external_account_id,
        external_account_name="Everyday Chequing",
        institution_name="Harbour Bank",
        import_kind=BankImportKind.INITIAL,
        import_start=LINK_START,
        checkpoint=date(2026, 8, 31),
        **values,
    )


def _build_signin_notice(connection: BankConnection, login_key: str = "login-1") -> BankSigninNotice:
    """Return an unsaved notice that a bank login on a connection needs a sign-in"""
    return BankSigninNotice(
        owner_id=connection.owner_id,
        connection_id=connection.id,
        login_key=login_key,
        since=datetime(2026, 10, 1, tzinfo=UTC),
    )


def _build_category(owner_id: uuid.UUID) -> Category:
    """Return an unsaved personal expense category"""
    return Category(id=uuid.uuid4(), owner_id=owner_id, name="Coffee", kind=CategoryKind.EXPENSE)


def _build_ledger_transaction(account: Account, category_id: uuid.UUID, amount: int = -1250) -> Transaction:
    """Return an unsaved ledger transaction on the bank's date, in the account's currency"""
    return Transaction(
        id=uuid.uuid4(),
        created_by_user_id=account.owner_id,
        account_id=account.id,
        dt=BANK_DATE,
        category_id=category_id,
        amount=amount,
        currency=account.currency,
    )


def _build_bank_transaction(
    account: Account,
    external_transaction_id: str = "TRN-1001",
    *,
    external_account_id: str = BANK_ACCOUNT_ID,
    amount: int = -1250,
    transaction: Transaction | None = None,
) -> BankTransaction:
    """Return an unsaved bank transaction the bank sent for an account

    Given its ledger row, the record is accepted and aligned with the bank's date and amount;
    otherwise it awaits review
    """
    accepted = transaction is not None
    return BankTransaction(
        id=uuid.uuid4(),
        owner_id=account.owner_id,
        account_id=account.id,
        provider=BankProvider.SIMPLEFIN,
        external_account_id=external_account_id,
        external_transaction_id=external_transaction_id,
        disposition=BankTransactionDisposition.ACCEPTED if accepted else BankTransactionDisposition.AWAITING_REVIEW,
        transaction_id=transaction.id if accepted else None,
        observed_date=BANK_DATE,
        observed_amount=amount,
        description=BANK_DESCRIPTION,
        observed_at=datetime(2026, 10, 4, 9, 0, tzinfo=UTC),
        aligned_date=BANK_DATE if accepted else None,
        aligned_amount=amount if accepted else None,
    )


async def _record_bank_source(
    transaction_id: str | uuid.UUID,
    external_transaction_id: str = "TRN-1001",
    *,
    bank_amount: int = -1250,
) -> uuid.UUID:
    """Commit the accepted bank transaction a ledger row came from, aligned with the bank's values

    Returns:
        The bank transaction's id, which is also its review item's
    """
    async with TestSession() as session:
        txn = await session.get(Transaction, uuid.UUID(str(transaction_id)))
        account = await session.get(Account, txn.account_id)
        record = _build_bank_transaction(account, external_transaction_id, amount=bank_amount, transaction=txn)
        record.received_at = BANK_RECEIVED_AT
        session.add(record)
        await session.commit()
    return record.id


async def _commit_review_item(account_id: str | uuid.UUID, external_transaction_id: str = "TRN-1001", **values) -> uuid.UUID:
    """Commit a bank item waiting for its first review on an account, with any of its values replaced

    Returns:
        The item's id
    """
    async with TestSession() as session:
        account = await session.get_one(Account, uuid.UUID(str(account_id)))
        record = _build_bank_transaction(account, external_transaction_id)
        for field, value in values.items():
            setattr(record, field, value)
        session.add(record)
        await session.commit()
    return record.id


async def _review_page(client, headers, **params) -> dict:
    """Return a page of the review list, read through the route"""
    page = await client.get("/bank-review/items", params=params, headers=headers)
    assert page.status_code == 200, page.text
    return page.json()


async def _stored_item(item_id: uuid.UUID) -> BankTransaction:
    """Return a review item's bank transaction as stored, read as the table owner"""
    async with TestSession() as session:
        return await session.get_one(BankTransaction, item_id)


async def _commit_other_users_account() -> Account:
    """Commit another user with a personal account of their own, named Theirs"""
    async with TestSession() as session:
        other = _build_user("other@example.com")
        session.add(other)
        await session.flush()
        theirs = _build_account(other.id, name="Theirs")
        session.add(theirs)
        await session.commit()
    return theirs


async def _new_group_account(client, headers) -> str:
    """Create the Smith Family group and its Joint account through the API, the user as its admin, and return the account's id"""
    group = await client.post("/groups", json={"name": "Smith Family"}, headers=headers)
    assert group.status_code == 201, group.text
    return await _new_account(client, headers, "Joint", group_id=group.json()["id"])


def _build_pending_transaction(account: Account, external_transaction_id: str, amount: int = -2500) -> BankPendingTransaction:
    """Return an unsaved pending item the bank reports for an account"""
    return BankPendingTransaction(
        owner_id=account.owner_id,
        account_id=account.id,
        external_transaction_id=external_transaction_id,
        transaction_date=date(2026, 10, 4),
        amount=amount,
        description="HOLD HARBOUR FUEL",
        observed_at=datetime(2026, 10, 4, 9, 0, tzinfo=UTC),
    )


async def _seed_job(connection: BankConnection, kind: BankSyncJobKind, **values) -> BankSyncJob:
    """Commit a job for a connection, queued and due an hour ago unless told otherwise"""
    values.setdefault("run_after", datetime.now(UTC) - timedelta(hours=1))
    job = BankSyncJob(owner_id=connection.owner_id, connection_id=connection.id, kind=kind, **values)
    async with TestSession() as session:
        session.add(job)
        await session.commit()
    return job


async def _expire_lease(job: BankSyncJob) -> None:
    """End a running job's lease a minute ago, as though its worker stopped mid-job"""
    async with TestSession() as session:
        await session.execute(
            update(BankSyncJob).where(BankSyncJob.id == job.id).values(lease_expires_at=datetime.now(UTC) - timedelta(minutes=1))
        )
        await session.commit()


async def _job_states() -> dict:
    """Return every job's status and attempt by id, read as the table owner"""
    async with TestSession() as session:
        rows = (await session.execute(select(BankSyncJob.id, BankSyncJob.status, BankSyncJob.attempt))).all()
    return {job_id: (status, attempt) for job_id, status, attempt in rows}


async def _changed_at(client, headers) -> str | None:
    """Return when the user's data last changed, as the cache status reports it"""
    status = await client.get("/me/cache-status", headers=headers)
    assert status.status_code == 200, status.text
    return status.json()["personal"]["changed_at"]


class _PausedBridge(httpx.AsyncBaseTransport):
    """Forwards to the fake SimpleFIN Bridge, holding the first request whose path has a marker until released"""

    def __init__(self, marker: str) -> None:
        """Hold the first request whose path contains the marker, such as /claim/ or /accounts"""
        self._inner = FakeBridgeTransport()
        self._marker = marker
        self.reached = asyncio.Event()
        self.release = asyncio.Event()

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        """Hold the first marked request until released, and forward every request"""
        if self._marker in request.url.path and not self.reached.is_set():
            self.reached.set()
            await self.release.wait()
        return await self._inner.handle_async_request(request)
