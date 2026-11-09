"""Shared bank sync test builders

Tests build bank sync records directly, so each starts from exactly the state it needs. Each builder
returns an unsaved row with the fields every test needs, for the caller to add to whichever session
it is testing through. Rows other rows point at get their id up front, so a dependent row can be
built before the first is flushed, though each level still has to be flushed before the next.
Route tests sign up, link accounts and read the review list through the API, and record a bank source on a transaction they created there.
Review items, ledger rows and balances are read back as the table owner, whatever the test wrote them through.
Jobs are committed, since the worker reaches them through sessions of its own
"""

import contextlib
import uuid
from collections.abc import AsyncIterator, Collection
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import current_user_id_ctx
from app.models.account import Account, AccountBalanceSnapshot
from app.models.bank_connection import (
    BankAccountLink,
    BankConnection,
    BankExternalAccount,
    BankImportKind,
    BankProviderRequest,
    ProviderRequestPurpose,
)
from app.models.bank_pending_transaction import BankPendingTransaction
from app.models.bank_sync_job import BankSyncJob, BankSyncJobKind, BankSyncJobStatus
from app.models.bank_transaction import OBSERVATION_COLUMNS, BankTransaction, BankTransactionDisposition, OpenReviewKind
from app.models.base import AccountKind, AccountType, CategoryKind
from app.models.category import Category
from app.models.currency import Currency
from app.models.transaction import Transaction
from app.models.user import User
from app.services.bank_sync import links
from app.services.bank_sync.transaction_hash import hash_bank_transaction_id
from tests.conftest import ScopedSession, TestSession
from tests.routes.support.account_helpers import _create_account
from tests.routes.support.auth_helpers import SIGNUP_PAYLOAD, _create_user, _get_auth_header
from tests.routes.support.transaction_helpers import _create_transaction, _get_system_category_id
from tests.routes.transactions._import_helpers import _import_run
from tests.services.bank_sync.fake_provider import FAKE_PROVIDER

BANK_ACCOUNT_ID = "ACT-1"
LINK_START = date(2026, 9, 1)
BANK_DATE = date(2026, 10, 3)
BANK_DESCRIPTION = "HARBOUR COFFEE 0412"

# When the app received the record of a bank-sourced transaction. A test pins it where it reads it back
BANK_RECEIVED_AT = datetime(2026, 10, 4, 9, 5, tzinfo=UTC)

# The review list with nothing waiting
EMPTY_REVIEW_PAGE = {"items": [], "counts": {"new": 0, "correction": 0, "removal": 0}, "next_cursor": None}

# The values a dismissal clears, since a dismissed bank transaction keeps only its identity
_DISMISSED = {"disposition": BankTransactionDisposition.DISMISSED} | dict.fromkeys(OBSERVATION_COLUMNS)


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


