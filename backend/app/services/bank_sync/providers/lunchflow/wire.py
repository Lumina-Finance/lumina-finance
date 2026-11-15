"""Reading Lunch Flow's Personal API responses into the provider contract

Amounts are JSON numbers, so a body is read with every decimal number as a Decimal and never passes
through a float, since a float could change the figure before it is stored
"""

import datetime as dt
import json
import logging
from collections.abc import Mapping
from dataclasses import dataclass
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.services.bank_sync.providers.contract import ExternalAccount, ProviderRecord, first_text, is_iso_currency_code
from app.utils.money import parse_decimal_amount_to_minor_units

# The one status that syncs. Lunch Flow documents no other value, so anything else is read as a
# connection that needs attention in Lunch Flow
ACTIVE_STATUS = "ACTIVE"

# Amounts with more digits than this before the decimal point are never a real balance, and writing
# one out in full could take far more memory than the response held
_MAX_INTEGER_DIGITS = 30

_UNNAMED_INSTITUTION = "Unnamed bank"

logger = logging.getLogger(__name__)


class UnreadableResponse(Exception):
    """The body isn't a response in the shape Lunch Flow documents"""


def _unreadable(answer: str, error: ValidationError) -> UnreadableResponse:
    """Log where an answer differs from the documented shape and return the failure to raise

    Only each field's place and the kind of mismatch are logged, never a value, since the answer
    holds the user's account names and amounts

    Args:
        answer: Which answer it was, such as "the account list"
        error: What the answer failed on
    """
    places = ", ".join(
        f"{'.'.join(str(part) for part in detail['loc'])} ({detail['type']})" for detail in error.errors(include_input=False)[:5]
    )
    logger.warning("Lunch Flow's answer to %s doesn't fit its documented shape at %s", answer, places)
    return UnreadableResponse()


class _Model(BaseModel):
    """Blind to fields sync doesn't need, so nothing else Lunch Flow sends is kept"""

    model_config = ConfigDict(extra="ignore", frozen=True, populate_by_name=True)


class WireAccount(_Model):
    """An account as Lunch Flow lists it"""

    id: int
    connection_id: int
    name: str | None = None
    institution_name: str | None = None

    # Lunch Flow's reference shows a currency here, but its live account list leaves it out, so the
    # balance answer's currency fills it in
    currency: str | None = None
    status: str


class _AccountList(_Model):
    accounts: list[WireAccount]


class _Money(_Model):
    amount: Decimal
    currency: str | None = None


class _BalanceAnswer(_Model):
    balance: _Money


class _WireTransaction(_Model):
    id: str | int | None = None
    amount: Decimal
    currency: str | None = None
    date: dt.date
    merchant: str | None = None
    description: str | None = None
    is_pending: bool = Field(default=False, alias="isPending")


class _TransactionList(_Model):
    transactions: list[_WireTransaction]

    # How many transactions Lunch Flow holds for the request, a count that can exceed the rows it sent
    total: int | None = None


@dataclass(frozen=True)
class Transactions:
    """The records Lunch Flow sent for one account, and what the response left out"""

    records: tuple[ProviderRecord, ...]

    # Transactions with an empty or missing id can't be told apart from one another
    skipped_without_id: int

    # Whether the response holds fewer transactions than Lunch Flow says it has
    is_cut_off: bool


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
        logger.warning("Lunch Flow answered with a body that isn't JSON")
        raise UnreadableResponse from None


def read_accounts(body: bytes) -> tuple[WireAccount, ...]:
    """Read the answer to GET /accounts

    Raises:
        UnreadableResponse: The body isn't the documented shape
    """
    try:
        return tuple(_AccountList.model_validate(_read_json(body)).accounts)
    except ValidationError as error:
        raise _unreadable("the account list", error) from None


def read_balance(body: bytes, account: WireAccount, *, currency_exponents: Mapping[str, int]) -> tuple[WireAccount, int | None]:
    """Read the answer to GET /accounts/{id}/balance into minor units

    Args:
        body: The response body
        account: The account the balance belongs to
        currency_exponents: The minor-unit exponent of each currency the app holds

    Returns:
        The account with the balance's currency when the account list sent none, and the balance, or
        None when it is in a currency other than the account's or can't be stored exactly

    Raises:
        UnreadableResponse: The body isn't the documented shape
    """
    try:
        balance = _BalanceAnswer.model_validate(_read_json(body)).balance
    except ValidationError as error:
        raise _unreadable("a balance", error) from None
    if account.currency is None and balance.currency is not None:
        account = account.model_copy(update={"currency": balance.currency})
    if balance.currency is not None and balance.currency != account.currency:
        return account, None
    return account, _minor_units(balance.amount, _currency_of(account), exponent_of(account, currency_exponents))


