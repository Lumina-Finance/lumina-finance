"""Discovering the bank accounts a connection reaches

Discovery is a balances-only read of every bank account the connection's credential reaches. The
claim and the reconnect run it within their requests through run_discovery, which counts and sends
it and then stores what it read through apply_discovery. A bank added at the provider appears, and
a linked bank account that vanished or changed currency stops syncing until it returns or the user
chooses again. A sync's fetch reads the balances too, which store_fetched_balances keeps
"""

import uuid
from collections.abc import Collection, Sequence
from datetime import datetime

from sqlalchemy import or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.encryption import decrypt
from app.models.account import Account
from app.models.bank_connection import (
    BankAccountLink,
    BankConnection,
    BankExternalAccount,
    BankLinkState,
    ProviderRequestPurpose,
)
from app.services.bank_sync.connections import get_own_connection
from app.services.bank_sync.pending import replace_pending_transactions
from app.services.bank_sync.provider_requests import (
    RequestBudgetSpent,
    is_quota_spent,
    mark_request_budget_spent,
    reserve_provider_request,
)
from app.services.bank_sync.providers.contract import ExternalAccount, FetchResult, ProviderAdapter
from app.services.fx.currency_exponent_helpers import get_all_currency_exponents

# The stored fields a discovery refreshes on a bank account it lists again
_REFRESHED_FIELDS = (
    "name",
    "institution_key",
    "institution_name",
    "login_key",
    "currency",
    "balance",
    "available_balance",
    "available_balance_unreadable",
    "balance_at",
    "listed",
    "last_seen_at",
)


async def run_discovery(db: AsyncSession, connection: BankConnection, adapter: ProviderAdapter, *, now: datetime) -> bool:
    """Discover a connection's bank accounts within a request

    The request is counted and committed before it is sent, together with whatever the request
    wrote before, such as a newly claimed credential, which has to be kept once its token is spent.
    No transaction stays open while the provider answers. The connection is locked again before
    anything is stored and stays locked until the caller commits. The caller marks the user's cache
    changed once it has written everything else, as apply_discovery leaves it to

    Args:
        db: The request's session
        connection: The connection to discover
        adapter: The connection's provider adapter
        now: When the discovery is sent

    Returns:
        Whether the bank accounts were read. False when the budget is spent or the provider gave no
        usable answer, so the caller queues a job flagged to discover them

    Raises:
        HTTPException 404: The connection was disconnected while the provider answered
    """
    currency_exponents = await get_all_currency_exponents(db)
    try:
        await reserve_provider_request(db, connection, purpose=ProviderRequestPurpose.DISCOVERY, now=now)
    except RequestBudgetSpent:
        return False
    await db.commit()

    result = await adapter.discover(decrypt(connection.credential_encrypted), currency_exponents=currency_exponents)

    # A disconnect sent while the provider answered has either deleted the connection, so nothing is
    # stored, or waits until this request commits
    await get_own_connection(db, connection.owner_id, connection.id, lock={"key_share": True})
    connection.provider_name = adapter.provider_name

    # The user is in the app choosing as a claim or reconnect lists the bank accounts, so the links
    # it moves to Choose bank account are shown there rather than emailed
    await apply_discovery(db, connection, result, now=now)
    return result.request_error is None


async def apply_discovery(db: AsyncSession, connection: BankConnection, result: FetchResult, *, now: datetime) -> list[BankAccountLink]:
    """Store what a discovery read and move the links it affects

    It takes the result of a discovery already counted and sent. A failed discovery changes no
    bank account or link. A linked bank account no longer listed moves its link to
    Choose bank account only when nothing in the response could explain the gap, and one listed in
    a currency other than its account's moves too, since its amounts would be read at the wrong
    precision. Either way its account's pending items are cleared. A link waiting there returns to
    active when its bank account is listed again in the account's currency. The caller marks the
    user's cache changed and commits, since the cache row comes after the links, their pending items
    and any job the caller queues in the order requests lock rows in

    Args:
        db: Session of the connection's owner
        connection: The connection discovered
        result: What the discovery returned
        now: When the discovery was sent

    Returns:
        The links it moved from active to Choose bank account, as locked, which a sync emails their owner about
    """
    # A quota warning beside usable data still means nothing more should be sent for now
    if is_quota_spent(result):
        await mark_request_budget_spent(db, connection, now=now)

    moved = []
    if result.request_error is not None:
        connection.discovery_failed_at = now
    else:
        await _store_bank_accounts(db, connection, result.accounts, now=now)
        vanished = await _mark_vanished(db, connection, result)
        moved = await _move_links(db, connection, result.accounts, vanished)
        connection.discovered_at = now
    await db.flush()
    return moved


