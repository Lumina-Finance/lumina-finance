"""The contract between the provider-neutral sync engine and each bank provider adapter

An adapter owns its provider's authentication, account discovery, fetch format and identity rules,
and hands the engine only these types, so the engine never reads a provider's wire format. The same
contract serves the app's requests and the worker's jobs
"""

import re
from abc import ABC, abstractmethod
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import ClassVar
from zoneinfo import ZoneInfo

from app.models.bank_connection import ConnectsFrom
from app.models.bank_sync_job import ProviderErrorKind

# The most characters of an error reason that are kept, enough for a line of the sync status details
MAX_ERROR_REASON_LENGTH = 500

# An ISO 4217 code. Anything else in its place, such as a URL or nothing, is a currency of the
# provider's own. No account can hold one
_ISO_CURRENCY_CODE = re.compile(r"[A-Z]{3}")


def is_iso_currency_code(currency: str) -> bool:
    """Return whether a provider's currency is an ISO 4217 code rather than one of its own"""
    return _ISO_CURRENCY_CODE.fullmatch(currency) is not None


@dataclass(frozen=True)
class CredentialField:
    """One field of a provider's connect form, the frontend drawing whatever fields the provider lists

    Each value is a secret: it is masked in every refusal and never stored, logged or shown
    """

    # The name its value is sent under, in the claim's credentials
    key: str
    label: str
    placeholder: str

    # The longest value the field takes, and the claim also refuses values past it
    max_length: int


@dataclass(frozen=True)
class ProviderError:
    """A typed failure, or a warning when it arrives alongside usable data

    The reason is shown in the sync status details, so it names at most the provider's host and
    never a credential or a full provider URL. A message the provider sent is kept as it came, cut
    to the reason cap, since the provider chooses its length and it is stored and shown
    """

    kind: ProviderErrorKind
    reason: str

    def __post_init__(self) -> None:
        """Cut a reason over the cap short, ending in an ellipsis"""
        if len(self.reason) > MAX_ERROR_REASON_LENGTH:
            object.__setattr__(self, "reason", self.reason[: MAX_ERROR_REASON_LENGTH - 1] + "…")


@dataclass(frozen=True)
class ProviderRecord:
    """One transaction as the provider reports it"""

    external_id: str

    # Derived by the adapter, since providers encode dates differently
    date: date

    # Signed minor units at the account currency's exponent, or None when the provider's amount
    # can't be stored exactly in that currency, so the record keeps raw_amount alone rather than
    # a rounded figure
    amount: int | None

    # The amount exactly as the provider sent it
    raw_amount: str
    description: str
    pending: bool

    # The provider says this transaction no longer exists
    removed: bool = False

    @property
    def stored_raw_amount(self) -> str | None:
        """The amount as sent, stored only when it can't be stored exactly, for the item to show as the bank sent it"""
        return self.raw_amount if self.amount is None else None


@dataclass(frozen=True)
class ExternalAccount:
    """One bank account the stored access reaches, with the records a fetch returned for it"""

    external_id: str
    name: str

    # Identifies the institution, so two logins at one bank count as one
    institution_key: str
    institution_name: str

    # The bank login the account sits under, for a provider whose one credential spans several
    login_key: str | None

    # The ISO 4217 code, or None for a provider-specific custom currency. A custom currency can't be linked
    currency: str | None

    # The currency exactly as the provider sent it
    currency_raw: str

    # Minor units, or None when the provider's figure can't be read or stored exactly
    balance: int | None
    available_balance: int | None
    balance_at: datetime

    # Whether the provider sent an available balance that can't be read or stored exactly. That
    # tells it apart from one never sent, since both leave available_balance None
    available_balance_unreadable: bool = False
    records: tuple[ProviderRecord, ...] = ()

    @property
    def bank_login(self) -> str:
        """The bank login the account sits under, the key that login errors use

        A provider without separate bank logins has one per institution
        """
        return self.login_key if self.login_key is not None else self.institution_key


@dataclass(frozen=True)
class FetchResult:
    """What one discovery or fetch request returned

    An account synced only when it is in accounts, has no entry in account_errors, and its login
    has none in login_errors. A request_error fails every account in the request, and accounts is
    then empty. Warnings arrived alongside account data. The data is kept unless a request_error
    fails the request: a rate-limited one means the provider's request quota is spent even when
    the response was usable
    """

    accounts: tuple[ExternalAccount, ...] = ()

    # Keyed by external account id
    account_errors: Mapping[str, ProviderError] = field(default_factory=dict)

    # Keyed by login key
    login_errors: Mapping[str, ProviderError] = field(default_factory=dict)
    request_error: ProviderError | None = None
    warnings: tuple[ProviderError, ...] = ()

    # The provider may have cut the response short, so its records can't be taken as complete
    possibly_cut_off: bool = False


