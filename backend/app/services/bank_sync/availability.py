"""The bank providers a deployment offers, the users who may link bank accounts, and the accounts that can take one

Group-owned accounts are left out of bank linking here and nowhere else, through the own personal
account condition, so grouped support can be added in one place later. Whether a user may link
bank accounts, and how many institutions they may link, are each answered by one function here
"""

import uuid
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import cache

from fastapi import HTTPException, status
from sqlalchemy import and_, exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.bank_sync import read_provider_settings
from app.models.account import Account
from app.models.bank_connection import BankAccountLink, BankConnection, BankExternalAccount, BankLinkState, UnavailableReason
from app.models.user import User
from app.schemas.bank_sync import BankProviderResponse, BankProvidersResponse, CredentialFieldResponse
from app.services.accounts.access import own_personal_account_condition
from app.services.bank_sync.heartbeat import is_sync_worker_running
from app.services.bank_sync.providers.contract import ProviderAdapter, is_iso_currency_code
from app.services.bank_sync.providers.registry import load_adapters

# What a connection whose provider is no longer installed says in place of syncing
PROVIDER_GONE_DETAIL = "This provider is no longer available on this server, so syncing is off for this connection"


@dataclass(frozen=True)
class InstalledProvider:
    """A provider installed on this server, with its deployment switches"""

    adapter: ProviderAdapter

    # Whether it is available at all. A provider turned off keeps its name readable on what it brought in
    enabled: bool

    # Whether new connections may be made. Withdrawing it refuses only new connections, so existing
    # ones keep syncing, linking, reconnecting and disconnecting
    offered: bool


@cache
def installed_providers() -> dict[str, InstalledProvider]:
    """Return every provider installed on this server, enabled or not, by provider id

    A connection, link or bank transaction whose provider id is missing here came through a provider
    since removed, and is read without an adapter: it syncs nothing and keeps what it brought in

    Raises:
        RuntimeError: A provider refuses one of its settings
    """
    installed = {}
    for provider_id, adapter in load_adapters().items():
        settings = read_provider_settings(provider_id)
        installed[provider_id] = InstalledProvider(adapter=adapter(), enabled=settings.enabled, offered=settings.offered)
    return installed


def adapter_for(provider_id: str) -> ProviderAdapter | None:
    """Return the adapter of an installed provider, enabled or not, or None for one no longer installed"""
    installed = installed_providers().get(provider_id)
    return installed.adapter if installed is not None else None


def provider_label(provider_id: str, stored_name: str | None = None) -> str:
    """Return the name a provider is shown by: its own, else once it is no longer installed the name its connection stored, or the stored id"""
    adapter = adapter_for(provider_id)
    if adapter is not None:
        return adapter.provider_name
    return stored_name or provider_id


async def read_provider_labels(db: AsyncSession, provider_ids: Iterable[str]) -> dict[str, str]:
    """Return the name each provider is shown by, as provider_label gives it, by provider id

    A record or link kept after its own connection was disconnected still finds the name through
    any connection the user has on that provider, the newest winning. Only a provider no longer
    installed is looked up, so a read through installed providers sends no query
    """
    ids = set(provider_ids)
    gone = {provider_id for provider_id in ids if adapter_for(provider_id) is None}
    stored: dict[str, str] = {}
    if gone:
        rows = await db.execute(
            select(BankConnection.provider, BankConnection.provider_name)
            .where(BankConnection.provider.in_(gone))
            .order_by(BankConnection.created_at)
        )
        stored = dict(rows.all())
    return {provider_id: provider_label(provider_id, stored.get(provider_id)) for provider_id in ids}


def provider_site_label(provider_id: str) -> str | None:
    """Return the name of the site where the user manages a provider's bank logins, or None once it is no longer installed"""
    adapter = adapter_for(provider_id)
    return adapter.provider_site if adapter is not None else None