async def _store_bank_accounts(db: AsyncSession, connection: BankConnection, accounts: Sequence[ExternalAccount], *, now: datetime) -> None:
    """Add the bank accounts listed for the first time and refresh the ones listed before"""
    if not accounts:
        return

    # One statement can't write a row twice, so a bank account the provider lists twice is stored once
    unique = {account.external_id: account for account in accounts}
    rows = [
        {
            "id": uuid.uuid4(),
            "owner_id": connection.owner_id,
            "connection_id": connection.id,
            "external_id": account.external_id,
            "name": account.name,
            "institution_key": account.institution_key,
            "institution_name": account.institution_name,
            "login_key": account.bank_login,
            # Kept as sent, so a custom currency is still listed and explained
            "currency": account.currency_raw,
            "balance": account.balance,
            "available_balance": account.available_balance,
            "available_balance_unreadable": account.available_balance_unreadable,
            "balance_at": account.balance_at,
            "listed": True,
            "last_seen_at": now,
        }
        for account in unique.values()
    ]
    statement = insert(BankExternalAccount).values(rows)
    await db.execute(
        statement.on_conflict_do_update(
            index_elements=[BankExternalAccount.connection_id, BankExternalAccount.external_id],
            set_={field: statement.excluded[field] for field in _REFRESHED_FIELDS},
        )
    )


async def store_fetched_balances(db: AsyncSession, connection: BankConnection, accounts: Collection[ExternalAccount]) -> bool:
    """Store the balance a sync's fetch read for each of the connection's bank accounts, as a listing stores it

    A fetch reads each bank account's balance with its records, so the bank link shows the latest
    one without waiting for the next listing. A balance older than the one stored is left alone,
    since a listing may have read a newer one while the fetch was out. The caller holds the
    connection and the job, and locks the links only after this, the order a listing writes in

    Args:
        db: Session of the connection's owner
        connection: The connection fetched
        accounts: The bank accounts the fetch brought back whole

    Returns:
        Whether a stored balance changed
    """
    changed = False
    for account in sorted(accounts, key=lambda account: account.external_id):
        result = await db.execute(
            update(BankExternalAccount)
            .where(
                BankExternalAccount.connection_id == connection.id,
                BankExternalAccount.external_id == account.external_id,
                or_(BankExternalAccount.balance_at.is_(None), BankExternalAccount.balance_at <= account.balance_at),
                or_(
                    BankExternalAccount.balance.is_distinct_from(account.balance),
                    BankExternalAccount.available_balance.is_distinct_from(account.available_balance),
                    BankExternalAccount.available_balance_unreadable.is_distinct_from(account.available_balance_unreadable),
                    BankExternalAccount.balance_at.is_distinct_from(account.balance_at),
                ),
            )
            .values(
                balance=account.balance,
                available_balance=account.available_balance,
                available_balance_unreadable=account.available_balance_unreadable,
                balance_at=account.balance_at,
            )
        )
        changed = changed or result.rowcount > 0
    return changed


async def _mark_vanished(db: AsyncSession, connection: BankConnection, result: FetchResult) -> set[str]:
    """Mark as no longer listed each stored bank account the response conclusively left out

    A bank account is missing conclusively only when the response carries no general warning, no
    error for the bank account and none for its bank login, since any of those can explain the gap

    Returns:
        The external ids of the bank accounts that vanished
    """
    if result.warnings:
        return set()
    returned = {account.external_id for account in result.accounts}
    stored = await db.execute(
        select(BankExternalAccount.external_id, BankExternalAccount.login_key).where(
            BankExternalAccount.connection_id == connection.id,
            BankExternalAccount.listed.is_(True),
        )
    )
    vanished = {
        external_id
        for external_id, login_key in stored
        if external_id not in returned and external_id not in result.account_errors and login_key not in result.login_errors
    }
    if vanished:
        await db.execute(
            update(BankExternalAccount)
            .where(BankExternalAccount.connection_id == connection.id, BankExternalAccount.external_id.in_(vanished))
            .values(listed=False)
        )
    return vanished


async def _move_links(
    db: AsyncSession, connection: BankConnection, accounts: Sequence[ExternalAccount], vanished: set[str]
) -> list[BankAccountLink]:
    """Move the connection's live links between active and Choose bank account as the discovery found them

    The links are locked in id order and read again, so a link unlinked meanwhile is left alone.
    They are locked after the bank accounts, the order a link being made takes them in. A link
    waiting for its bank account has its account's pending items cleared, since nothing refreshes
    them meanwhile, and one that returns gets them back from its next sync. It drops a bank sign-in
    it was waiting on too, since no sync runs for it to clear one, and its next sync once it
    returns marks it again if its bank login still needs one

    Returns:
        The links moved from active to Choose bank account
    """
    listed = {account.external_id: account for account in accounts}
    links = await db.execute(
        select(BankAccountLink, Account.currency)
        .join(Account, Account.id == BankAccountLink.account_id)
        .where(
            BankAccountLink.connection_id == connection.id,
            BankAccountLink.state.in_((BankLinkState.ACTIVE, BankLinkState.CHOOSE_ACCOUNT)),
        )
        .order_by(BankAccountLink.id)
        .with_for_update(of=BankAccountLink)
        .execution_options(populate_existing=True)
    )
    moved = []
    for link, account_currency in links:
        bank_account = listed.get(link.external_account_id)
        if link.external_account_id in vanished or (bank_account is not None and bank_account.currency != account_currency):
            if link.state == BankLinkState.ACTIVE:
                moved.append(link)
            link.state = BankLinkState.CHOOSE_ACCOUNT
            link.signin_needed_since = None
            await replace_pending_transactions(db, link.account_id, [])
        elif bank_account is not None and link.state == BankLinkState.CHOOSE_ACCOUNT:
            link.state = BankLinkState.ACTIVE
    return moved
