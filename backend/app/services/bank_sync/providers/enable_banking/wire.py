"""Reading Enable Banking's API responses into the provider contract

A body is read with every decimal number as a Decimal and never passes through a float, since a float
could change a figure before it is stored. Amounts come as strings, which pydantic reads exactly. Only
the fields sync needs are read, so an IBAN, a creditor's account or any other detail the bank passes
along is dropped as the body is read

A field is required only where Enable Banking's reference marks it required. A bank, account, balance
or transaction that doesn't fit its documented shape is skipped with a warning that counts it, so one
odd item never fails the rest of the answer
"""

import datetime as dt
import hashlib
import json
import logging
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, ValidationError

from app.services.bank_sync.providers.contract import ExternalAccount, ProviderRecord, first_text, is_iso_currency_code
from app.utils.money import parse_decimal_amount_to_minor_units

# The balance types that say what the bank holds on the books, in the order they are preferred, and
# those that say what can be spent. The interim booked balance is as of now, where the closing one is
# as of the end of an earlier day
BOOKED_BALANCE_TYPES = ("ITBD", "CLBD", "OPBD", "XPCD", "PRCD")
AVAILABLE_BALANCE_TYPES = ("ITAV", "CLAV", "OPAV", "FWAV")

BOOKED_STATUS = "BOOK"
PENDING_STATUSES = frozenset({"PDNG", "HOLD"})
DEBIT = "DBIT"

# Amounts with more digits than this before the decimal point are never a real balance, and writing
# one out in full could take far more memory than the response held
_MAX_INTEGER_DIGITS = 30

# The most mismatches one log line names
_MAX_PLACES = 5

logger = logging.getLogger(__name__)


class UnreadableResponse(Exception):
    """The body isn't a response in the shape Enable Banking documents"""


def _places(error: ValidationError, prefix: str = "") -> list[str]:
    """Return each mismatch's field place and kind, never the value sent

    Args:
        error: What the answer failed on
        prefix: The place of the item the error is about, such as "accounts.2."
    """
    return [f"{prefix}{'.'.join(str(part) for part in detail['loc'])} ({detail['type']})" for detail in error.errors(include_input=False)]


def _unreadable(answer: str, error: ValidationError) -> UnreadableResponse:
    """Log where an answer differs from the documented shape and return the failure to raise

    Only each field's place and the kind of mismatch are logged, never a value, since the answer
    holds the user's account names and amounts

    Args:
        answer: Which answer it was, such as "the bank list"
        error: What the answer failed on
    """
    logger.warning("Enable Banking's answer to %s doesn't fit its documented shape at %s", answer, ", ".join(_places(error)[:_MAX_PLACES]))
    return UnreadableResponse()


def _read_each[M: BaseModel](model: type[M], items: Sequence[Any], *, field: str, answer: str) -> tuple[list[M], int]:
    """Read each item of a list in an answer, skipping one that doesn't fit its documented shape

    Args:
        model: The shape each item is read into
        items: The items as sent
        field: The list's field in the answer, which the logged places start with
        answer: Which answer it was, such as "a transaction list"

    Returns:
        The items read, and how many were skipped
    """
    read: list[M] = []
    places: list[str] = []
    for index, item in enumerate(items):
        try:
            read.append(model.model_validate(item))
        except ValidationError as error:
            places.extend(_places(error, f"{field}.{index}."))
    skipped = len(items) - len(read)
    if skipped:
        logger.warning(
            "Skipped %d of %d items in Enable Banking's answer to %s that don't fit its documented shape, at %s",
            skipped,
            len(items),
            answer,
            ", ".join(places[:_MAX_PLACES]),
        )
    return read, skipped


class _Model(BaseModel):
    """Blind to fields sync doesn't need, so nothing else Enable Banking sends is kept"""

    model_config = ConfigDict(extra="ignore", frozen=True, populate_by_name=True)


class _Amount(_Model):
    amount: Decimal
    currency: str


class WireAspsp(_Model):
    """A bank as Enable Banking lists it"""

    name: str
    country: str
    maximum_consent_validity: int | None = None


