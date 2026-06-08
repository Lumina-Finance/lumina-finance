"""Transaction listing service"""
import uuid
from datetime import date

import sqlalchemy as sa
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import aggregate_order_by
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import MappedColumn

from app.models.account import Account
from app.models.category import Category
from app.models.currency import Currency
from app.models.merchant import Merchant
from app.models.tag import Tag, TransactionTag
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.transaction import TransactionResponse
from app.services.fx import FxConverter
from app.services.transaction_responses import (
    build_transaction_response,
    get_merchant_names_batch,
    get_tag_ids_batch,
    get_tags_batch,
)
from app.services.transactions.access import accessible_account_ids_subquery

# Sortable fields mapped to their SQLAlchemy column objects
_SORT_FIELDS: dict[str, MappedColumn] = {
    "dt": Transaction.dt,
    "amount": Transaction.amount,
    "created_at": Transaction.created_at,
    "updated_at": Transaction.updated_at,
}

# Filter fields mapped to their SQLAlchemy column objects
_FILTER_FIELDS: dict[str, MappedColumn] = {
    "account_id": Transaction.account_id,
    "category_id": Transaction.category_id,
    "merchant_id": Transaction.merchant_id,
    "currency": Transaction.currency,
}


async def list_transaction_responses(
    db: AsyncSession,
    user: User,
    *,
    account_id: uuid.UUID | None = None,
    category_id: uuid.UUID | None = None,
    merchant_id: uuid.UUID | None = None,
    currency: str | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
    search_text: str | None = None,
    sort_by: str = "dt",
    sort_order: str = "desc",
    limit: int = 15,
    offset: int = 0,
) -> list[TransactionResponse]:
    """Return paginated transaction responses with sorting and filtering

    Args:
        db: Active database session
        user: Authenticated user requesting the transaction list
        account_id: Optional account filter applied within the user's accessible accounts
        category_id: Optional category filter
        merchant_id: Optional merchant filter
        currency: Optional transaction currency filter
        from_date: Optional inclusive start date for transaction dates
        to_date: Optional inclusive end date for transaction dates
        search_text: Optional text search across merchant name and notes
        sort_by: Transaction field used for ordering
        sort_order: Sort direction, either ``asc`` or ``desc``
        limit: Maximum number of transactions to return
        offset: Number of transactions to skip before returning rows

    Returns:
        Transaction responses enriched with tag summaries, merchant names, and
        account/base-currency converted amounts

    Raises:
        HTTPException: Raised with 422 for invalid sort fields, sort order, or
            date range
    """
    if sort_by not in _SORT_FIELDS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid sort field")
    if sort_order not in ("asc", "desc"):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Sort order must be 'asc' or 'desc'")
    if from_date is not None and to_date is not None and from_date > to_date:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Start date must be before end date")

    transaction_query = _build_transaction_query(
        user_id=user.id,
        account_id=account_id,
        category_id=category_id,
        merchant_id=merchant_id,
        currency=currency,
        from_date=from_date,
        to_date=to_date,
        search_text=search_text,
        sort_by=sort_by,
        sort_order=sort_order,
        limit=limit,
        offset=offset,
    )

    transaction_result = await db.execute(transaction_query)
    transactions = list(transaction_result.scalars().all())

    # Batch-load related response data so response assembly does not issue per-row queries
    tag_ids_by_transaction_id = await get_tag_ids_batch(db, [transaction.id for transaction in transactions])
    tag_summaries_by_transaction_id = await get_tags_batch(db, [transaction.id for transaction in transactions])
    merchant_names_by_id = await get_merchant_names_batch(db, [transaction.merchant_id for transaction in transactions])
    accounts_by_id, currency_exponents = await _get_transaction_response_context(
        db,
        transactions,
        extra_currencies={user.base_currency},
    )
    converter = FxConverter(currency_exponents=currency_exponents)
    await _prefetch_transaction_response_rates(
        converter,
        transactions=transactions,
        accounts_by_id=accounts_by_id,
        base_currency=user.base_currency,
    )

    # Reuse the prefetched converter for both account-currency and user-base amounts
    account_amounts_by_transaction_id = {
        transaction.id: await converter.convert_minor_units(
            transaction.amount,
            base=transaction.currency,
            quote=accounts_by_id[transaction.account_id].currency,
            rate_date=transaction.dt,
        )
        for transaction in transactions
    }
    base_amounts_by_transaction_id = {
        transaction.id: await converter.convert_minor_units(
            transaction.amount,
            base=transaction.currency,
            quote=user.base_currency,
            rate_date=transaction.dt,
        )
        for transaction in transactions
    }
    return [
        build_transaction_response(
            transaction,
            tag_ids_by_transaction_id[transaction.id],
            merchant_names_by_id.get(transaction.merchant_id) if transaction.merchant_id else None,
            tag_summaries_by_transaction_id[transaction.id],
            account_amount=account_amounts_by_transaction_id[transaction.id],
            base_currency_amount=base_amounts_by_transaction_id[transaction.id],
        )
        for transaction in transactions
    ]


