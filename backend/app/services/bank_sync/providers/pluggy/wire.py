"""Reading Pluggy's API responses into the provider contract

Amounts are JSON numbers, so a body is read with every decimal number as a Decimal and never passes
through a float, since a float could change the figure before it is stored. Only the fields sync needs are
read, so an account number, a credit limit, a merchant, a payment method or any other detail Pluggy
sends is dropped as the body is read
"""

import datetime as dt
import json
import logging
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal
from typing import Any
from urllib.parse import parse_qsl
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.services.bank_sync.providers.contract import ExternalAccount, ProviderRecord, is_iso_currency_code
from app.utils.money import parse_decimal_amount_to_minor_units

# Item statuses whose data can be read. UPDATING and MERGING are a refresh in progress, and the
# data from before it is still there
READABLE_STATUSES = frozenset({"UPDATED", "UPDATING", "MERGING"})

# Item statuses that wait on the user, and the execution statuses that say the user has to act at
# their bank or in Pluggy, whatever the item's status says. Reconnecting is the user's to do
LOGIN_STATUSES = frozenset({"LOGIN_ERROR", "WAITING_USER_INPUT", "WAITING_USER_ACTION"})
LOGIN_EXECUTION_STATUSES = frozenset(
    {
        "INVALID_CREDENTIALS",
        "INVALID_CREDENTIALS_MFA",
        "USER_INPUT_TIMEOUT",
        "ACCOUNT_LOCKED",
        "ACCOUNT_NEEDS_ACTION",
        "ACCOUNT_CREDENTIALS_RESET",
        "USER_AUTHORIZATION_PENDING",
        "USER_AUTHORIZATION_NOT_GRANTED",
        "USER_AUTHORIZATION_REVOKED",
    }
)

# Pluggy signs a credit card's amounts with a charge positive
CREDIT_TYPE = "CREDIT"
PENDING_STATUS = "PENDING"

# The path Pluggy's transaction cursors point at
TRANSACTIONS_PATH = "/v2/transactions"

# Amounts with more digits than this before the decimal point are never a real balance, and writing
# one out in full could take far more memory than the response held
_MAX_INTEGER_DIGITS = 30

_UNNAMED_INSTITUTION = "Unnamed bank"

logger = logging.getLogger(__name__)


class UnreadableResponse(Exception):
    """The body isn't a response in the shape Pluggy documents"""


# The most places one log line names, so an answer full of mismatches can't flood the log
_MAX_LOGGED_PLACES = 5


def _places(error: ValidationError, within: tuple[str | int, ...] = ()) -> list[str]:
    """Return where each mismatch of an error is and its kind, never a value

    The answer holds the user's account names and amounts, so a value is never logged

    Args:
        error: What the answer failed on
        within: Where in the answer the failed entry sits, such as ("results", 3)
    """
    return [
        f"{'.'.join(str(part) for part in (*within, *detail['loc'])) or 'root'} ({detail['type']})"
        for detail in error.errors(include_input=False)
    ]


def _log_mismatches(answer: str, places: Sequence[str]) -> None:
    """Log where an answer differs from the documented shape, naming the first few places

    Args:
        answer: Which answer it was, such as "the account list"
        places: Where each mismatch is
    """
    logger.warning("Pluggy's answer to %s doesn't fit its documented shape at %s", answer, ", ".join(places[:_MAX_LOGGED_PLACES]))


def _unreadable(answer: str, error: ValidationError) -> UnreadableResponse:
    """Log where an answer differs from the documented shape and return the failure to raise"""
    _log_mismatches(answer, _places(error))
    return UnreadableResponse()


def _read_each[M: BaseModel](
    entries: Sequence[object], model: type[M], answer: str, *, is_unwanted: Callable[[object], bool] = lambda _: False
) -> tuple[list[M], int]:
    """Read each entry of a list on its own, so one that can't be read costs only itself

    Args:
        entries: The entries of the list
        model: What each entry is read as
        answer: Which answer it was, such as "the account list"
        is_unwanted: Whether an entry that can't be read is one the sync leaves out anyway, so it is
            neither logged nor counted

    Returns:
        The entries that could be read, and how many couldn't
    """
    read: list[M] = []
    skipped = 0
    places: list[str] = []
    for position, entry in enumerate(entries):
        try:
            read.append(model.model_validate(entry))
        except ValidationError as error:
            if is_unwanted(entry):
                continue
            skipped += 1
            if len(places) < _MAX_LOGGED_PLACES:
                places.extend(_places(error, ("results", position)))
    if skipped:
        _log_mismatches(answer, places)
    return read, skipped


class _Model(BaseModel):
    """Blind to fields sync doesn't need, so nothing else Pluggy sends is kept"""

    model_config = ConfigDict(extra="ignore", frozen=True, populate_by_name=True)


class _Auth(_Model):
    apiKey: str


class _Connector(_Model):
    id: int | str

    # Pluggy's schema leaves the name optional
    name: str | None = None