class _AspspList(_Model):
    aspsps: list[Any]


class _Auth(_Model):
    url: str


class WireAccount(_Model):
    """An account a session reaches, as the session lists it

    Enable Banking's `name` is the account holder's name, so it is never kept. The account's own label is
    `details`, the description the user or the bank gave it, or else `product`, the bank's name for the product
    """

    uid: str
    identification_hash: str
    details: str | None = None
    product: str | None = None
    currency: str | None = None
    cash_account_type: str | None = None


class _ListedAccount(WireAccount):
    # Enable Banking leaves the uid out of an account it knows can't be read, such as one blocked or closed
    uid: str | None = None  # type: ignore[assignment]


class _SessionAspsp(_Model):
    name: str
    country: str


class _SessionAnswer(_Model):
    session_id: str
    accounts: list[Any]
    aspsp: _SessionAspsp | None = None


class WireSession(_Model):
    """What a new session holds: its ID, the bank and the accounts it reaches that can be read"""

    session_id: str
    accounts: list[WireAccount]
    aspsp: _SessionAspsp | None = None


class _Balance(_Model):
    balance_amount: _Amount
    balance_type: str
    last_change_date_time: dt.datetime | None = None

    # The day a closing or opening balance is for
    reference_date: dt.date | None = None

    @property
    def dated(self) -> dt.datetime | None:
        """When the balance was true: when it last changed, else noon UTC of the day it is for

        Noon keeps the day for every user from UTC-12 to UTC+11, which holds the people of the European banks
        Enable Banking reaches, where midnight would put it on the day before for anyone west of UTC
        """
        if self.last_change_date_time:
            return self.last_change_date_time
        if self.reference_date:
            return dt.datetime.combine(self.reference_date, dt.time(12), tzinfo=dt.UTC)
        return None


class _BalanceList(_Model):
    balances: list[Any]


class _Party(_Model):
    name: str | None = None


class _WireTransaction(_Model):
    entry_reference: str | None = None
    transaction_id: str | None = None
    transaction_amount: _Amount
    credit_debit_indicator: str
    status: str
    booking_date: dt.date | None = None
    value_date: dt.date | None = None
    transaction_date: dt.date | None = None
    remittance_information: list[str] | None = None
    creditor: _Party | None = None
    debtor: _Party | None = None
    note: str | None = None


class _TransactionList(_Model):
    transactions: list[Any]
    continuation_key: str | None = None


@dataclass(frozen=True)
class Balances:
    """The balances of one account in minor units, with when they last changed"""

    booked: Decimal | None
    available: Decimal | None
    changed_at: dt.datetime | None


@dataclass(frozen=True)
class TransactionPage:
    """One page of an account's transactions, and the key of the next one"""

    records: tuple[ProviderRecord, ...]

    # None on the last page
    continuation_key: str | None

    # Transactions skipped because they don't fit the documented shape
    skipped: int = 0


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
        logger.warning("Enable Banking answered with a body that isn't JSON")
        raise UnreadableResponse from None


def read_aspsps(body: bytes) -> list[WireAspsp]:
    """Read the answer to GET /aspsps, skipping a bank that doesn't fit the documented shape

    Raises:
        UnreadableResponse: The body isn't the documented shape
    """
    try:
        listed = _AspspList.model_validate(_read_json(body)).aspsps
    except ValidationError as error:
        raise _unreadable("the bank list", error) from None
    return _read_each(WireAspsp, listed, field="aspsps", answer="the bank list")[0]


def read_auth_url(body: bytes) -> str:
    """Read the answer to POST /auth: the bank's address to send the user to

    Raises:
        UnreadableResponse: The body isn't the documented shape, or the address is blank
    """
    try:
        url = _Auth.model_validate(_read_json(body)).url
    except ValidationError as error:
        raise _unreadable("a sign-in", error) from None
    if not url.strip():
        logger.warning("Enable Banking's answer to a sign-in has a blank url")
        raise UnreadableResponse
    return url


