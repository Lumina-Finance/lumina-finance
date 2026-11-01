"""Transaction CSV export service"""

import csv
import io
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.category import Category
from app.models.transaction import Transaction
from app.models.user import User
from app.services.fx.currency_exponent_helpers import get_currency_exponents
from app.services.transactions.access_helpers import accessible_account_ids_subquery
from app.services.transactions.listing.queries import build_transaction_listing_query
from app.services.transactions.listing.validation import validate_transaction_listing_filters
from app.services.transactions.response_helpers import get_merchant_names_batch, get_tags_batch
from app.utils.dates import resolve_timezone

# Rows read and written per round of lookups, which bounds memory however long the export is
EXPORT_CHUNK_SIZE = 500

EXPORT_COLUMNS = ("Date", "Merchant", "Category", "Account", "Tags", "Amount", "Currency", "Notes")

# Marks the file as UTF-8 for spreadsheet apps that would otherwise read accents as another encoding
UTF8_BYTE_ORDER_MARK = "﻿"

# A spreadsheet reads a cell starting with one of these as a formula, so text cells starting with one
# get a leading apostrophe, which the spreadsheet hides and treats the rest as plain text
FORMULA_TRIGGER_CHARACTERS = ("=", "+", "-", "@", "\t", "\r", "\n")


@dataclass(frozen=True)
class TransactionCsvExport:
    """A CSV file being produced, with the name the user's download should carry"""

    filename: str
    chunks: AsyncIterator[str]


def neutralize_spreadsheet_formula(text: str) -> str:
    """Return text that a spreadsheet shows as written instead of running it as a formula

    Args:
        text: Text typed by a user or brought in by an import

    Returns:
        The text, with a leading apostrophe when its first character would start a formula
    """
    if text.startswith(FORMULA_TRIGGER_CHARACTERS):
        return "'" + text
    return text


def format_minor_units(amount: int, exponent: int) -> str:
    """Write integer minor units as a plain decimal in major units without rounding

    Args:
        amount: Signed amount in minor units
        exponent: Minor-unit exponent of the amount's currency

    Returns:
        The amount with exactly ``exponent`` decimals, such as ``-12.50``
    """
    return f"{Decimal(amount).scaleb(-exponent):.{exponent}f}"


async def export_transactions_csv(
    db: AsyncSession,
    user: User,
    *,
    account_ids: list[uuid.UUID] | None = None,
    category_ids: list[uuid.UUID] | None = None,
    merchant_ids: list[uuid.UUID] | None = None,
    currencies: list[str] | None = None,
    tag_ids: list[uuid.UUID] | None = None,
    tag_match: str = "all",
    min_amount: int | None = None,
    max_amount: int | None = None,
    amount_currency: str | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
    search_text: str | None = None,
) -> TransactionCsvExport:
    """Start a CSV of every transaction matching the list's filters, newest first

    The filters, the readable-account scope and the order are the list's own, with no page cap. The
    rows stream in chunks, so nothing but the first validation can fail before the response begins

    Args:
        db: Active database session, which must stay open and uncommitted while the chunks are read
        user: Authenticated user exporting transactions
        account_ids: Optional accounts to keep within the user's accessible accounts
        category_ids: Optional categories to keep
        merchant_ids: Optional merchants to keep
        currencies: Optional transaction currencies to keep
        tag_ids: Optional tags to filter by, combined per ``tag_match``
        tag_match: ``all`` to require every selected tag, ``any`` to require at least one
        min_amount: Optional inclusive lower bound on the amount magnitude in ``amount_currency`` minor units
        max_amount: Optional inclusive upper bound on the amount magnitude in ``amount_currency`` minor units
        amount_currency: Currency the amount bounds are expressed in, required when a bound is set
        from_date: Optional inclusive start date for transaction dates
        to_date: Optional inclusive end date for transaction dates
        search_text: Optional text search across merchant name and notes

    Returns:
        The download's filename and the CSV text in chunks

    Raises:
        HTTPException: Raised with 422 for an invalid date range, tag match mode, or an amount
            range missing its currency
    """
    validate_transaction_listing_filters(
        tag_ids=tag_ids,
        tag_match=tag_match,
        min_amount=min_amount,
        max_amount=max_amount,
        amount_currency=amount_currency,
        from_date=from_date,
        to_date=to_date,
        sort_by="dt",
        sort_order="desc",
    )
    transaction_query = build_transaction_listing_query(
        user_id=user.id,
        account_ids=account_ids,
        category_ids=category_ids,
        merchant_ids=merchant_ids,
        currencies=currencies,
        tag_ids=tag_ids,
        tag_match=tag_match,
        min_amount=min_amount,
        max_amount=max_amount,
        amount_currency=amount_currency,
        from_date=from_date,
        to_date=to_date,
        search_text=search_text,
        sort_by="dt",
        sort_order="desc",
        limit=None,
        offset=None,
    )
    return _start_export(db, user, transaction_query)


