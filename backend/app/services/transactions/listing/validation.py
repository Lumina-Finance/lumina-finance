"""Transaction listing filter validation, shared by the list and the CSV export"""

from datetime import date

from fastapi import HTTPException, status


def validate_transaction_listing_filters(
    *,
    min_amount: int | None,
    max_amount: int | None,
    amount_currency: str | None,
    from_date: date | None,
    to_date: date | None,
) -> None:
    """Refuse filter combinations the listing query cannot answer

    Raises:
        HTTPException: Raised with 422 for a reversed date range or amount range, or an amount range
            missing its currency
    """
    if from_date is not None and to_date is not None and from_date > to_date:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Start date must be before end date")
    if (min_amount is not None or max_amount is not None) and not amount_currency:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Amount currency is required when filtering by amount")
    if min_amount is not None and max_amount is not None and min_amount > max_amount:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Minimum amount must not exceed maximum amount")
