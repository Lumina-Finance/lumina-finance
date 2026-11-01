"""Transaction listing filter validation, shared by the list and the CSV export"""

import uuid
from datetime import date

from fastapi import HTTPException, status

from app.services.transactions.listing.queries import is_valid_transaction_listing_sort_field


def validate_transaction_listing_filters(
    *,
    tag_ids: list[uuid.UUID] | None,
    tag_match: str,
    min_amount: int | None,
    max_amount: int | None,
    amount_currency: str | None,
    from_date: date | None,
    to_date: date | None,
    sort_by: str,
    sort_order: str,
) -> None:
    """Refuse filter and sort combinations the listing query cannot answer

    Raises:
        HTTPException: Raised with 422 for invalid sort fields, sort order, date
            range, tag match mode, or an amount range missing its currency
    """
    if not is_valid_transaction_listing_sort_field(sort_by):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid sort field")
    if sort_order not in ("asc", "desc"):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Sort order must be 'asc' or 'desc'")
    if from_date is not None and to_date is not None and from_date > to_date:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Start date must be before end date")
    if tag_ids and tag_match not in ("all", "any"):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Tag match must be 'all' or 'any'")
    if (min_amount is not None or max_amount is not None) and not amount_currency:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Amount currency is required when filtering by amount")
    if min_amount is not None and max_amount is not None and min_amount > max_amount:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Minimum amount must not exceed maximum amount")
