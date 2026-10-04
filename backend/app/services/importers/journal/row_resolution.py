"""Journal row to Lumina transaction leg resolution"""

import uuid
from dataclasses import dataclass
from datetime import date
from typing import Literal

from app.models.account import Account
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.currency import Currency
from app.schemas.import_run import JournalTransactionRow
from app.services.categories.transfer_rules import does_category_record_counterparty_account
from app.services.importers.journal.constants import (
    JOURNAL_NO_CATEGORY_SOURCE,
    JOURNAL_TYPE_DEPOSIT,
    JOURNAL_TYPE_OPENING_BALANCE,
    JOURNAL_TYPE_RECONCILIATION,
    JOURNAL_TYPE_WITHDRAWAL,
)
from app.services.importers.shared.row_mappings import (
    get_import_row_account,
    get_import_row_category,
    validate_import_category_can_be_used_for_account,
)
from app.utils.money import (
    DecimalAmountParseError,
    DecimalAmountPrecisionError,
    parse_decimal_amount_to_minor_units,
)


class JournalRowRefusedError(Exception):
    """Raised when a journal row cannot be converted into Lumina legs"""

    def __init__(self, reason: str) -> None:
        """Store the client-facing refusal reason

        Args:
            reason: Why the row cannot be converted
        """
        super().__init__(reason)
        self.reason = reason


@dataclass
class JournalResolutionContext:
    """Store lookups needed to resolve journal rows into transaction legs

    Attributes:
        user_id: Identifier for the user running the import
        accounts_by_source: Account rows keyed by the account source the frontend gave each imported account
        categories_by_source: Category rows keyed by the export's category name
        currencies_by_code: Currency rows keyed by currency code
        transfer_category: System category applied to two-leg transfers, on the legs no row category claims
        balance_adjustment_category: System category applied to opening balances
    """

    user_id: uuid.UUID
    accounts_by_source: dict[str, Account]
    categories_by_source: dict[str, Category]
    currencies_by_code: dict[str, Currency]
    transfer_category: Category
    balance_adjustment_category: Category


@dataclass
class JournalLeg:
    """One Lumina transaction produced from a journal row

    Attributes:
        account: Account the transaction is written to
        dt: Transaction date
        amount: Signed amount in account-currency minor units
        category: Category applied to the transaction
        merchant_name: Optional payee recorded as a merchant
        notes: Optional combined description and notes text
        tag_names: Tag names applied to the transaction
        counterparty_account: Account the money moved to or from, set only on transfer legs whose category records one
    """

    account: Account
    dt: date
    amount: int
    category: Category
    merchant_name: str | None
    notes: str | None
    tag_names: list[str]

    # Only a transfer pair knows the opposite endpoint, and only a category that records it may keep
    # it, so a leg built anywhere else, or a pair leg filed under an expense or income category,
    # leaves this unset
    counterparty_account: Account | None = None


def resolve_journal_row(row: JournalTransactionRow, context: JournalResolutionContext) -> list[JournalLeg]:
    """Resolve one journal row into Lumina transaction legs

    Args:
        row: Journal row from the import payload
        context: Lookups needed to resolve the row

    Returns:
        Transaction legs the row produces

    Raises:
        JournalRowRefusedError: Raised when the row cannot be converted
        HTTPException: Raised with 422 when a tracked account or category is not mapped
    """
    source_account = _get_tracked_account(row.source_account, context)
    destination_account = _get_tracked_account(row.destination_account, context)
    notes = _build_leg_notes(row)

    if row.type in (JOURNAL_TYPE_OPENING_BALANCE, JOURNAL_TYPE_RECONCILIATION):
        return _resolve_balance_row(row, source_account, destination_account, notes, context)

    # A journal between two imported accounts is a transfer in Lumina no
    # matter its type, which covers Firefly III loan payments recorded as
    # withdrawals into a liability account
    if source_account is not None and destination_account is not None:
        return _resolve_transfer_pair(row, source_account, destination_account, notes, context)

    if row.type == JOURNAL_TYPE_WITHDRAWAL:
        if source_account is None:
            raise JournalRowRefusedError("Withdrawal source is not an imported account")
        category = _resolve_row_category(row, source_account, context)
        return [JournalLeg(
            account=source_account,
            dt=row.dt,
            amount=-_get_amount_in_account_currency(row, source_account, context),
            category=category,
            merchant_name=row.destination_name,
            notes=notes,
            tag_names=row.tag_names,
        )]

    if row.type == JOURNAL_TYPE_DEPOSIT:
        if destination_account is None:
            raise JournalRowRefusedError("Deposit destination is not an imported account")
        category = _resolve_row_category(row, destination_account, context)
        return [JournalLeg(
            account=destination_account,
            dt=row.dt,
            amount=_get_amount_in_account_currency(row, destination_account, context),
            category=category,
            merchant_name=row.source_name,
            notes=notes,
            tag_names=row.tag_names,
        )]

    # The type is one of the five the row schema takes, so only a transfer is left
    raise JournalRowRefusedError("Transfer endpoint is not an imported account")


