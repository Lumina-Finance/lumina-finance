"""Transaction listing query builders"""
import uuid
from datetime import date

import sqlalchemy as sa
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import aggregate_order_by
from sqlalchemy.orm import MappedColumn

from app.models.category import Category
from app.models.merchant import Merchant
from app.models.tag import Tag, TransactionTag
from app.models.transaction import Transaction
from app.services.transactions.access_helpers import accessible_account_ids_subquery

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


def is_valid_transaction_listing_sort_field(sort_by: str) -> bool:
    """Return whether a transaction list sort field is supported

    Args:
        sort_by: Requested transaction list sort field

    Returns:
        True when the sort field can be used by the listing query
    """
    return sort_by in _SORT_FIELDS


def build_transaction_listing_query(
    *,
    user_id: uuid.UUID,
    account_ids: list[uuid.UUID] | None,
    category_ids: list[uuid.UUID] | None,
    merchant_ids: list[uuid.UUID] | None,
    currencies: list[str] | None,
    tag_ids: list[uuid.UUID] | None,
    tag_match: str,
    min_amount: int | None,
    max_amount: int | None,
    amount_currency: str | None,
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
        account_ids: Optional accounts to keep, matching any selected account
        category_ids: Optional categories to keep, matching any selected category
        merchant_ids: Optional merchants to keep, matching any selected merchant
        currencies: Optional transaction currencies to keep, matching any selected currency
        tag_ids: Optional tags to filter by, combined per ``tag_match``
        tag_match: ``all`` to require every selected tag, ``any`` to require at least one
        min_amount: Optional inclusive lower bound on the amount magnitude in ``amount_currency`` minor units
        max_amount: Optional inclusive upper bound on the amount magnitude in ``amount_currency`` minor units
        amount_currency: Currency the amount bounds are expressed in, required when a bound is set
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

    # Each multi-value filter keeps a transaction when its field matches any of the selected values
    list_filters = {
        "account_id": account_ids,
        "category_id": category_ids,
        "merchant_id": merchant_ids,
        "currency": currencies,
    }
    for field_name, field_values in list_filters.items():
        if field_values:
            transaction_query = transaction_query.where(_FILTER_FIELDS[field_name].in_(field_values))

    if tag_ids:
        transaction_query = transaction_query.where(Transaction.id.in_(_transaction_ids_with_tags(tag_ids, tag_match)))

    # Amounts are stored in each transaction's own currency minor units and are not comparable across
    # currencies, so the range is matched as a magnitude within the single requested currency
    if min_amount is not None or max_amount is not None:
        transaction_query = transaction_query.where(Transaction.currency == amount_currency)
        if min_amount is not None:
            transaction_query = transaction_query.where(sa.func.abs(Transaction.amount) >= min_amount)
        if max_amount is not None:
            transaction_query = transaction_query.where(sa.func.abs(Transaction.amount) <= max_amount)

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


def _transaction_ids_with_tags(tag_ids: list[uuid.UUID], tag_match: str):
    """Build a subquery of transaction ids satisfying the tag filter

    Args:
        tag_ids: Selected tag identifiers to match against
        tag_match: ``all`` to require every selected tag, ``any`` to require at least one

    Returns:
        A SQLAlchemy select of transaction ids that match the requested tags
    """
    tag_id_query = (
        select(TransactionTag.transaction_id)
        .where(TransactionTag.tag_id.in_(tag_ids))
        .group_by(TransactionTag.transaction_id)
    )

    # Requiring every tag means the row must join to each distinct selected tag exactly once
    if tag_match == "all":
        tag_id_query = tag_id_query.having(sa.func.count(sa.distinct(TransactionTag.tag_id)) == len(tag_ids))
    return tag_id_query


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