def enabled_adapters() -> dict[str, ProviderAdapter]:
    """Return the adapter of each provider this deployment enables, by provider id"""
    return {provider_id: installed.adapter for provider_id, installed in installed_providers().items() if installed.enabled}


# A link that still feeds its account, active or waiting for its bank account to be chosen again
LIVE_LINK = BankAccountLink.state != BankLinkState.UNLINKED

# Joins a link to its bank account as the connection's provider last listed it. That listing records the
# bank login the account sits under
LINK_LISTING = and_(
    BankExternalAccount.connection_id == BankAccountLink.connection_id,
    BankExternalAccount.external_id == BankAccountLink.external_account_id,
)

# Why a visible account the user doesn't own alone, such as a group account, can't be linked
LINK_NOT_OWN_DETAIL = "Accounts shared with a group can't be linked to a bank yet"


@dataclass(frozen=True)
class Unavailability:
    """A bank account that can't be linked to an account, and the short sentence saying why"""

    reason: UnavailableReason
    message: str


@dataclass(frozen=True)
class InstitutionAllowance:
    """How many institutions the user may link through one provider, and the ones already in use"""

    # None when the deployment sets no limit
    limit: int | None

    # Names by institution key, each institution counted once however many logins reach it
    in_use: Mapping[str, str]


def is_offered(provider: str) -> bool:
    """Return whether new connections may be made with a provider"""
    installed = installed_providers().get(provider)
    return installed is not None and installed.offered


def may_link_bank_accounts(user_id: uuid.UUID) -> bool:
    """Return whether a user may link bank accounts. The provider list and every linking request check this

    Every user may, so it always returns true
    """
    return True


