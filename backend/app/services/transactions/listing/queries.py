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
