"""Reading a SimpleFIN protocol version 2 account set into the provider contract"""

import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.services.bank_sync.providers.contract import ExternalAccount, ProviderRecord
from app.utils.money import parse_decimal_amount_to_minor_units

# SimpleFIN has no paging, and a response is reported to stop at 1,000 transactions, so one that
# reaches it may be missing some. Pending records count too, since nothing says the cap leaves them out
CUT_OFF_RECORD_COUNT = 1000

# Every published SimpleFIN sample stamps a bank date at noon UTC, and a bank that sends only a date
# may stamp it at midnight UTC, so a stamp at exactly either time keeps its UTC date rather than
# moving a day for users far from UTC. A real time of day lands on either second one time in
# 43,200. Unverified against real SimpleFIN Bridge data
_BANK_DATE_SECONDS_INTO_DAY = (0, 12 * 60 * 60)
_SECONDS_PER_DAY = 24 * 60 * 60

# An ISO 4217 code. A URL or nothing in its place is a custom currency
_ISO_CURRENCY_CODE = re.compile(r"[A-Z]{3}")


class UnreadableAccountSet(Exception):
    """The body isn't a SimpleFIN version 2 account set this reader can use"""


class _Model(BaseModel):
    """Strict about the types the protocol defines, and blind to fields it doesn't read"""

    model_config = ConfigDict(strict=True, extra="ignore", frozen=True)


class _Transaction(_Model):
    """A transaction as SimpleFIN sends it"""

    id: str
    posted: int
    amount: str
    description: str
    transacted_at: int | None = None
    pending: bool = False

    # SimpleFIN Bridge sends these, though the protocol doesn't define them
    payee: str | None = None
    memo: str | None = None
    extra: dict[str, Any] | None = None


class _Account(_Model):
    """An account as SimpleFIN sends it"""

    id: str
    name: str
    conn_id: str
    currency: str
    balance: str
    available_balance: str | None = Field(default=None, alias="available-balance")
    balance_date: int = Field(alias="balance-date")
    transactions: list[_Transaction] = []


class _Connection(_Model):
    """A bank login as SimpleFIN sends it"""

    conn_id: str
    name: str
    org_id: str


class AccountSet(_Model):
    """A SimpleFIN version 2 response to an accounts request"""

    connections: list[_Connection] = []
    accounts: list[_Account] = []


@dataclass(frozen=True)
class RecordDating:
    """How the records of one request get their calendar dates"""

    # The user's profile timezone
    timezone: ZoneInfo

    # The request's day in that timezone, for a pending record with no date of its own
    requested_on: date


def read_account_set(body: bytes) -> AccountSet:
    """Parse a response body as an account set

    Args:
        body: The response body

    Returns:
        The account set

    Raises:
        UnreadableAccountSet: The body isn't JSON in the version 2 shape
    """
    try:
        return AccountSet.model_validate_json(body)
    except ValidationError:
        raise UnreadableAccountSet from None


def is_possibly_cut_off(account_set: AccountSet) -> bool:
    """Return whether the response holds as many transactions as SimpleFIN is reported to send"""
    return sum(len(account.transactions) for account in account_set.accounts) >= CUT_OFF_RECORD_COUNT


def read_external_accounts(
    account_set: AccountSet,
    *,
    currency_exponents: Mapping[str, int],
    dating: RecordDating | None,
) -> tuple[ExternalAccount, ...]:
    """Normalize every account in an account set

    Args:
        account_set: The parsed response
        currency_exponents: Minor-unit exponent of every currency Lumina holds, by code
        dating: How records are dated, or None for a balances-only read, whose records aren't read

    Returns:
        The accounts, each with its records when dating is given

    Raises:
        UnreadableAccountSet: An account names a bank login the response doesn't list, or a
            timestamp is out of range
    """
    connections = {connection.conn_id: connection for connection in account_set.connections}
    try:
        return tuple(
            _read_account(account, connections, currency_exponents=currency_exponents, dating=dating) for account in account_set.accounts
        )

    # A timestamp past what a datetime holds fails one of three ways depending on its size
    except KeyError, ValueError, OverflowError, OSError:
        raise UnreadableAccountSet from None


def _read_account(
    account: _Account,
    connections: Mapping[str, _Connection],
    *,
    currency_exponents: Mapping[str, int],
    dating: RecordDating | None,
) -> ExternalAccount:
    """Normalize one account and, when dated, its records"""
    connection = connections[account.conn_id]
    currency = account.currency if _ISO_CURRENCY_CODE.fullmatch(account.currency) else None
    exponent = currency_exponents.get(currency) if currency else None

    return ExternalAccount(
        external_id=account.id,
        name=account.name,
        institution_key=connection.org_id,
        institution_name=connection.name,
        login_key=connection.conn_id,
        currency=currency,
        currency_raw=account.currency,
        balance=_minor_units(account.balance, currency, exponent),
        available_balance=_minor_units(account.available_balance, currency, exponent),
        balance_at=datetime.fromtimestamp(account.balance_date, UTC),
        records=tuple(_read_record(transaction, currency, exponent, dating) for transaction in account.transactions) if dating else (),
    )


def _read_record(
    transaction: _Transaction,
    currency: str | None,
    exponent: int | None,
    dating: RecordDating,
) -> ProviderRecord:
    """Normalize one transaction"""
    pending = transaction.pending or transaction.posted == 0
    if not pending:
        record_date = _date_of(transaction.posted, dating.timezone)
    elif transaction.transacted_at:
        record_date = _date_of(transaction.transacted_at, dating.timezone)
    else:
        record_date = dating.requested_on

    extras = {"transacted_at": transaction.transacted_at, "memo": transaction.memo, "extra": transaction.extra}
    return ProviderRecord(
        external_id=transaction.id,
        date=record_date,
        amount=_minor_units(transaction.amount, currency, exponent),
        raw_amount=transaction.amount,
        description=transaction.description,
        merchant_name=(transaction.payee or "").strip() or None,
        category_hint=None,
        extras={key: value for key, value in extras.items() if value is not None},
        pending=pending,
    )


def _date_of(stamp: int, timezone: ZoneInfo) -> date:
    """Return the calendar date a SimpleFIN timestamp stands for"""
    moment = datetime.fromtimestamp(stamp, UTC)
    if stamp % _SECONDS_PER_DAY in _BANK_DATE_SECONDS_INTO_DAY:
        return moment.date()
    return moment.astimezone(timezone).date()


def _minor_units(amount: str | None, currency: str | None, exponent: int | None) -> int | None:
    """Return an amount in minor units, or None when it can't be stored exactly

    Extra trailing zeros are fine, but more significant decimals than the currency holds are never
    rounded away, and an amount in a currency Lumina doesn't hold has no exponent to read it at
    """
    if amount is None or currency is None or exponent is None:
        return None
    try:
        return parse_decimal_amount_to_minor_units(amount, currency_code=currency, minor_unit_exponent=exponent)
    except ValueError:
        return None