def _build_transaction_query(
    *,
    user_id: uuid.UUID,
    account_id: uuid.UUID | None,
    category_id: uuid.UUID | None,
    merchant_id: uuid.UUID | None,
    currency: str | None,
    from_date: date | None,
    to_date: date | None,
    search_text: str | None,
    sort_by: str,
    sort_order: str,
    limit: int,
    offset: int,
):
    """Build the SQL query for a filtered transaction page

    Args:
        user_id: Identifier for the user requesting transactions
        account_id: Optional account filter
        category_id: Optional category filter
        merchant_id: Optional merchant filter
        currency: Optional transaction currency filter
        from_date: Optional inclusive start date for transaction dates
        to_date: Optional inclusive end date for transaction dates
        search_text: Optional text search across merchant name and notes
        sort_by: Transaction field used for ordering
        sort_order: Sort direction, either ``asc`` or ``desc``
        limit: Maximum number of transactions to return
        offset: Number of transactions to skip before returning rows

    Returns:
        A SQLAlchemy selectable for the requested transaction page
    """
    accessible_account_ids_query = accessible_account_ids_subquery(user_id)
    transaction_query = select(Transaction).where(Transaction.account_id.in_(accessible_account_ids_query))

    # Apply filters in phases so optional joins are only added when sorting or search needs them
    exact_filters = {
        "account_id": account_id,
        "category_id": category_id,
        "merchant_id": merchant_id,
        "currency": currency,
    }
    for field_name, field_value in exact_filters.items():
        if field_value is not None:
            transaction_query = transaction_query.where(_FILTER_FIELDS[field_name] == field_value)

    if from_date is not None:
        transaction_query = transaction_query.where(Transaction.dt >= from_date)
    if to_date is not None:
        transaction_query = transaction_query.where(Transaction.dt <= to_date)

    # Date sorting includes related names as tie-breakers, so it needs the category, merchant, and tag joins
    tag_sort_subquery = None
    merchant_is_joined = False
    if sort_by == "dt":
        tag_sort_subquery = _transaction_tag_sort_subquery()
        transaction_query = (
            transaction_query
            .join(Category, Category.id == Transaction.category_id)
            .outerjoin(Merchant, Transaction.merchant_id == Merchant.id)
            .outerjoin(tag_sort_subquery, tag_sort_subquery.c.transaction_id == Transaction.id)
        )
        merchant_is_joined = True

    if search_text is not None:
        search_pattern = f"%{_escape_like(search_text)}%"
        if not merchant_is_joined:
            transaction_query = transaction_query.outerjoin(Merchant, Transaction.merchant_id == Merchant.id)
        transaction_query = transaction_query.where(Transaction.notes.ilike(search_pattern) | Merchant.name.ilike(search_pattern))

    if sort_by == "dt":
        transaction_query = transaction_query.order_by(*_date_sort_order(sort_order, tag_sort_subquery.c.tag_names))
    else:
        sort_column = _SORT_FIELDS[sort_by]
        primary_order = sort_column.desc() if sort_order == "desc" else sort_column.asc()
        transaction_query = transaction_query.order_by(primary_order, Transaction.id)
    return transaction_query.limit(limit).offset(offset)


def _escape_like(value: str) -> str:
    """Escape LIKE-special characters so user input is matched literally

    Args:
        value: Raw search text supplied by the user

    Returns:
        Search text escaped for a SQL ``LIKE`` expression
    """
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _transaction_tag_sort_subquery():
    """Build the transaction tag-name sort subquery

    Returns:
        A SQLAlchemy subquery with one row per transaction and a normalized tag
        name string used as a stable date-sort tie breaker
    """
    tag_name = sa.func.lower(Tag.name)
    return (
        select(
            TransactionTag.transaction_id,
            sa.func.string_agg(
                tag_name,
                aggregate_order_by(",", tag_name),
            ).label("tag_names"),
        )
        .join(Tag, Tag.id == TransactionTag.tag_id)
        .group_by(TransactionTag.transaction_id)
        .subquery()
    )