def read_transactions(body: bytes, account: WireAccount, *, exponent: int | None) -> Transactions:
    """Read the answer to GET /accounts/{id}/transactions

    Args:
        body: The response body
        account: The account the transactions belong to
        exponent: The minor-unit exponent of the account's currency, if the app holds it

    Raises:
        UnreadableResponse: The body isn't the documented shape
    """
    try:
        answer = _TransactionList.model_validate(_read_json(body))
    except ValidationError as error:
        raise _unreadable("a transaction list", error) from None

    currency = _currency_of(account)
    records = []
    skipped_without_id = 0
    for transaction in answer.transactions:
        external_id = str(transaction.id) if transaction.id is not None else ""
        if not external_id.strip():
            skipped_without_id += 1
            continue

        # An amount in another currency than the account's can't be added to its balance, and one in a
        # currency with no known exponent has no minor unit to be read at
        is_same_currency = transaction.currency is None or transaction.currency == account.currency
        records.append(
            ProviderRecord(
                external_id=external_id,
                date=transaction.date,
                amount=_minor_units(transaction.amount, currency, exponent) if is_same_currency else None,
                raw_amount=_plain(transaction.amount),
                description=(transaction.description or "").strip() or (transaction.merchant or "").strip(),
                # Lunch Flow's reference defines neither field, so each is read as its name says, and
                # neither stands in for the other
                note=first_text(transaction.description),
                merchant=first_text(transaction.merchant),
                pending=transaction.is_pending,
            )
        )
    return Transactions(
        tuple(records),
        skipped_without_id=skipped_without_id,
        is_cut_off=answer.total is not None and answer.total > len(answer.transactions),
    )


def external_account(
    account: WireAccount,
    *,
    balance: int | None,
    balance_at: dt.datetime,
    records: tuple[ProviderRecord, ...] = (),
) -> ExternalAccount:
    """Return an account in the contract's form

    Args:
        account: The account as Lunch Flow lists it
        balance: Its balance in minor units, or None when it wasn't read or can't be stored exactly
        balance_at: When the balance was read, since Lunch Flow dates none
        records: The records a fetch brought back for it
    """
    institution_name = account.institution_name or _UNNAMED_INSTITUTION
    return ExternalAccount(
        external_id=str(account.id),
        name=account.name or institution_name,
        institution_key=institution_name,
        institution_name=institution_name,
        login_key=str(account.connection_id),
        currency=_currency_of(account),
        currency_raw=account.currency,
        balance=balance,
        available_balance=None,
        balance_at=balance_at,
        records=records,
    )


def exponent_of(account: WireAccount, currency_exponents: Mapping[str, int]) -> int | None:
    """Return the minor-unit exponent of an account's currency, or None for a currency the app doesn't hold"""
    currency = _currency_of(account)
    return currency_exponents.get(currency) if currency else None


def _currency_of(account: WireAccount) -> str | None:
    """Return the account's ISO 4217 code, or None for a currency of Lunch Flow's own or none at all"""
    return account.currency if account.currency is not None and is_iso_currency_code(account.currency) else None


def _plain(amount: Decimal) -> str:
    """Write an amount without an exponent, as it was sent"""
    return str(amount) if abs(amount.adjusted()) > _MAX_INTEGER_DIGITS else format(amount, "f")


def _minor_units(amount: Decimal, currency: str | None, exponent: int | None) -> int | None:
    """Return an amount in minor units, or None when it can't be stored exactly

    Extra trailing zeros are fine, but more significant decimals than the currency holds are never
    rounded away, and an amount in a currency the app doesn't hold has no exponent to read it at
    """
    if currency is None or exponent is None or not amount.is_finite() or abs(amount.adjusted()) > _MAX_INTEGER_DIGITS:
        return None
    try:
        return parse_decimal_amount_to_minor_units(_plain(amount), currency_code=currency, minor_unit_exponent=exponent)
    except ValueError:
        return None
