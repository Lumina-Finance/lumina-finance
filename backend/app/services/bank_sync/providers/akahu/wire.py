"""Reading Akahu's API responses into the provider contract

Amounts are JSON numbers, so a body is read with every decimal number as a Decimal and never passes
through a float, since a float could change the figure before it is stored. Only the fields sync needs are
read, so an account holder, an address, an account number, a merchant or any other detail Akahu
sends is dropped as the body is read
"""

import datetime as dt
import hashlib
import json
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.services.bank_sync.providers.contract import ExternalAccount, ProviderRecord, is_iso_currency_code
from app.utils.money import parse_decimal_amount_to_minor_units

# The one status that syncs. Akahu documents ACTIVE and INACTIVE, and an inactive account has lost
# its bank access until the user reconnects it in Akahu
ACTIVE_STATUS = "ACTIVE"

# The attribute an account carries when Akahu holds its transactions
TRANSACTIONS_ATTRIBUTE = "TRANSACTIONS"

# Amounts with more digits than this before the decimal point are never a real balance, and writing
# one out in full could take far more memory than the response held
_MAX_INTEGER_DIGITS = 30


class UnreadableResponse(Exception):
    """The body isn't a response in the shape Akahu documents"""


class _Model(BaseModel):
    """Blind to fields sync doesn't need, so nothing else Akahu sends is kept"""

    model_config = ConfigDict(extra="ignore", frozen=True, populate_by_name=True)


class _Answer(_Model):
    """What every response carries"""

    success: bool = True


class _Connection(_Model):
    id: str = Field(alias="_id")
    name: str


class _Balance(_Model):
    current: Decimal
    available: Decimal | None = None
    currency: str


class _Refreshed(_Model):
    balance: dt.datetime | None = None


class WireAccount(_Model):
    """An account as Akahu lists it"""

    id: str = Field(alias="_id")
    connection: _Connection
    name: str
    status: str
    attributes: tuple[str, ...] = ()

    # Akahu's reference doesn't require it, and it is the only source of the account's currency
    balance: _Balance | None = None
    refreshed: _Refreshed = _Refreshed()

    @property
    def has_currency(self) -> bool:
        """Whether Akahu listed a balance, which is the only place it gives the account's currency"""
        return self.balance is not None


class _AccountList(_Answer):
    items: list[WireAccount]


class _WireTransaction(_Model):
    id: str = Field(alias="_id")
    date: dt.datetime
    description: str = ""
    amount: Decimal


class _Cursor(_Model):
    next: str | None = None


class _TransactionList(_Answer):
    items: list[_WireTransaction]

    # Akahu's reference doesn't say whether the cursor can be null or left out, and either means the last page
    cursor: _Cursor | None = None


class _WirePending(_Model):
    """A pending transaction, none of whose fields Akahu's reference requires"""

    account: str | None = Field(default=None, alias="_account")
    date: dt.datetime | None = None
    description: str = ""
    amount: Decimal | None = None


class _PendingList(_Answer):
    items: list[_WirePending]


@dataclass(frozen=True)
class TransactionPage:
    """One page of an account's transactions, and where the next one is"""

    records: tuple[ProviderRecord, ...]

    # None on the last page
    next_cursor: str | None


@dataclass(frozen=True)
class PendingTransactions:
    """The pending records read for each account, and how many items the answer left unusable"""

    records: dict[str, tuple[ProviderRecord, ...]]

    # Items missing their date, amount or account, which can't be placed on an account or stored
    skipped_incomplete: int


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
        raise UnreadableResponse from None


def read_me(body: bytes) -> None:
    """Check the answer to GET /me is Akahu's success answer

    Raises:
        UnreadableResponse: The body isn't one
    """
    try:
        answer = _Answer.model_validate(_read_json(body))
    except ValidationError:
        raise UnreadableResponse from None
    if not answer.success:
        raise UnreadableResponse


def read_accounts(body: bytes) -> tuple[WireAccount, ...]:
    """Read the answer to GET /accounts

    Raises:
        UnreadableResponse: The body isn't the documented shape
    """
    try:
        answer = _AccountList.model_validate(_read_json(body))
    except ValidationError:
        raise UnreadableResponse from None
    if not answer.success:
        raise UnreadableResponse
    return tuple(answer.items)


def read_transaction_page(body: bytes, account: WireAccount, *, exponent: int | None, timezone: ZoneInfo) -> TransactionPage:
    """Read the answer to GET /accounts/{id}/transactions

    Args:
        body: The response body
        account: The account the transactions belong to
        exponent: The minor-unit exponent of the account's currency, if Lumina Finance holds it
        timezone: The user's timezone, used to date each transaction

    Raises:
        UnreadableResponse: The body isn't the documented shape
    """
    try:
        answer = _TransactionList.model_validate(_read_json(body))
    except ValidationError:
        raise UnreadableResponse from None
    if not answer.success:
        raise UnreadableResponse

    currency = _currency_of(account)
    records = tuple(
        ProviderRecord(
            external_id=item.id,
            date=_date_of(item.date, timezone),
            amount=_minor_units(item.amount, currency, exponent),
            raw_amount=_plain(item.amount),
            description=item.description,
            pending=False,
        )
        for item in answer.items
    )
    return TransactionPage(records, answer.cursor.next if answer.cursor is not None else None)