class WireItem(_Model):
    """An item, one bank connection, as Pluggy describes it"""

    id: str

    # Pluggy's schema leaves the connector optional
    connector: _Connector | None = None
    status: str
    executionStatus: str | None = None
    lastUpdatedAt: dt.datetime | None = None

    @property
    def needs_login(self) -> bool:
        """Whether the user has to act before the item syncs again"""
        return self.status in LOGIN_STATUSES or self.executionStatus in LOGIN_EXECUTION_STATUSES

    @property
    def is_readable(self) -> bool:
        """Whether the item's data can be read and trusted"""
        return not self.needs_login and self.status in READABLE_STATUSES


class WireAccount(_Model):
    """An account as Pluggy lists it"""

    id: str
    type: str
    name: str
    balance: Decimal
    currencyCode: str

    @property
    def is_card(self) -> bool:
        """Whether Pluggy signs the account's amounts as a credit card's"""
        return self.type == CREDIT_TYPE


class _AccountPage(_Model):
    totalPages: int = 1

    # Pluggy's schema leaves the results optional. Each is read on its own, so one that can't be read
    # doesn't fail the others
    results: list[Any] = Field(default_factory=list)


class _WireTransaction(_Model):
    id: str
    date: dt.datetime
    amount: Decimal
    amountInAccountCurrency: Decimal | None = None
    currencyCode: str | None = None
    status: str = "POSTED"
    description: str | None = None


class _TransactionList(_Model):
    results: list[Any]
    next: str | None = None


@dataclass(frozen=True)
class AccountPage:
    """One page of an account list, and how many pages there are"""

    accounts: tuple[WireAccount, ...]
    total_pages: int

    # Accounts the page lists that couldn't be read
    skipped: int


@dataclass(frozen=True)
class TransactionPage:
    """One page of an account's transactions, and where the next one starts"""

    records: tuple[ProviderRecord, ...]

    # Transactions the page lists that couldn't be read
    skipped: int

    # The cursor Pluggy gives for the next page, None on the last page
    next_after: str | None


def _read_json(body: bytes) -> object:
    """Parse a body with decimal numbers as Decimal

    Raises:
        UnreadableResponse: The body isn't JSON
    """

    def refuse_constant(constant: str) -> object:
        """Refuse NaN and the infinities, since JSON has no numbers for them"""
        raise ValueError(constant)

    try:
        return json.loads(body, parse_float=Decimal, parse_constant=refuse_constant)
    except ValueError:
        logger.warning("Pluggy answered with a body that isn't JSON")
        raise UnreadableResponse from None


def read_api_key(body: bytes) -> str:
    """Read the answer to POST /auth

    Raises:
        UnreadableResponse: The body isn't the documented shape, or the key is blank
    """
    try:
        key = _Auth.model_validate(_read_json(body)).apiKey
    except ValidationError as error:
        raise _unreadable("the sign-in", error) from None
    if not key.strip():
        logger.warning("Pluggy's answer to the sign-in holds a blank key at apiKey")
        raise UnreadableResponse
    return key


def read_item(body: bytes) -> WireItem:
    """Read the answer to GET /items/{id}

    Raises:
        UnreadableResponse: The body isn't the documented shape
    """
    try:
        return WireItem.model_validate(_read_json(body))
    except ValidationError as error:
        raise _unreadable("an item", error) from None


def read_account_page(body: bytes) -> AccountPage:
    """Read the answer to GET /accounts, skipping each account that can't be read

    Raises:
        UnreadableResponse: The body isn't the documented shape
    """
    try:
        page = _AccountPage.model_validate(_read_json(body))
    except ValidationError as error:
        raise _unreadable("the account list", error) from None
    accounts, skipped = _read_each(page.results, WireAccount, "the account list")
    return AccountPage(tuple(accounts), page.totalPages, skipped)


def read_transaction_page(
    body: bytes,
    account: WireAccount,
    *,
    exponent: int | None,
    timezone: ZoneInfo,
    start: dt.datetime,
    end: dt.datetime,
    include_pending: bool,
) -> TransactionPage:
    """Read the answer to GET /v2/transactions, skipping each transaction that can't be read

    Args:
        body: The response body
        account: The account the transactions belong to
        exponent: The minor-unit exponent of the account's currency, if Lumina Finance holds it
        timezone: The user's timezone, used to date each transaction
        start: First instant of the window, inclusive. Pluggy is asked for a day more on each side,
            so what lies outside the window is left out here
        end: Instant the window ends before
        include_pending: Whether pending transactions are kept

    Raises:
        UnreadableResponse: The body isn't the documented shape, or its cursor isn't a query
    """
    try:
        answer = _TransactionList.model_validate(_read_json(body))
    except ValidationError as error:
        raise _unreadable("a transaction list", error) from None

    # An entry that can't be read but says it is pending is one the sync drops anyway when pending
    # transactions aren't wanted, so it is no cause for a warning
    transactions, skipped = _read_each(
        answer.results,
        _WireTransaction,
        "a transaction list",
        is_unwanted=lambda entry: not include_pending and isinstance(entry, Mapping) and entry.get("status") == PENDING_STATUS,
    )

    currency = _currency_of(account)
    records = []
    for item in transactions:
        is_pending = item.status == PENDING_STATUS
        if is_pending and not include_pending:
            continue
        moment = _moment_of(item.date, timezone)
        if not start <= moment < end:
            continue

        # A transaction in another currency than its account's counts in the account's, when
        # Pluggy says how much that is. Without it, only the figure as sent can be kept
        is_foreign = item.currencyCode is not None and item.currencyCode != account.currencyCode
        read = _signed(item.amountInAccountCurrency if is_foreign else item.amount, account)
        shown = read if read is not None else _signed(item.amount, account)
        records.append(
            ProviderRecord(
                external_id=item.id,
                date=moment.astimezone(timezone).date(),
                amount=_minor_units(read, currency, exponent) if read is not None else None,
                raw_amount=_plain(shown),
                description=item.description or "",
                pending=is_pending,
            )
        )
    return TransactionPage(tuple(records), skipped, _read_cursor(answer.next, account))