def _resolve_transfer_pair(
    row: JournalTransactionRow,
    source_account: Account,
    destination_account: Account,
    notes: str | None,
    context: JournalResolutionContext,
) -> list[JournalLeg]:
    """Resolve a row between two imported accounts into its two legs

    Both legs are transfers recording the other endpoint unless the row names a category leg. That
    leg takes the row's mapped category, and when the category is an expense or income one it
    records no counterparty and takes the other account's name from the row as its merchant, so a
    loan payment from Actual Budget can be spending in its budget category. The other leg stays a
    transfer under the system Transfer category, unless the row names both legs, which then share
    its transfer category, as a credit card payment does

    Args:
        row: Journal row from the import payload
        source_account: Imported account money leaves
        destination_account: Imported account money enters
        notes: Combined description and notes text
        context: Lookups needed to resolve the row

    Returns:
        Outgoing and incoming legs

    Raises:
        JournalRowRefusedError: Raised when both endpoints resolve to one account, or when the
            category a row gives one leg is a transfer category that does not record a counterparty
        HTTPException: Raised with 422 when that category is not mapped or not usable
    """
    # Two names in the file can be mapped onto one account, which is how a renamed account is
    # carried across. The pair would then be two cancelling rows in that account, a shape the API
    # refuses when a person enters it by hand
    if source_account.id == destination_account.id:
        raise JournalRowRefusedError("Transfer source and destination resolve to the same account")

    source_category = destination_category = context.transfer_category
    if row.category_leg in ("source", "both"):
        source_category = _resolve_transfer_leg_category(row, "source", source_account, context)
    if row.category_leg in ("destination", "both"):
        destination_category = _resolve_transfer_leg_category(row, "destination", destination_account, context)

    source_records_counterparty = does_category_record_counterparty_account(source_category)
    destination_records_counterparty = does_category_record_counterparty_account(destination_category)
    return [
        JournalLeg(
            account=source_account,
            dt=row.dt,
            amount=-_get_amount_in_account_currency(row, source_account, context),
            category=source_category,
            merchant_name=None if source_records_counterparty else row.destination_name,
            notes=notes,
            tag_names=row.tag_names,
            counterparty_account=destination_account if source_records_counterparty else None,
        ),
        JournalLeg(
            account=destination_account,
            dt=row.dt,
            amount=_get_amount_in_account_currency(row, destination_account, context),
            category=destination_category,
            merchant_name=None if destination_records_counterparty else row.source_name,
            notes=notes,
            tag_names=row.tag_names,
            counterparty_account=source_account if destination_records_counterparty else None,
        ),
    ]


def _resolve_transfer_leg_category(
    row: JournalTransactionRow,
    leg: Literal["source", "destination"],
    account: Account,
    context: JournalResolutionContext,
) -> Category:
    """Return the category a transfer row gives the leg it names

    An expense or income category files the leg as spending or income. A transfer category keeps
    the leg's counterparty account, so it has to be one that records it. A row naming both legs takes
    a transfer category only, since spending on one leg and the same category on the other would
    cancel out

    Args:
        row: Journal row naming a category leg
        leg: Which leg the category is resolved for
        account: Account the named leg is written to
        context: Lookups needed to resolve the row

    Returns:
        Category mapped to the row's category name

    Raises:
        JournalRowRefusedError: Raised when the mapped category is a transfer category that does not
            record a counterparty account, or is not a transfer category on a row naming both legs
        HTTPException: Raised with 422 when the category is not mapped or not usable
    """
    category = _resolve_row_category(row, account, context)
    if row.category_leg == "both" and category.kind != CategoryKind.TRANSFER:
        raise JournalRowRefusedError(
            f"Both legs of a transfer can only share a transfer category, and category source {row.category} "
            f"maps to {category.name}",
        )
    if category.kind == CategoryKind.TRANSFER and not does_category_record_counterparty_account(category):
        raise JournalRowRefusedError(
            f"The {leg} leg of a transfer can't use a transfer category that doesn't record the "
            f"other account, and category source {row.category} maps to {category.name}",
        )
    return category


