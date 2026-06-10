"""Transaction listing service"""
import uuid
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.schemas.transaction import TransactionResponse
from app.services.transaction_response_helpers import (
    build_transaction_response,
    get_merchant_names_batch,
    get_tag_ids_batch,
    get_tags_batch,
)
from app.services.transactions.listing.amounts import get_transaction_listing_converted_amounts
from app.services.transactions.listing.queries import (
    build_transaction_listing_query,
    is_valid_transaction_listing_sort_field,
)


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

    The service builds a transaction query limited to readable accounts, batch-loads
    related response data, and converts each transaction into account and user
    base-currency amounts without issuing per-transaction lookup queries

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
    if not is_valid_transaction_listing_sort_field(sort_by):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid sort field")
    if sort_order not in ("asc", "desc"):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Sort order must be 'asc' or 'desc'")
    if from_date is not None and to_date is not None and from_date > to_date:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Start date must be before end date")

    transaction_query = build_transaction_listing_query(
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

    # Fetch one transaction page inside the user's readable account scope and requested filters
    transaction_result = await db.execute(transaction_query)
    transactions = list(transaction_result.scalars().all())

    # Batch-load related response data so response assembly does not issue per-row queries
    tag_ids_by_transaction_id = await get_tag_ids_batch(db, [transaction.id for transaction in transactions])
    tag_summaries_by_transaction_id = await get_tags_batch(db, [transaction.id for transaction in transactions])
    merchant_names_by_id = await get_merchant_names_batch(db, [transaction.merchant_id for transaction in transactions])

    account_amounts_by_transaction_id, base_amounts_by_transaction_id = await get_transaction_listing_converted_amounts(
        db,
        transactions,
        base_currency=user.base_currency,
    )

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