def read_pending(
    body: bytes, accounts: Mapping[str, WireAccount], *, currency_exponents: Mapping[str, int], timezone: ZoneInfo
) -> PendingTransactions:
    """Read the answer to GET /transactions/pending into pending records, by the id of the account each belongs to

    An item missing its date, amount or account is left out and counted, since Akahu requires none of them

    Akahu gives a pending transaction no id, so each is given one worked out from its account, date,
    amount and description, and its place among identical ones. It holds only within this answer.
    That is all the sync needs, since it replaces an account's pending items wholesale each time

    Args:
        body: The response body
        accounts: The accounts being fetched, by id. Pending transactions of any other account are dropped
        currency_exponents: Minor-unit exponent of every currency Lumina Finance holds, by code
        timezone: The user's timezone, used to date each transaction

    Raises:
        UnreadableResponse: The body isn't the documented shape
    """
    try:
        answer = _PendingList.model_validate(_read_json(body))
    except ValidationError:
        raise UnreadableResponse from None
    if not answer.success:
        raise UnreadableResponse

    seen: Counter[str] = Counter()
    records: dict[str, list[ProviderRecord]] = {account_id: [] for account_id in accounts}
    skipped_incomplete = 0
    for item in answer.items:
        # An item that names another account isn't this fetch's, however complete it is
        if item.account is not None and item.account not in accounts:
            continue
        if item.account is None or item.date is None or item.amount is None:
            skipped_incomplete += 1
            continue
        account = accounts[item.account]
        identity = f"{item.account}|{item.date.astimezone(dt.UTC).isoformat()}|{_plain(item.amount)}|{item.description}"
        place = seen[identity]
        seen[identity] += 1
        records[item.account].append(
            ProviderRecord(
                external_id=f"pending-{hashlib.sha256(identity.encode()).hexdigest()[:32]}-{place}",
                date=_date_of(item.date, timezone),
                amount=_minor_units(item.amount, _currency_of(account), exponent_of(account, currency_exponents)),
                raw_amount=_plain(item.amount),
                description=item.description,
                pending=True,
            )
        )
    return PendingTransactions({account_id: tuple(found) for account_id, found in records.items()}, skipped_incomplete)


def external_account(
    account: WireAccount,
    *,
    currency_exponents: Mapping[str, int],
    balance_at: dt.datetime,
    records: Sequence[ProviderRecord] = (),
    has_balance: bool = True,
) -> ExternalAccount:
    """Return an account in the contract's form

    Args:
        account: The account as Akahu lists it
        currency_exponents: Minor-unit exponent of every currency Lumina Finance holds, by code
        balance_at: When the balance was read, used when Akahu dates none
        records: The records a fetch brought back for it
        has_balance: False for an account that needs reconnecting, as its balance is out of date
    """
    listed = account.balance
    if listed is None:
        raise ValueError("An account Akahu lists without a balance has no currency to be stored with")
    currency = _currency_of(account)
    exponent = exponent_of(account, currency_exponents)
    available = _minor_units(listed.available, currency, exponent) if listed.available is not None else None
    return ExternalAccount(
        external_id=account.id,
        name=account.name,
        institution_key=account.connection.id,
        institution_name=account.connection.name,
        login_key=account.connection.id,
        currency=currency,
        currency_raw=listed.currency,
        balance=_minor_units(listed.current, currency, exponent) if has_balance else None,
        available_balance=available if has_balance else None,
        available_balance_unreadable=has_balance and listed.available is not None and available is None,
        balance_at=(account.refreshed.balance or balance_at) if has_balance else balance_at,
        records=tuple(records),
    )


def exponent_of(account: WireAccount, currency_exponents: Mapping[str, int]) -> int | None:
    """Return the minor-unit exponent of an account's currency, or None for a currency Lumina Finance doesn't hold"""
    currency = _currency_of(account)
    return currency_exponents.get(currency) if currency else None


def _currency_of(account: WireAccount) -> str | None:
    """Return the account's ISO 4217 code, or None for a currency that isn't one or an account listed without a balance"""
    return account.balance.currency if account.balance is not None and is_iso_currency_code(account.balance.currency) else None


def _date_of(moment: dt.datetime, timezone: ZoneInfo) -> dt.date:
    """Return the day a UTC timestamp falls on for the user, a timestamp without an offset being read as UTC"""
    return (moment if moment.tzinfo is not None else moment.replace(tzinfo=dt.UTC)).astimezone(timezone).date()


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