def _read_cursor(cursor: str | None, account: WireAccount) -> str | None:
    """Read the position of the next page from the query string Pluggy sends for the same account

    Only the position is taken, since the account and the dates of every page are the ones the first was asked with

    Raises:
        UnreadableResponse: The cursor names another account, holds no position, or is more than a query string
    """
    if cursor is None:
        return None
    query = dict(parse_qsl(cursor[1:], keep_blank_values=True)) if cursor.startswith("?") else {}
    if query.get("accountId") != account.id or not query.get("after"):
        logger.warning("Pluggy's answer to a transaction list doesn't fit its documented shape at next (cursor)")
        raise UnreadableResponse
    return query["after"]


def external_account(
    account: WireAccount,
    item: WireItem,
    *,
    currency_exponents: Mapping[str, int],
    balance_at: dt.datetime,
    records: Sequence[ProviderRecord] = (),
) -> ExternalAccount:
    """Return an account in the contract's form

    Args:
        account: The account as Pluggy lists it
        item: The bank connection the account sits under
        currency_exponents: Minor-unit exponent of every currency Lumina Finance holds, by code
        balance_at: When the balance was read, used when Pluggy dates none
        records: The records a fetch brought back for it
    """
    currency = _currency_of(account)
    has_balance = item.is_readable
    connector = item.connector
    return ExternalAccount(
        external_id=account.id,
        name=account.name,
        # Without a connector, the item stands for its bank, so unrelated banks never group as one
        institution_key=str(connector.id) if connector else item.id,
        institution_name=(connector.name or str(connector.id)) if connector else _UNNAMED_INSTITUTION,
        login_key=item.id,
        currency=currency,
        currency_raw=account.currencyCode,
        balance=_minor_units(_signed(account.balance, account), currency, exponent_of(account, currency_exponents)) if has_balance else None,
        available_balance=None,
        balance_at=(item.lastUpdatedAt or balance_at) if has_balance else balance_at,
        records=tuple(records),
    )


def exponent_of(account: WireAccount, currency_exponents: Mapping[str, int]) -> int | None:
    """Return the minor-unit exponent of an account's currency, or None for a currency Lumina Finance doesn't hold"""
    currency = _currency_of(account)
    return currency_exponents.get(currency) if currency else None


def _currency_of(account: WireAccount) -> str | None:
    """Return the account's ISO 4217 code, or None for a currency that isn't one"""
    return account.currencyCode if is_iso_currency_code(account.currencyCode) else None


def _signed[T: Decimal | None](amount: T, account: WireAccount) -> T:
    """Return an amount in Lumina Finance's sign, a credit card's charges being negative where Pluggy sends them positive"""
    # copy_negate, since a minus sign rounds to the context's 28 digits and an amount may hold 30
    return amount.copy_negate() if account.is_card and amount else amount


def _moment_of(stamp: dt.datetime, timezone: ZoneInfo) -> dt.datetime:
    """Return when a transaction happened, reading a timestamp at exactly midnight UTC as the calendar day it names

    Pluggy gives a date with no time as midnight UTC, so that day is the transaction's in every timezone
    and it starts at midnight where the user is. Any other timestamp is an instant
    """
    instant = stamp if stamp.tzinfo is not None else stamp.replace(tzinfo=dt.UTC)
    in_utc = instant.astimezone(dt.UTC)
    if in_utc.time() == dt.time(0):
        return dt.datetime.combine(in_utc.date(), dt.time(0), tzinfo=timezone)
    return instant


def _plain(amount: Decimal) -> str:
    """Write an amount without an exponent, as it was sent"""
    return str(amount) if abs(amount.adjusted()) > _MAX_INTEGER_DIGITS else format(amount, "f")


def _minor_units(amount: Decimal, currency: str | None, exponent: int | None) -> int | None:
    """Return an amount in minor units, or None when it can't be stored exactly

    Extra trailing zeros are fine, but more significant decimals than the currency holds are never
    rounded away, and an amount in a currency Lumina Finance doesn't hold has no exponent to read it at
    """
    if currency is None or exponent is None or not amount.is_finite() or abs(amount.adjusted()) > _MAX_INTEGER_DIGITS:
        return None
    try:
        return parse_decimal_amount_to_minor_units(_plain(amount), currency_code=currency, minor_unit_exponent=exponent)
    except ValueError:
        return None