def _build_bank_connection(owner_id: uuid.UUID, provider: str = FAKE_PROVIDER, provider_name: str = "Fake Bank") -> BankConnection:
    """Return an unsaved connection through a provider, the fake one unless told otherwise, with a placeholder token as its credential"""
    return BankConnection(
        id=uuid.uuid4(),
        owner_id=owner_id,
        provider=provider,
        provider_name=provider_name,
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
    """Commit a connection on the fake provider for the owner, rejected a day after it was made when asked"""
    async with TestSession() as session:
        connection = _build_bank_connection(owner_id)
        connection.created_at = created_at
        connection.nickname = nickname
        if rejected:
            connection.credential_rejected_at = created_at + timedelta(days=1)
        session.add(connection)
        await session.commit()
    return connection


async def _commit_listed_connection(
    owner_id: uuid.UUID,
    *external_ids: str,
    discovered_at: datetime | None = None,
    provider: str = FAKE_PROVIDER,
    provider_name: str = "Fake Bank",
) -> BankConnection:
    """Commit a connection listing a CAD chequing account at Harbour Bank under each external id, on the fake provider unless told otherwise

    It lists BANK_ACCOUNT_ID when given no id, and was never discovered unless told when
    """
    async with TestSession() as session:
        connection = _build_bank_connection(owner_id, provider, provider_name)
        connection.discovered_at = discovered_at
        session.add(connection)
        await session.flush()
        session.add_all([_build_external_account(connection, external_id) for external_id in external_ids or (BANK_ACCOUNT_ID,)])
        await session.commit()
    return connection


async def _commit_bank_balance(connection: BankConnection, **values) -> None:
    """Commit the balance the connection's bank accounts were last listed with, with no available balance unless told"""
    async with TestSession() as session:
        await session.execute(
            update(BankExternalAccount)
            .where(BankExternalAccount.connection_id == connection.id)
            .values(**{"available_balance": None, **values})
        )
        await session.commit()


async def _record_ledger(client, headers, account_id, *rows: tuple[str, int]) -> list[str]:
    """Record each dated amount on the account through the route, income as Salary and spending as Groceries

    Returns:
        The transactions' ids, in the order given
    """
    salary_id = await _get_system_category_id(client, headers, "Salary")
    groceries_id = await _get_system_category_id(client, headers, "Groceries")
    recorded = []
    for day, amount in rows:
        created = await _create_transaction(client, headers, account_id, salary_id if amount > 0 else groceries_id, dt=day, amount=amount)
        assert created.status_code == 201, created.text
        recorded.append(created.json()["id"])
    return recorded


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
    """Return an unsaved link from an account to a bank account on a connection, active unless told otherwise

    The link is owned by the account's owner and names the connection's provider
    """
    return BankAccountLink(
        id=uuid.uuid4(),
        owner_id=account.owner_id,
        account_id=account.id,
        connection_id=connection.id if connection else None,
        provider=connection.provider if connection else FAKE_PROVIDER,
        external_account_id=external_account_id,
        external_account_name="Everyday Chequing",
        institution_name="Harbour Bank",
        import_kind=BankImportKind.INITIAL,
        import_start=LINK_START,
        checkpoint=date(2026, 8, 31),
        **values,
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

    Given its ledger row, the record is accepted and aligned with the bank's date and amount.
    Otherwise it awaits review
    """
    accepted = transaction is not None
    return BankTransaction(
        id=uuid.uuid4(),
        owner_id=account.owner_id,
        account_id=account.id,
        provider=FAKE_PROVIDER,
        external_account_id=external_account_id,
        external_transaction_hash=hash_bank_transaction_id(FAKE_PROVIDER, external_account_id, external_transaction_id),
        disposition=BankTransactionDisposition.ACCEPTED if accepted else BankTransactionDisposition.AWAITING_REVIEW,
        transaction_id=transaction.id if accepted else None,
        observed_date=BANK_DATE,
        observed_amount=amount,
        description=BANK_DESCRIPTION,
        observed_at=datetime(2026, 10, 4, 9, 0, tzinfo=UTC),
        aligned_date=BANK_DATE if accepted else None,
        aligned_amount=amount if accepted else None,
    )


async def _commit_waiting_items(link: BankAccountLink, count: int, *, external_account_id: str | None = None) -> list[uuid.UUID]:
    """Commit this many new items for the link's account, each awaiting its first review, sent by the link's bank account unless told otherwise

    Returns:
        Their ids, also their review items'
    """
    sent_by = external_account_id or link.external_account_id
    async with TestSession() as session:
        account = await session.get_one(Account, link.account_id)
        items = [_build_bank_transaction(account, f"TRN-waiting-{number}", external_account_id=sent_by) for number in range(count)]
        session.add_all(items)
        await session.commit()
    return [item.id for item in items]


async def _commit_accepted_items(link: BankAccountLink, *, plain: int = 0, corrections: int = 0, removals: int = 0) -> None:
    """Commit bank transactions the link's bank account sent that the user accepted into the ledger

    Given counts have nothing open on them, a correction open, or a removal open
    """
    open_kinds = [None] * plain + [OpenReviewKind.CORRECTION] * corrections + [OpenReviewKind.REMOVAL] * removals
    async with TestSession() as session:
        account = await session.get_one(Account, link.account_id)
        category = _build_category(account.owner_id)
        session.add(category)
        await session.flush()
        ledger = [_build_ledger_transaction(account, category.id) for _ in open_kinds]
        session.add_all(ledger)
        await session.flush()
        for number, (transaction, open_kind) in enumerate(zip(ledger, open_kinds, strict=True)):
            record = _build_bank_transaction(
                account, f"TRN-accepted-{number}", external_account_id=link.external_account_id, transaction=transaction
            )
            record.open_kind = open_kind
            if open_kind == OpenReviewKind.REMOVAL:
                record.removed_at = record.observed_at
            session.add(record)
        await session.commit()


async def _dismiss_items(session: AsyncSession, item_ids: Collection[uuid.UUID]) -> None:
    """Dismiss these review items in the session, as the user's review action does, leaving the caller to commit"""
    # A Core update moves the version itself, as the model asks
    await session.execute(
        update(BankTransaction).where(BankTransaction.id.in_(item_ids)).values(version=BankTransaction.version + 1, **_DISMISSED)
    )


async def _commit_link(
    account_id: str | uuid.UUID, connection: BankConnection, external_account_id: str = BANK_ACCOUNT_ID, **values
) -> BankAccountLink:
    """Commit an active link from the account to a bank account on the connection, with any of its values replaced"""
    async with TestSession() as session:
        account = await session.get_one(Account, uuid.UUID(str(account_id)))
        link = _build_bank_link(account, connection, external_account_id, **values)
        session.add(link)
        await session.commit()
    return link


async def _update_connection(connection: BankConnection, **values) -> None:
    """Commit new values on the connection"""
    async with TestSession() as session:
        await session.execute(update(BankConnection).where(BankConnection.id == connection.id).values(**values))
        await session.commit()


async def _commit_paused_link(account_id: str | uuid.UUID, now: datetime) -> BankAccountLink:
    """Commit the account's link on a new connection, paused for review, its import long ended and its next sync a day after now"""
    async with TestSession() as session:
        account = await session.get_one(Account, uuid.UUID(str(account_id)))
    connection = await _commit_listed_connection(account.owner_id)
    link = _build_bank_link(account, connection, paused=True, importing=False, next_attempt_at=now + timedelta(days=1))
    async with TestSession() as session:
        session.add(link)
        await session.commit()
    return link


async def _pause_state(link: BankAccountLink) -> tuple[bool, datetime, list[str]]:
    """Return whether the link is paused for review, when it is next due, and the kind of each sync queued for its connection"""
    async with TestSession() as session:
        paused, next_attempt_at = (
            await session.execute(select(BankAccountLink.paused, BankAccountLink.next_attempt_at).where(BankAccountLink.id == link.id))
        ).one()
        queued = await session.scalars(
            select(BankSyncJob.kind).where(BankSyncJob.connection_id == link.connection_id, BankSyncJob.status == "queued")
        )
        return paused, next_attempt_at, list(queued)


@contextlib.asynccontextmanager
async def _owner_session(owner_id: uuid.UUID) -> AsyncIterator[AsyncSession]:
    """Open a session as the owner under row-level security, as the owner's own requests run"""
    token = current_user_id_ctx.set(owner_id)
    try:
        async with ScopedSession() as session:
            yield session
    finally:
        current_user_id_ctx.reset(token)


async def _record_bank_source(
    transaction_id: str | uuid.UUID,
    external_transaction_id: str = "TRN-1001",
    *,
    bank_amount: int = -1250,
) -> uuid.UUID:
    """Commit the accepted bank transaction a ledger row came from, aligned with the bank's values

    Returns:
        The bank transaction's id, also its review item's
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


async def _still_stored(item_id: uuid.UUID) -> bool:
    """Return whether the item's bank transaction is still stored, read as the table owner"""
    async with TestSession() as session:
        return await session.get(BankTransaction, item_id) is not None


async def _ledger_rows(account_id: str | uuid.UUID) -> list[tuple[date, int]]:
    """Return the date and amount of each of the account's ledger transactions, read as the table owner"""
    async with TestSession() as session:
        rows = await session.execute(select(Transaction.dt, Transaction.amount).where(Transaction.account_id == uuid.UUID(str(account_id))))
        return [tuple(row) for row in rows]


async def _balances(account_id: str | uuid.UUID) -> list[tuple[date, int]]:
    """Return the account's end-of-day balances, earliest first, read as the table owner"""
    async with TestSession() as session:
        rows = await session.execute(
            select(AccountBalanceSnapshot.dt, AccountBalanceSnapshot.balance)
            .where(AccountBalanceSnapshot.account_id == uuid.UUID(str(account_id)))
            .order_by(AccountBalanceSnapshot.dt)
        )
        return [tuple(row) for row in rows]


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


def _build_pending_transaction(account: Account, description: str = "HOLD HARBOUR FUEL", amount: int = -2500) -> BankPendingTransaction:
    """Return an unsaved pending item the bank reports for an account"""
    return BankPendingTransaction(
        owner_id=account.owner_id,
        account_id=account.id,
        transaction_date=date(2026, 10, 4),
        amount=amount,
        description=description,
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


async def _spend_requests(connection: BankConnection, count: int, oldest: datetime) -> None:
    """Commit requests sent a minute apart from the oldest, as the connection's budget counts them"""
    async with TestSession() as session:
        session.add_all(
            BankProviderRequest(
                owner_id=connection.owner_id,
                connection_id=connection.id,
                purpose=ProviderRequestPurpose.SYNC,
                requested_at=oldest + timedelta(minutes=minute),
            )
            for minute in range(count)
        )
        await session.commit()


async def _commit_running_job(
    connection: BankConnection,
    *links: BankAccountLink,
    now: datetime,
    kind: BankSyncJobKind = BankSyncJobKind.SCHEDULED,
    lease_left: timedelta = timedelta(minutes=10),
) -> None:
    """Commit a job running on the connection that syncs the links, its lease ending `lease_left` after `now`

    `now` is the time the test pins the status read to, so the lease reads the same whatever today is
    """
    await _seed_job(
        connection,
        kind,
        status=BankSyncJobStatus.RUNNING,
        lease_expires_at=now + lease_left,
        covered_link_ids=[link.id for link in links],
    )


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


class _QueuedWait(timedelta):
    """How long after it was queued a job may run, as measured, equal to the wait it was queued with

    The measure counts from the start of the transaction that queued the job, so it runs past that
    wait by however long the transaction took to queue it, and never falls short of it
    """

    # Far longer than a transaction takes to queue a job, and far shorter than any two waits a test tells apart
    _ALLOWANCE = timedelta(seconds=5)

    def __eq__(self, other: object) -> bool:
        """Return whether the wait was queued as the other, allowing for the time taken to queue it"""
        if not isinstance(other, timedelta):
            return NotImplemented
        return timedelta(0) <= self - other <= self._ALLOWANCE


async def _queued_jobs() -> list[tuple]:
    """Return the queued job's kind, how long after it was queued it may run, and whether it lists the bank accounts first

    A job waits by the database's clock and a test's frozen clock doesn't stop it, so the wait it was
    queued with is what a test can pin
    """
    async with TestSession() as session:
        rows = await session.execute(
            select(BankSyncJob.kind, BankSyncJob.run_after - BankSyncJob.created_at, BankSyncJob.discover).where(BankSyncJob.status == "queued")
        )
        return [(kind, _QueuedWait(wait.days, wait.seconds, wait.microseconds), discover) for kind, wait, discover in rows]


async def _attempts(*links: BankAccountLink) -> list[tuple]:
    """Return each link's last successful sync, last attempt, why it failed, failed attempts in its retry series and next attempt"""
    async with TestSession() as session:
        rows = [
            (
                await session.execute(
                    select(
                        BankAccountLink.last_success_at,
                        BankAccountLink.last_attempt_at,
                        BankAccountLink.last_failure_reason,
                        BankAccountLink.retry_count,
                        BankAccountLink.next_attempt_at,
                    ).where(BankAccountLink.id == link.id)
                )
            ).one()
            for link in links
        ]
    return [tuple(row) for row in rows]


async def _changed_at(client, headers) -> str | None:
    """Return when the user's data last changed, as the cache status reports it"""
    status = await client.get("/me/cache-status", headers=headers)
    assert status.status_code == 200, status.text
    return status.json()["personal"]["changed_at"]


async def _import_a_file(client, headers) -> None:
    """Import a file holding a $4.50 coffee into a new Wallet account, and the user can then undo it for a while"""
    imported = await _import_run(
        client,
        headers,
        {
            "accounts": [{"source": "Wallet", "create": {"name": "Wallet", "account_type": "checking", "currency": "CAD"}}],
            "categories": [{"source": "Coffee", "create": {"name": "Coffee", "kind": "expense"}}],
            "rows": [
                {
                    "account_source": "Wallet",
                    "category_source": "Coffee",
                    "dt": "2026-09-15",
                    "amount": "-4.50",
                    "merchant_name": "Harbour Coffee",
                }
            ],
        },
    )
    assert imported.status_code == 201, imported.text


async def _undoable_import(client, headers) -> dict | None:
    """Return the import the user can still undo, or None when there is none"""
    last = await client.get("/transactions/import/last", headers=headers)
    assert last.status_code == 200, last.text
    return last.json()
