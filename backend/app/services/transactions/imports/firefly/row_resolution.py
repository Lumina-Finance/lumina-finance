"""Firefly III journal row to Lumina transaction leg resolution"""

import uuid
from dataclasses import dataclass
from datetime import date

from app.models.account import Account
from app.models.category import Category
from app.models.currency import Currency
from app.schemas.data_imports import FireflyTransactionRow
from app.services.transactions.imports.firefly.constants import (
    FIREFLY_NO_CATEGORY_SOURCE,
    FIREFLY_TRACKED_ACCOUNT_TYPES,
    FIREFLY_TYPE_DEPOSIT,
    FIREFLY_TYPE_OPENING_BALANCE,
    FIREFLY_TYPE_RECONCILIATION,
    FIREFLY_TYPE_TRANSFER,
    FIREFLY_TYPE_WITHDRAWAL,
)
from app.services.transactions.imports.shared.row_mappings import (
    get_import_row_account,
    get_import_row_category,
    validate_import_category_can_be_used_for_account,
)
from app.utils.money import (
    DecimalAmountParseError,
    DecimalAmountPrecisionError,
    parse_decimal_amount_to_minor_units,
)


class FireflyRowSkipError(Exception):
    """Raised when a Firefly III row cannot be converted into Lumina legs"""

    def __init__(self, reason: str) -> None:
        """Store the client-facing skip reason

        Args:
            reason: Why the row cannot be converted
        """
        super().__init__(reason)
        self.reason = reason


@dataclass
class FireflyResolutionContext:
    """Store lookups needed to resolve Firefly III rows into transaction legs

    Attributes:
        user_id: Identifier for the user running the import
        accounts_by_source: Account rows keyed by Firefly III account name
        categories_by_source: Category rows keyed by Firefly III category name
        currencies_by_code: Currency rows keyed by currency code
        transfer_category: System category applied to two-leg transfers
        balance_adjustment_category: System category applied to opening balances
    """

    user_id: uuid.UUID
    accounts_by_source: dict[str, Account]
    categories_by_source: dict[str, Category]
    currencies_by_code: dict[str, Currency]
    transfer_category: Category
    balance_adjustment_category: Category


@dataclass
class FireflyLeg:
    """One Lumina transaction produced from a Firefly III journal row

    Attributes:
        account: Account the transaction is written to
        dt: Transaction date
        amount: Signed amount in account-currency minor units
        category: Category applied to the transaction
        merchant_name: Optional counterparty recorded as a merchant
        notes: Optional combined description and notes text
        tag_names: Tag names applied to the transaction
    """

    account: Account
    dt: date
    amount: int
    category: Category
    merchant_name: str | None
    notes: str | None
    tag_names: list[str]


def resolve_firefly_row(row: FireflyTransactionRow, context: FireflyResolutionContext) -> list[FireflyLeg]:
    """Resolve one Firefly III journal row into Lumina transaction legs

    Args:
        row: Firefly III journal row from the import payload
        context: Lookups needed to resolve the row

    Returns:
        Transaction legs the row produces

    Raises:
        FireflyRowSkipError: Raised when the row cannot be converted
        HTTPException: Raised with 422 when a tracked account or category is not mapped
    """
    journal_type = row.type.strip().lower()
    source_account = _get_tracked_account(row.source_name, row.source_type, context)
    destination_account = _get_tracked_account(row.destination_name, row.destination_type, context)
    notes = _build_leg_notes(row)

    if journal_type in (FIREFLY_TYPE_OPENING_BALANCE, FIREFLY_TYPE_RECONCILIATION):
        return _resolve_balance_row(row, source_account, destination_account, notes, context)

    # A journal between two imported accounts is a transfer in Lumina no
    # matter the Firefly type, which covers loan payments recorded as
    # withdrawals into a liability account
    if source_account is not None and destination_account is not None:
        return _resolve_transfer_pair(row, source_account, destination_account, notes, context)

    if journal_type == FIREFLY_TYPE_WITHDRAWAL:
        if source_account is None:
            raise FireflyRowSkipError("Withdrawal source is not an imported account")
        category = _resolve_row_category(row, source_account, context)
        return [FireflyLeg(
            account=source_account,
            dt=row.dt,
            amount=-_get_amount_in_account_currency(row, source_account, context),
            category=category,
            merchant_name=_clean_name(row.destination_name),
            notes=notes,
            tag_names=row.tag_names,
        )]

    if journal_type == FIREFLY_TYPE_DEPOSIT:
        if destination_account is None:
            raise FireflyRowSkipError("Deposit destination is not an imported account")
        category = _resolve_row_category(row, destination_account, context)
        return [FireflyLeg(
            account=destination_account,
            dt=row.dt,
            amount=_get_amount_in_account_currency(row, destination_account, context),
            category=category,
            merchant_name=_clean_name(row.source_name),
            notes=notes,
            tag_names=row.tag_names,
        )]

    if journal_type == FIREFLY_TYPE_TRANSFER:
        raise FireflyRowSkipError("Transfer endpoint is not an imported account")

    raise FireflyRowSkipError(
        f'Journal type "{row.type.strip()}" is not supported, the importer handles'
        " withdrawals, deposits, transfers, opening balances, and reconciliations",
    )