class ClaimRefused(Exception):
    """The credential the user supplied can't be claimed, for a reason the user can act on

    The message is that reason, written for the user, and names at most the provider's host
    """


class ProviderUnreachable(Exception):
    """The provider couldn't be reached, or gave no usable answer, while claiming

    The message says so for the user, and names at most the provider's host
    """


class ProviderAdapter(ABC):
    """One bank provider as the sync engine sees it

    The engine counts one unit against the connection's request budget for each operation it calls,
    whatever number of requests the adapter sends inside it, so daily_request_budget is a count of
    operations. An adapter that sends several requests for one operation keeps them within what its
    provider tolerates. Each adapter lives in a subpackage of its own under providers, named after
    its provider_id and exporting the adapter class as ADAPTER, so deleting that folder removes the
    provider and nothing else
    """

    # Stored on every connection, link and bank transaction, so it never changes once used. Lowercase
    # letters, digits and underscores, starting with a letter, as the provider columns' check requires
    provider_id: ClassVar[str]
    provider_name: ClassVar[str]

    # Where the provider comes in the list the user chooses from, lowest first
    display_order: ClassVar[int]

    # The provider's own site. The user signs in to a bank again there when it asks
    provider_site: ClassVar[str]

    # One sentence on what connecting it reaches, shown where the user chooses a provider
    provider_description: ClassVar[str]

    # Marks the provider as in beta where the user chooses one
    in_beta: ClassVar[bool] = False

    # What the user pastes to connect, at least one field, and the steps to get it from the provider,
    # each a sentence
    credential_fields: ClassVar[tuple[CredentialField, ...]]
    connect_steps: ClassVar[tuple[str, ...]]

    # How many calendar months back an import may start
    history_limit_months: ClassVar[int]

    # Whether the provider says how much history it holds for an account
    advertises_history: ClassVar[bool]

    # Days before its checkpoint that a routine sync re-reads, to see late postings and corrections
    revisit_overlap_days: ClassVar[int]

    # The longest window one fetch may span
    max_window_days: ClassVar[int]

    # The operations a connection may run in a rolling 24 hours, each counted once
    daily_request_budget: ClassVar[int]
    connects_from: ClassVar[ConnectsFrom]

    @classmethod
    def on_startup(cls) -> None:
        """Run as the app and the bank sync worker start, such as to warn about a testing-only setting

        Does nothing unless the adapter has something to check
        """
        return

    @abstractmethod
    async def claim(self, supplied: Mapping[str, str]) -> str:
        """Exchange the credentials the user supplied for the access the app stores

        Args:
            supplied: Each of the provider's credential fields by its key, none blank or over its
                longest, as the engine checked them

        Returns:
            The credential to store encrypted and pass to discover and fetch

        Raises:
            ClaimRefused: The supplied credential can't be used, such as one already claimed
            ProviderUnreachable: The provider couldn't be reached or gave no usable answer
        """

    @abstractmethod
    def server_host(self, credential: str) -> str:
        """Return the host a stored credential reaches, the only part of it ever shown or logged ("Server")"""

    @abstractmethod
    async def discover(self, credential: str, *, currency_exponents: Mapping[str, int]) -> FetchResult:
        """List the bank accounts the stored access reaches, with their balances and no records

        Args:
            credential: The stored credential
            currency_exponents: Minor-unit exponent of every currency the app holds, by code

        Returns:
            The accounts found, and any errors and warnings the provider sent
        """

    @abstractmethod
    async def fetch(
        self,
        credential: str,
        *,
        account_ids: Sequence[str],
        start: datetime,
        end: datetime,
        include_pending: bool,
        timezone: ZoneInfo,
        currency_exponents: Mapping[str, int],
    ) -> FetchResult:
        """Fetch one window of records for chosen bank accounts

        Args:
            credential: The stored credential
            account_ids: External ids of the bank accounts to fetch
            start: First instant of the window, inclusive, timezone-aware
            end: Instant the window ends before, timezone-aware, at most max_window_days of
                elapsed time after start
            include_pending: Whether to ask for pending records too, as the engine does only for a
                window ending on the day it fixed as today. The adapter asks exactly as told, since
                a request sent after midnight still serves that day
            timezone: The user's profile timezone, used to date records
            currency_exponents: Minor-unit exponent of every currency the app holds, by code

        Returns:
            The accounts with their records, and any errors and warnings the provider sent. Each
            account asked for that a response without a request error leaves out has an error of
            its own, so the sync can say why it wasn't brought back

        Raises:
            ValueError: The window is empty, longer than max_window_days or not timezone-aware
        """