async def export_selected_transactions_csv(
    db: AsyncSession,
    user: User,
    transaction_ids: list[uuid.UUID],
) -> TransactionCsvExport:
    """Start a CSV of exactly the chosen transactions, newest first

    Follows the bulk edit and delete: the ids must all be inside the caller's readable accounts, and
    one that is unknown or belongs to someone else refuses the whole request, so a file never looks
    complete while missing a row. The check runs before the response begins, as the rows then stream

    Args:
        db: Active database session, which must stay open and uncommitted while the chunks are read
        user: Authenticated user exporting transactions
        transaction_ids: Transactions to export, repeats allowed

    Returns:
        The download's filename and the CSV text in chunks

    Raises:
        HTTPException: Raised with 404 when any transaction is not found in the caller's accounts
    """
    requested_ids = list(dict.fromkeys(transaction_ids))
    readable_count = await db.scalar(
        select(func.count())
        .select_from(Transaction)
        .where(Transaction.id.in_(requested_ids), Transaction.account_id.in_(accessible_account_ids_subquery(user.id)))
    )
    if readable_count != len(requested_ids):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"{len(requested_ids) - (readable_count or 0)} of {len(requested_ids)} transactions were not found",
        )
    transaction_query = build_transaction_listing_query(
        user_id=user.id,
        account_ids=None,
        category_ids=None,
        merchant_ids=None,
        currencies=None,
        tag_ids=None,
        tag_match="all",
        min_amount=None,
        max_amount=None,
        amount_currency=None,
        from_date=None,
        to_date=None,
        search_text=None,
        sort_by="dt",
        sort_order="desc",
        limit=None,
        offset=None,
        extra_conditions=[Transaction.id.in_(requested_ids)],
    )
    return _start_export(db, user, transaction_query)


def _start_export(db: AsyncSession, user: User, transaction_query) -> TransactionCsvExport:
    """Name the download after the user's today and stream the rows of one query"""
    today = datetime.now(resolve_timezone(user.tz)).date()
    return TransactionCsvExport(
        filename=f"lumina-finance-transactions-{today.isoformat()}.csv",
        chunks=_stream_csv(db, transaction_query),
    )


async def _stream_csv(db: AsyncSession, transaction_query) -> AsyncIterator[str]:
    """Yield the header and then the rows of one query as CSV text, one chunk at a time

    The generator only reads: a commit or rollback would end the transaction that carries the user's
    row-level security identity and the open cursor. A failure part way propagates, so the
    connection is cut and the download fails instead of ending as a file that looks complete
    """
    yield UTF8_BYTE_ORDER_MARK + _write_csv_rows([EXPORT_COLUMNS])

    # One server-side cursor keeps every chunk on the same snapshot of the matching rows
    result = await db.stream_scalars(transaction_query.execution_options(yield_per=EXPORT_CHUNK_SIZE))
    async for transactions in result.partitions():
        yield _write_csv_rows(await _build_rows(db, transactions))

        # The session would otherwise hold every exported row until the response ends
        for transaction in transactions:
            db.expunge(transaction)


async def _build_rows(db: AsyncSession, transactions: list[Transaction]) -> list[list[str]]:
    """Look up the names one chunk of transactions needs and lay each out as a CSV row"""
    transaction_ids = [transaction.id for transaction in transactions]
    merchant_names = await get_merchant_names_batch(db, [transaction.merchant_id for transaction in transactions])
    tags_by_transaction_id = await get_tags_batch(db, transaction_ids)
    category_names = await _get_names(db, Category, {transaction.category_id for transaction in transactions})
    account_names = await _get_names(db, Account, {transaction.account_id for transaction in transactions})
    exponents = await get_currency_exponents(db, {transaction.currency for transaction in transactions})

    return [
        [
            transaction.dt.isoformat(),
            neutralize_spreadsheet_formula(merchant_names.get(transaction.merchant_id, "")),
            neutralize_spreadsheet_formula(category_names[transaction.category_id]),
            neutralize_spreadsheet_formula(account_names[transaction.account_id]),
            neutralize_spreadsheet_formula(", ".join(tag.name for tag in tags_by_transaction_id[transaction.id])),
            format_minor_units(transaction.amount, exponents[transaction.currency]),
            transaction.currency,
            neutralize_spreadsheet_formula(transaction.notes or ""),
        ]
        for transaction in transactions
    ]


async def _get_names(db: AsyncSession, model: type[Category] | type[Account], ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    """Return display names keyed by identifier for the categories or accounts one chunk references"""
    result = await db.execute(select(model.id, model.name).where(model.id.in_(ids)))
    return {row.id: row.name for row in result.all()}


def _write_csv_rows(rows: list[list[str]] | list[tuple[str, ...]]) -> str:
    """Return rows as CSV text, quoting any cell holding a comma, quote or line break"""
    buffer = io.StringIO()
    csv.writer(buffer).writerows(rows)
    return buffer.getvalue()
