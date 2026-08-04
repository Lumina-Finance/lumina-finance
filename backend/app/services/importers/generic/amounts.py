"""Transaction import amount parsing"""

from fastapi import HTTPException, status

from app.models.currency import Currency
from app.utils.money import (
    DecimalAmountParseError,
    DecimalAmountPrecisionError,
    parse_decimal_amount_to_minor_units,
)


def parse_import_amount_to_minor_units(raw_amount: str, currency: Currency) -> int:
    """Parse a raw import amount into the currency's minor units

    Args:
        raw_amount: User-supplied amount string from an import row
        currency: Currency metadata used to validate decimal precision

    Returns:
        Parsed amount in the currency's minor units

    Raises:
        HTTPException: Raised with 422 when the amount is malformed, when it carries more decimal
            places than the currency holds, or when it falls outside the range the column holds
    """
    try:
        return parse_decimal_amount_to_minor_units(
            raw_amount,
            currency_code=currency.id,
            minor_unit_exponent=currency.minor_unit_exponent,
        )
    except DecimalAmountParseError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"Invalid amount: {raw_amount}") from exc
    except DecimalAmountPrecisionError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Amount has too many decimal places for {currency.id}: {raw_amount}",
        ) from exc