def _resolve_transfer_pair(
    row: FireflyTransactionRow,
    source_account: Account,
    destination_account: Account,
    notes: str | None,
    context: FireflyResolutionContext,
) -> list[FireflyLeg]:
    """Resolve a row between two imported accounts into transfer legs

    Args:
        row: Firefly III journal row from the import payload
        source_account: Imported account money leaves
        destination_account: Imported account money enters
        notes: Combined description and notes text
        context: Lookups needed to resolve the row

    Returns:
        Outgoing and incoming transfer legs
    """
    return [
        FireflyLeg(
            account=source_account,
            dt=row.dt,
            amount=-_get_amount_in_account_currency(row, source_account, context),
            category=context.transfer_category,
            merchant_name=None,
            notes=notes,
            tag_names=row.tag_names,
        ),
        FireflyLeg(
            account=destination_account,
            dt=row.dt,
            amount=_get_amount_in_account_currency(row, destination_account, context),
            category=context.transfer_category,
            merchant_name=None,
            notes=notes,
            tag_names=row.tag_names,
        ),
    ]


def _resolve_balance_row(
    row: FireflyTransactionRow,
    source_account: Account | None,
    destination_account: Account | None,
    notes: str | None,
    context: FireflyResolutionContext,
) -> list[FireflyLeg]:
    """Resolve an opening balance or reconciliation row into one adjustment leg

    Firefly III pairs these rows with a virtual initial balance or
    reconciliation account, so the imported side is whichever endpoint is a
    real account. Money flowing into the imported side is positive

    Args:
        row: Firefly III journal row from the import payload
        source_account: Imported account on the source side when present
        destination_account: Imported account on the destination side when present
        notes: Combined description and notes text
        context: Lookups needed to resolve the row

    Returns:
        Single balance adjustment leg

    Raises:
        FireflyRowSkipError: Raised when neither endpoint is an imported account
    """
    account = destination_account or source_account
    if account is None:
        raise FireflyRowSkipError("Opening balance or reconciliation row is not attached to an imported account")

    amount = _get_amount_in_account_currency(row, account, context)
    return [FireflyLeg(
        account=account,
        dt=row.dt,
        amount=amount if destination_account is not None else -amount,
        category=context.balance_adjustment_category,
        merchant_name=None,
        notes=notes,
        tag_names=row.tag_names,
    )]


def _get_tracked_account(
    name: str | None,
    account_type: str | None,
    context: FireflyResolutionContext,
) -> Account | None:
    """Return the mapped account for a tracked journal endpoint

    Args:
        name: Account name on the journal endpoint
        account_type: Firefly III account type on the journal endpoint
        context: Lookups needed to resolve the row

    Returns:
        Mapped account when the endpoint is a tracked type, otherwise None

    Raises:
        HTTPException: Raised with 422 when a tracked account name is not mapped
    """
    if not name or not account_type:
        return None
    if account_type.strip().lower() not in FIREFLY_TRACKED_ACCOUNT_TYPES:
        return None
    return get_import_row_account(context.accounts_by_source, name)


def _resolve_row_category(
    row: FireflyTransactionRow,
    account: Account,
    context: FireflyResolutionContext,
) -> Category:
    """Return the mapped category for a categorized row

    Args:
        row: Firefly III journal row from the import payload
        account: Account the resulting transaction is written to
        context: Lookups needed to resolve the row

    Returns:
        Category mapped to the row's category name or the no-category source

    Raises:
        HTTPException: Raised with 422 when the category is not mapped or not usable
    """
    category_name = (row.category or "").strip() or FIREFLY_NO_CATEGORY_SOURCE
    category = get_import_row_category(context.categories_by_source, category_name)
    validate_import_category_can_be_used_for_account(category, account, context.user_id)
    return category


def _get_amount_in_account_currency(
    row: FireflyTransactionRow,
    account: Account,
    context: FireflyResolutionContext,
) -> int:
    """Return the row's absolute amount in the account's currency minor units

    Firefly III writes journal amounts in the transaction currency and carries
    a foreign amount when a second currency is involved, so the account-side
    value is whichever of the two matches the account currency

    Args:
        row: Firefly III journal row from the import payload
        account: Imported account one leg is written to
        context: Lookups needed to resolve the row

    Returns:
        Absolute amount in account-currency minor units

    Raises:
        FireflyRowSkipError: Raised when no amount is available in the account currency
    """
    if row.currency_code.upper() == account.currency:
        raw_amount = row.amount
    elif row.foreign_currency_code and row.foreign_amount and row.foreign_currency_code.upper() == account.currency:
        raw_amount = row.foreign_amount
    else:
        raise FireflyRowSkipError(
            f"Neither the amount nor the foreign amount is in the account's currency ({account.currency})",
        )

    currency = context.currencies_by_code[account.currency]
    try:
        amount = parse_decimal_amount_to_minor_units(
            raw_amount,
            currency_code=currency.id,
            minor_unit_exponent=currency.minor_unit_exponent,
        )
    except (DecimalAmountParseError, DecimalAmountPrecisionError) as exc:
        raise FireflyRowSkipError(f'Invalid amount "{raw_amount}"') from exc
    return abs(amount)


def _build_leg_notes(row: FireflyTransactionRow) -> str | None:
    """Return combined description and notes text for a row's legs

    Args:
        row: Firefly III journal row from the import payload

    Returns:
        Description and notes joined on separate lines, or None when both are empty
    """
    parts = [part.strip() for part in (row.description, row.notes) if part and part.strip()]
    return "\n".join(parts) or None


def _clean_name(name: str | None) -> str | None:
    """Return a trimmed counterparty name or None when empty

    Args:
        name: Raw counterparty name from a journal endpoint

    Returns:
        Trimmed name or None
    """
    cleaned = (name or "").strip()
    return cleaned or None