def _date_sort_order(sort_order: str, tag_names):
    """Build deterministic ordering for default date sorting

    Args:
        sort_order: Sort direction, either ``asc`` or ``desc``
        tag_names: SQL expression containing aggregated tag names for the row

    Returns:
        SQLAlchemy ordering expressions for date sorting and stable pagination
    """
    date_order = Transaction.dt.desc() if sort_order == "desc" else Transaction.dt.asc()
    created_order = Transaction.created_at.desc() if sort_order == "desc" else Transaction.created_at.asc()
    # These tie-breakers keep pagination stable when many transactions share the same date
    return (
        date_order,
        created_order,
        Transaction.amount.asc(),
        sa.func.lower(Category.name).asc(),
        sa.func.lower(sa.func.coalesce(Merchant.name, "")).asc(),
        sa.func.lower(sa.func.coalesce(Transaction.notes, "")).asc(),
        sa.func.coalesce(tag_names, "").asc(),
        Transaction.id,
    )


async def _get_currency_exponents(db: AsyncSession, currencies: set[str]) -> dict[str, int]:
    """Load minor-unit exponents for currency codes

    Args:
        db: Active database session
        currencies: Currency codes to load

    Returns:
        Mapping from currency code to minor-unit exponent
    """
    currency_result = await db.execute(
        select(Currency.id, Currency.minor_unit_exponent).where(Currency.id.in_(currencies)),
    )
    return {row.id: row.minor_unit_exponent for row in currency_result}


async def _get_accounts_by_id(db: AsyncSession, account_ids: set[uuid.UUID]) -> dict[uuid.UUID, Account]:
    """Load accounts keyed by ID

    Args:
        db: Active database session
        account_ids: Account IDs to fetch

    Returns:
        Mapping from account ID to account row
    """
    account_rows = (
        (await db.execute(select(Account).where(Account.id.in_(account_ids)))).scalars().all()
        if account_ids
        else []
    )
    return {account.id: account for account in account_rows}


async def _get_transaction_response_context(
    db: AsyncSession,
    transactions: list[Transaction],
    *,
    extra_currencies: set[str] | None = None,
) -> tuple[dict[uuid.UUID, Account], dict[str, int]]:
    """Load account and currency context for transaction response conversion

    Args:
        db: Active database session
        transactions: Transactions being converted into response payloads
        extra_currencies: Additional currency codes required by the response context

    Returns:
        Account rows keyed by ID and currency exponents keyed by currency code
    """
    accounts_by_id = await _get_accounts_by_id(db, {transaction.account_id for transaction in transactions})
    currencies = {
        transaction.currency
        for transaction in transactions
    } | {
        account.currency
        for account in accounts_by_id.values()
    } | (extra_currencies or set())
    return accounts_by_id, await _get_currency_exponents(db, currencies)


async def _prefetch_transaction_response_rates(
    converter: FxConverter,
    *,
    transactions: list[Transaction],
    accounts_by_id: dict[uuid.UUID, Account],
    base_currency: str,
) -> None:
    """Prefetch exchange rates needed to build transaction responses

    Args:
        converter: Request-scoped FX converter that caches prefetched rates
        transactions: Transactions being converted into response payloads
        accounts_by_id: Account rows keyed by ID
        base_currency: User base currency used for converted response amounts

    Returns:
        None
    """
    if not transactions:
        return

    start_date = min(transaction.dt for transaction in transactions)
    end_date = max(transaction.dt for transaction in transactions)
    # Collapse repeated conversions into distinct currency pairs before prefetching rates
    conversion_pairs = {
        (transaction.currency, quote_currency)
        for transaction in transactions
        for quote_currency in (accounts_by_id[transaction.account_id].currency, base_currency)
        if transaction.currency != quote_currency
    }
    for base_currency_code, quote_currency_code in sorted(conversion_pairs):
        await converter.prefetch_rates(
            base=base_currency_code,
            quote=quote_currency_code,
            start_date=start_date,
            end_date=end_date,
        )
