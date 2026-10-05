"""Which bank providers a deployment offers, who may link bank accounts, and which accounts can take one

Group-owned accounts are left out of bank linking here and nowhere else, through the own personal
account condition, so grouped support can be added in one place later. Hosted plans are wired into
the bank-linking check and the institution limit when they are built
"""

import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import and_, exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.bank_sync import BANK_SYNC_SIMPLEFIN_ENABLED, BANK_SYNC_SIMPLEFIN_OFFERED
from app.models.account import Account
from app.models.bank_connection import BankAccountLink, BankExternalAccount, BankLinkState, BankProvider, UnavailableReason
from app.models.user import User
from app.schemas.bank_sync import BankProviderResponse, BankProvidersResponse
from app.services.accounts.access import own_personal_account_condition
from app.services.bank_sync.heartbeat import is_sync_worker_running
from app.services.bank_sync.providers.contract import ProviderAdapter, is_iso_currency_code
from app.services.bank_sync.providers.simplefin.adapter import SimpleFinAdapter

# Every provider adapter Lumina has, enabled here or not, so the name of the provider a connection
# or transaction came from stays readable after an operator disables it
PROVIDER_ADAPTERS: dict[BankProvider, type[ProviderAdapter]] = {adapter.provider_id: adapter for adapter in (SimpleFinAdapter,)}

# Each provider's deployment settings: whether it is enabled at all, and whether it is offered for
# new connections
_PROVIDER_SWITCHES = {BankProvider.SIMPLEFIN: (BANK_SYNC_SIMPLEFIN_ENABLED, BANK_SYNC_SIMPLEFIN_OFFERED)}

# The adapter serving each provider this deployment enables
ENABLED_ADAPTERS: dict[BankProvider, ProviderAdapter] = {
    provider: PROVIDER_ADAPTERS[provider]() for provider, (enabled, _) in _PROVIDER_SWITCHES.items() if enabled
}

# The providers new connections may be made with. Withdrawing one refuses only new connections, so
# existing ones keep syncing, linking, reconnecting and disconnecting
OFFERED_PROVIDERS: frozenset[BankProvider] = frozenset(provider for provider, (_, offered) in _PROVIDER_SWITCHES.items() if offered)

# A link that still feeds its account, active or waiting for its bank account to be chosen again
LIVE_LINK = BankAccountLink.state != BankLinkState.UNLINKED

# Joins a link to its bank account as the connection's provider last listed it, which records the
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


def is_offered(provider: BankProvider) -> bool:
    """Return whether new connections may be made with a provider"""
    return provider in OFFERED_PROVIDERS


def may_link_bank_accounts(user_id: uuid.UUID) -> bool:
    """Return whether a user may link bank accounts, which the provider list and every linking request check

    Always true on self-hosted deployments. Hosted plans that leave bank linking out answer here
    once a plans project builds them
    """
    return True


def require_bank_linking(user_id: uuid.UUID) -> None:
    """Refuse a user who may not link bank accounts

    Raises:
        HTTPException 403: The bank-linking check fails for the user
    """
    if not may_link_bank_accounts(user_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bank sync isn't available for your account")


def get_enabled_adapter(provider: BankProvider) -> ProviderAdapter:
    """Return the adapter for a provider the user chose, which this deployment has to enable

    Raises:
        HTTPException 422: The deployment doesn't enable the provider
    """
    adapter = ENABLED_ADAPTERS.get(provider)
    if adapter is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Choose a bank provider this server supports")
    return adapter


def get_institution_limit(user_id: uuid.UUID, provider: BankProvider) -> int | None:
    """Return how many institutions a user may link through a provider across their connections

    None, meaning no limit, on self-hosted deployments and for providers that only need the user's
    own credential. Hosted plans set it for providers charged per institution each month once a
    plans project builds them
    """
    return None


async def get_institution_allowance(db: AsyncSession, user_id: uuid.UUID, provider: BankProvider) -> InstitutionAllowance:
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

    These are the user's own personal accounts, which they can always edit, that are neither
    archived nor already linked to a bank

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
        return Unavailability(UnavailableReason.CUSTOM_CURRENCY, "Uses a currency of its own, which Lumina Finance can't track")
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
    for provider, adapter in ENABLED_ADAPTERS.items() if may_link else ():
        allowance = await get_institution_allowance(db, user.id, provider)
        providers.append(
            BankProviderResponse(
                id=provider,
                name=adapter.provider_name,
                description=adapter.provider_description,
                connects_from=adapter.connects_from,
                offered=is_offered(provider),
                history_limit_months=adapter.history_limit_months,
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