def read_session(body: bytes) -> WireSession:
    """Read the answer to POST /sessions, leaving out each account Enable Banking gives no uid

    An account that doesn't fit the documented shape is left out too, with a warning that counts it

    Raises:
        UnreadableResponse: The body isn't the documented shape, or the session has no ID
    """
    try:
        answer = _SessionAnswer.model_validate(_read_json(body))
    except ValidationError as error:
        raise _unreadable("a new session", error) from None
    if not answer.session_id.strip():
        logger.warning("Enable Banking's answer to a new session has a blank session_id")
        raise UnreadableResponse
    listed, _ = _read_each(_ListedAccount, answer.accounts, field="accounts", answer="a new session")
    readable = [WireAccount.model_validate(account.model_dump()) for account in listed if account.uid and account.uid.strip()]
    return WireSession(session_id=answer.session_id, accounts=readable, aspsp=answer.aspsp)


def read_balances(body: bytes) -> Balances:
    """Read the answer to GET /accounts/{uid}/balances, choosing the booked and the available balance

    A balance that doesn't fit the documented shape is skipped, so the others still give the account its figures

    Raises:
        UnreadableResponse: The body isn't the documented shape
    """
    try:
        answer = _BalanceList.model_validate(_read_json(body))
    except ValidationError as error:
        raise _unreadable("a balance list", error) from None
    listed, _ = _read_each(_Balance, answer.balances, field="balances", answer="a balance list")
    by_type = {balance.balance_type: balance for balance in reversed(listed)}
    booked = next((by_type[kind] for kind in BOOKED_BALANCE_TYPES if kind in by_type), None)
    available = next((by_type[kind] for kind in AVAILABLE_BALANCE_TYPES if kind in by_type), None)

    # Dated by the booked balance's own date, since the available one may have changed since. A balance
    # the bank gave no date is left for the caller to date by when it was read
    dated = booked or available
    return Balances(
        booked=booked.balance_amount.amount if booked else None,
        available=available.balance_amount.amount if available else None,
        changed_at=dated.dated if dated else None,
    )


def read_transaction_page(
    body: bytes,
    *,
    currency: str | None,
    currency_raw: str,
    exponent: int | None,
    timezone: ZoneInfo,
    first_day: dt.date,
    last_day: dt.date,
    include_pending: bool,
    repeats: Counter[str],
    today: dt.date,
) -> TransactionPage:
    """Read the answer to GET /accounts/{uid}/transactions

    Args:
        body: The response body
        currency: The account's ISO 4217 code, or None for a currency that isn't one
        currency_raw: The account's currency as sent
        exponent: The minor-unit exponent of the account's currency, if Lumina Finance holds it
        timezone: The user's timezone, used to date a record the bank gave no date
        first_day: First day of the window, inclusive. Enable Banking is asked for a day more on each
            side, so what lies outside the window is left out here
        last_day: Last day of the window, inclusive
        include_pending: Whether pending and held transactions are kept
        repeats: How often each fingerprint was met so far in this read, shared across its pages, so
            two identical transactions the bank gave no ID keep different IDs
        today: The day a pending record the bank gave no date counts for

    Returns:
        The page's records, with how many transactions were skipped for not fitting the documented
        shape. A blank continuation key reads as the last page, as a missing or null one does

    Raises:
        UnreadableResponse: The body isn't the documented shape
    """
    try:
        answer = _TransactionList.model_validate(_read_json(body))
    except ValidationError as error:
        raise _unreadable("a transaction list", error) from None
    listed, skipped = _read_each(_WireTransaction, answer.transactions, field="transactions", answer="a transaction list")

    records = []
    for item in listed:
        is_pending = item.status in PENDING_STATUSES
        if not (item.status == BOOKED_STATUS or (is_pending and include_pending)):
            continue
        day = item.booking_date or item.value_date or item.transaction_date or (today if is_pending else None)
        if day is None or not first_day <= day <= last_day:
            continue

        amount = item.transaction_amount.amount
        # The indicator gives the direction, so a minus sign on a debit's amount can't turn it into a credit
        signed = amount.copy_abs().copy_negate() if item.credit_debit_indicator == DEBIT and amount else amount
        description = _describe(item)

        # A transaction in another currency than its account's can't be read at the account's exponent
        same_currency = item.transaction_amount.currency == currency_raw
        records.append(
            ProviderRecord(
                # transaction_id may change each time the list is read, so it would import a transaction again
                external_id=item.entry_reference or _derived_id(day, signed, description, item.status, repeats),
                date=day,
                amount=_minor_units(signed, currency, exponent) if same_currency else None,
                raw_amount=_plain(signed),
                description=description,
                # The payment's message, else the bank's note on it. The schema has no merchant field, so
                # the merchant is the other party, the one paid or paying
                note=first_text(_remittance(item), item.note),
                merchant=_other_party(item),
                pending=is_pending,
            )
        )
    continuation_key = answer.continuation_key if answer.continuation_key and answer.continuation_key.strip() else None
    return TransactionPage(tuple(records), continuation_key, skipped)