def require_bank_linking(user_id: uuid.UUID) -> None:
    """Refuse a user who may not link bank accounts

    Raises:
        HTTPException 403: The bank-linking check fails for the user
    """
    if not may_link_bank_accounts(user_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bank sync isn't available for your account")


def get_enabled_adapter(provider: str) -> ProviderAdapter:
    """Return the adapter for a provider the user chose. This deployment has to enable it

    Raises:
        HTTPException 422: The deployment doesn't enable the provider, or it is no longer installed
    """
    adapter = enabled_adapters().get(provider)
    if adapter is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Choose a bank provider this server supports")
    return adapter


def get_institution_limit(user_id: uuid.UUID, provider: str) -> int | None:
    """Return how many institutions a user may link through a provider across their connections

    Always None, meaning no limit, since every provider here only needs the user's own credential
    """
    return None


async def get_institution_allowance(db: AsyncSession, user_id: uuid.UUID, provider: str) -> InstitutionAllowance:
    """Return a user's institution limit for a provider and the institutions already counting toward it

    An institution counts once while any of its bank accounts is linked, through any connection,
    and stops counting when its last one is unlinked

    Args:
        db: Active database session
        user_id: User linking bank accounts
        provider: Provider the limit applies to

    Returns:
        The limit and the institutions in use
    """
    in_use = await db.execute(
        select(BankExternalAccount.institution_key, func.min(BankExternalAccount.institution_name))
        .join(BankAccountLink, LINK_LISTING)
        .where(BankAccountLink.owner_id == user_id, BankAccountLink.provider == provider, LIVE_LINK)
        .group_by(BankExternalAccount.institution_key)
    )
    return InstitutionAllowance(limit=get_institution_limit(user_id, provider), in_use=dict(in_use.all()))


async def read_linked_bank_accounts(db: AsyncSession, user_id: uuid.UUID) -> dict[tuple[str, str], tuple[uuid.UUID, str]]:
    """Return the account each of the user's linked bank accounts feeds

    A bank account feeds one ledger per user, so a link made through any connection counts

    Args:
        db: Active database session
        user_id: User linking bank accounts

    Returns:
        The linked account's id and name, by the bank account's provider and external id
    """
    links = await db.execute(
        select(BankAccountLink.provider, BankAccountLink.external_account_id, Account.id, Account.name)
        .join(Account, Account.id == BankAccountLink.account_id)
        .where(BankAccountLink.owner_id == user_id, LIVE_LINK)
    )
    return {(provider, external_id): (account_id, name) for provider, external_id, account_id, name in links}


async def list_link_candidates(db: AsyncSession, user_id: uuid.UUID) -> list[Account]:
    """Return the accounts a bank account could be linked to, before matching the bank account itself

    These are the user's own personal accounts, so the user can always edit them, leaving out
    any that is archived or already linked to a bank

    Args:
        db: Active database session
        user_id: User linking bank accounts

    Returns:
        The accounts, by name
    """
    is_linked = exists().where(BankAccountLink.account_id == Account.id, LIVE_LINK)
    result = await db.execute(
        select(Account)
        .where(own_personal_account_condition(user_id), Account.is_archived.is_(False), ~is_linked)
        .order_by(Account.name, Account.id)
    )
    return list(result.scalars())


def find_unavailability(
    bank_account: BankExternalAccount,
    account: Account,
    *,
    linked_to: str | None,
    allowance: InstitutionAllowance,
    provider_name: str,
) -> Unavailability | None:
    """Return why a bank account can't be linked to an account, or None when it can

    Args:
        bank_account: The bank account as its connection last listed it
        account: One of the user's link candidates
        linked_to: Name of the account the bank account is already linked to, through any of the
            user's connections, or None
        allowance: The user's institution limit for the provider and the institutions in use
        provider_name: The provider's name, for the institution limit's sentence

    Returns:
        The reason and its sentence, or None
    """
    if not is_iso_currency_code(bank_account.currency):
        return Unavailability(UnavailableReason.CUSTOM_CURRENCY, "Uses a currency of its own, so no link is possible")
    if bank_account.currency != account.currency:
        return Unavailability(
            UnavailableReason.CURRENCY_MISMATCH,
            f"In {bank_account.currency}, but {account.name} is in {account.currency}",
        )
    if linked_to is not None:
        return Unavailability(UnavailableReason.ALREADY_LINKED, f"Already linked to {linked_to}")

    # An institution already in use costs nothing more
    limit = allowance.limit
    if limit is not None and bank_account.institution_key not in allowance.in_use and len(allowance.in_use) >= limit:
        institutions = "institution" if limit == 1 else "institutions"
        return Unavailability(
            UnavailableReason.INSTITUTION_LIMIT,
            f"Would go over your limit of {limit} {institutions} for {provider_name}",
        )
    return None


async def list_providers(db: AsyncSession, user: User) -> BankProvidersResponse:
    """Return the providers the deployment enables, and whether the user can link bank accounts now

    Args:
        db: Active database session
        user: User choosing a provider

    Returns:
        The bank-linking check, whether sync is running, and each enabled provider's facts with
        whether it is offered and the user's institution limit for it. A user who may not link
        bank accounts is offered no provider
    """
    may_link = may_link_bank_accounts(user.id)
    providers = []
    listed = sorted(enabled_adapters().items(), key=lambda entry: (entry[1].display_order, entry[0])) if may_link else []
    for provider, adapter in listed:
        allowance = await get_institution_allowance(db, user.id, provider)
        providers.append(
            BankProviderResponse(
                id=provider,
                name=adapter.provider_name,
                site=adapter.provider_site,
                description=adapter.provider_description,
                in_beta=adapter.in_beta,
                credential_fields=[
                    CredentialFieldResponse(key=entry.key, label=entry.label, placeholder=entry.placeholder, max_length=entry.max_length)
                    for entry in adapter.credential_fields
                ],
                connect_steps=list(adapter.connect_steps),
                connects_from=adapter.connects_from,
                offered=is_offered(provider),
                advertises_history=adapter.advertises_history,
                institution_limit=allowance.limit,
                institutions_in_use=sorted(allowance.in_use.values()),
            )
        )
    return BankProvidersResponse(
        may_link=may_link,
        sync_running=await is_sync_worker_running(db, datetime.now(UTC)),
        providers=providers,
    )