def _resolve_balance_row(
    row: JournalTransactionRow,
    source_account: Account | None,
    destination_account: Account | None,
    notes: str | None,
    context: JournalResolutionContext,
) -> list[JournalLeg]:
    """Resolve an opening balance or reconciliation row into one adjustment leg

    An export pairs these rows with a virtual initial balance or
    reconciliation account, so the imported side is whichever endpoint is a
    real account. Money flowing into the imported side is positive

    Args:
        row: Journal row from the import payload
        source_account: Imported account on the source side when present
        destination_account: Imported account on the destination side when present
        notes: Combined description and notes text
        context: Lookups needed to resolve the row

    Returns:
        Single balance adjustment leg

    Raises:
        JournalRowRefusedError: Raised when neither endpoint is an imported account
    """
    account = destination_account or source_account
    if account is None:
        raise JournalRowRefusedError("Opening balance or reconciliation row is not attached to an imported account")

    amount = _get_amount_in_account_currency(row, account, context)
    return [JournalLeg(
        account=account,
        dt=row.dt,
        amount=amount if destination_account is not None else -amount,
        category=context.balance_adjustment_category,
        merchant_name=None,
        notes=notes,
        tag_names=row.tag_names,
    )]


def _get_tracked_account(account_source: str | None, context: JournalResolutionContext) -> Account | None:
    """Return the mapped account for a journal endpoint the frontend marked as an imported account

    Args:
        account_source: Account source naming the endpoint, or None when it is not an imported account
        context: Lookups needed to resolve the row

    Returns:
        Mapped account, or None when the endpoint is not an imported account

    Raises:
        HTTPException: Raised with 422 when the account source is not mapped
    """
    if account_source is None:
        return None
    return get_import_row_account(context.accounts_by_source, account_source)


def _resolve_row_category(
    row: JournalTransactionRow,
    account: Account,
    context: JournalResolutionContext,
) -> Category:
    """Return the mapped category for a categorized row

    Args:
        row: Journal row from the import payload
        account: Account the resulting transaction is written to
        context: Lookups needed to resolve the row

    Returns:
        Category mapped to the row's category name or the no-category source

    Raises:
        HTTPException: Raised with 422 when the category is not mapped or not usable
    """
    category_name = row.category if row.category is not None else JOURNAL_NO_CATEGORY_SOURCE
    category = get_import_row_category(context.categories_by_source, category_name)
    validate_import_category_can_be_used_for_account(category, account, context.user_id)
    return category


def _get_amount_in_account_currency(
    row: JournalTransactionRow,
    account: Account,
    context: JournalResolutionContext,
) -> int:
    """Return the row's amount in the account's currency minor units

    A journal amount is in the transaction currency, with a foreign amount
    when a second currency is involved, so the account-side value is
    whichever of the two matches the account currency

    Args:
        row: Journal row from the import payload
        account: Imported account one leg is written to
        context: Lookups needed to resolve the row

    Returns:
        Amount in account-currency minor units, never below zero since the row sends magnitudes

    Raises:
        JournalRowRefusedError: Raised when no amount is available in the account currency, or
            when the amount has too many decimal places or is too large to store
    """
    if row.currency_code == account.currency:
        raw_amount = row.amount
    elif row.foreign_amount is not None and row.foreign_currency_code == account.currency:
        raw_amount = row.foreign_amount
    else:
        raise JournalRowRefusedError(
            f"Neither the amount nor the foreign amount is in the account's currency ({account.currency})",
        )

    currency = context.currencies_by_code[account.currency]
    try:
        amount = parse_decimal_amount_to_minor_units(
            raw_amount,
            currency_code=currency.id,
            minor_unit_exponent=currency.minor_unit_exponent,
        )
    except DecimalAmountPrecisionError as exc:
        raise JournalRowRefusedError(
            f"The amount has more decimal places than {currency.id} has. "
            "A period is read as a decimal point, never as a separator between thousands.",
        ) from exc
    except DecimalAmountParseError as exc:
        raise JournalRowRefusedError(f'Invalid amount "{raw_amount}"') from exc
    return amount


def _build_leg_notes(row: JournalTransactionRow) -> str | None:
    """Return combined description and notes text for a row's legs

    Args:
        row: Journal row from the import payload

    Returns:
        Description and notes joined on separate lines, or None when both are null
    """
    return "\n".join(part for part in (row.description, row.notes) if part is not None) or None