def _remittance(item: _WireTransaction) -> str:
    """Return the payment's remittance text, its lines joined, empty when it has none"""
    return " ".join(part.strip() for part in item.remittance_information or [] if part.strip())


def _describe(item: _WireTransaction) -> str:
    """Return what the bank says the transaction was: its remittance text, else the other party, else its note"""
    remittance = _remittance(item)
    if remittance:
        return remittance
    other = _other_party(item)
    if other:
        return other.strip()
    return (item.note or "").strip()


def _label(value: str | None) -> str | None:
    """Return a label with its spaces trimmed, or None when nothing is left"""
    return value.strip() if value and value.strip() else None


def _other_party(item: _WireTransaction) -> str | None:
    """Return the name of the party the money went to on a debit, or came from on a credit, as sent"""
    other = item.creditor if item.credit_debit_indicator == DEBIT else item.debtor
    return first_text(other.name) if other else None


def _derived_id(day: dt.date, signed: Decimal, description: str, status: str, repeats: Counter[str]) -> str:
    """Return an ID for a transaction the bank gave none, from its fields and how often they repeat

    A booked record and its earlier pending one differ in status, so they never share an ID
    """
    fingerprint = hashlib.sha256(f"{day.isoformat()}|{_plain(signed)}|{description}|{status}".encode()).hexdigest()
    repeats[fingerprint] += 1
    return f"{fingerprint[:32]}-{repeats[fingerprint]}"


def external_account(
    account: WireAccount,
    *,
    institution_key: str,
    institution_name: str,
    balances: Balances | None,
    currency_exponents: Mapping[str, int],
    balance_at: dt.datetime,
    records: Sequence[ProviderRecord] = (),
) -> ExternalAccount:
    """Return an account in the contract's form

    Args:
        account: The account as the session lists it
        institution_key: Identifies the bank
        institution_name: The bank's name
        balances: The account's balances, or None when none were read
        currency_exponents: Minor-unit exponent of every currency Lumina Finance holds, by code
        balance_at: When the balances were read, used when the bank dates none
        records: The records a fetch brought back for it
    """
    currency_raw = account.currency or ""
    currency = currency_raw if is_iso_currency_code(currency_raw) else None
    exponent = currency_exponents.get(currency) if currency else None
    booked = _minor_units(balances.booked, currency, exponent) if balances and balances.booked is not None else None
    available_sent = balances is not None and balances.available is not None
    available = _minor_units(balances.available, currency, exponent) if balances and balances.available is not None else None
    return ExternalAccount(
        external_id=account.identification_hash,
        name=_label(account.details) or _label(account.product) or "Account",
        institution_key=institution_key,
        institution_name=institution_name,
        login_key=None,
        currency=currency,
        currency_raw=currency_raw,
        balance=booked,
        available_balance=available,
        available_balance_unreadable=available_sent and available is None,
        balance_at=(balances.changed_at if balances and balances.changed_at else balance_at),
        records=tuple(records),
    )


def exponent_of(account: WireAccount, currency_exponents: Mapping[str, int]) -> int | None:
    """Return the minor-unit exponent of an account's currency, or None for a currency Lumina Finance doesn't hold"""
    currency = account.currency if account.currency and is_iso_currency_code(account.currency) else None
    return currency_exponents.get(currency) if currency else None


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
