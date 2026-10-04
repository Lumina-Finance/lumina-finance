"""Discovering the bank accounts a connection reaches

Discovery is a balances-only read of every bank account the connection's credential reaches. The
claim runs it within its request through run_discovery, and a sync job runs it as its first step
through apply_discovery, so a bank added at the provider appears, and a linked bank account that
vanished or changed currency stops syncing until it returns or the user chooses again
"""

import uuid
from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import select, update
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
from app.services.bank_sync.provider_requests import (
    RequestBudgetSpent,
    is_quota_spent,
    mark_request_budget_spent,
    reserve_provider_request,
)
from app.services.bank_sync.providers.contract import ExternalAccount, FetchResult, ProviderAdapter
from app.services.cache_state.updates import mark_user_cache_changed
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
    "balance_at",
    "listed",
    "last_seen_at",
)


async def run_discovery(db: AsyncSession, connection: BankConnection, adapter: ProviderAdapter, *, now: datetime) -> bool:
    """Discover a connection's bank accounts within a request

    The request is counted and committed before it is sent, together with whatever the request
    wrote before, such as a newly claimed connection, which has to be kept once its token is spent.
    No transaction stays open while the provider answers

    Args:
        db: The request's session
        connection: The connection to discover
        adapter: The connection's provider adapter
        now: When the discovery is sent

    Returns:
        Whether the bank accounts were read. False when the budget is spent or the provider gave no
        usable answer, so the caller queues a job to discover them later
    """
    currency_exponents = await get_all_currency_exponents(db)
    try:
        await reserve_provider_request(db, connection, purpose=ProviderRequestPurpose.DISCOVERY, now=now)
    except RequestBudgetSpent:
        return False
    await db.commit()

    result = await adapter.discover(decrypt(connection.credential_encrypted), currency_exponents=currency_exponents)
    await apply_discovery(db, connection, result, now=now)
    return result.request_error is None


async def apply_discovery(db: AsyncSession, connection: BankConnection, result: FetchResult, *, now: datetime) -> None:
    """Store what a discovery read and move the links it affects

    A sync job calls this with the result of the discovery it counted and sent. A failed discovery
    changes no bank account or link. A linked bank account no longer listed moves its link to
    Choose bank account only when nothing in the response could explain the gap, and one listed in
    a currency other than its account's moves too, since its amounts would be read at the wrong
    precision. A link waiting there returns to active when its bank account is listed again in
    the account's currency. The caller commits

    Args:
        db: Session of the connection's owner
        connection: The connection discovered
        result: What the discovery returned
        now: When the discovery was sent
    """
    # A quota warning beside usable data still means nothing more should be sent for now
    if is_quota_spent(result):
        await mark_request_budget_spent(db, connection, now=now)

    if result.request_error is not None:
        connection.discovery_failed_at = now
    else:
        await _store_bank_accounts(db, connection, result.accounts, now=now)
        vanished = await _mark_vanished(db, connection, result)
        await _move_links(db, connection, result.accounts, vanished)
        connection.discovered_at = now
    await mark_user_cache_changed(db, connection.owner_id)
    await db.flush()


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
            # A provider without separate bank logins has one per institution
            "login_key": account.login_key if account.login_key is not None else account.institution_key,
            # Kept as sent, so a custom currency is still listed and explained
            "currency": account.currency_raw,
            "balance": account.balance,
            "available_balance": account.available_balance,
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


async def _move_links(db: AsyncSession, connection: BankConnection, accounts: Sequence[ExternalAccount], vanished: set[str]) -> None:
    """Move the connection's live links between active and Choose bank account as the discovery found them"""
    listed = {account.external_id: account for account in accounts}
    links = await db.execute(
        select(BankAccountLink, Account.currency)
        .join(Account, Account.id == BankAccountLink.account_id)
        .where(
            BankAccountLink.connection_id == connection.id,
            BankAccountLink.state.in_((BankLinkState.ACTIVE, BankLinkState.CHOOSE_ACCOUNT)),
        )
        .execution_options(populate_existing=True)
    )
    for link, account_currency in links:
        bank_account = listed.get(link.external_account_id)
        if link.external_account_id in vanished or (bank_account is not None and bank_account.currency != account_currency):
            link.state = BankLinkState.CHOOSE_ACCOUNT
        elif bank_account is not None and link.state == BankLinkState.CHOOSE_ACCOUNT:
            link.state = BankLinkState.ACTIVE
