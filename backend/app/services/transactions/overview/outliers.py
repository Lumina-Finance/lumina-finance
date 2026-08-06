"""Transaction overview outlier conversion"""
import uuid

from app.models.account import Account
from app.schemas.fx import FxStatus
from app.schemas.transaction import OutlierTransaction
from app.services.fx import FxConverter

# How many transactions the most expensive transactions panel has room for
_OVERVIEW_OUTLIER_LIMIT = 3


async def convert_overview_outliers(
    *,
    outlier_candidate_rows,
    accounts_by_id: dict[uuid.UUID, Account],
    converter: FxConverter,
    base_currency: str,
) -> tuple[list[OutlierTransaction], FxStatus]:
    """Convert and rank overview outlier transactions

    Args:
        outlier_candidate_rows: Candidate transaction rows eligible for outlier ranking
        accounts_by_id: Account rows keyed by account ID
        converter: Request-scoped FX converter
        base_currency: User base currency used for overview metrics

    Returns:
        Top converted outlier response rows and FX status for the conversion
    """
    converted_outlier_candidates = []

    # Convert candidate transactions so outliers can be ranked across account currencies
    for row in outlier_candidate_rows:
        currency = accounts_by_id[row.account_id].currency
        converted_amount = await converter.convert_minor_units(
            int(row.amount),
            base=currency,
            quote=base_currency,
            rate_date=row.date,
        )
        if converted_amount is None or converted_amount >= 0:
            continue

        converted_outlier_candidates.append((row, converted_amount))

    # Rank by each transaction's own converted outflow, so a purchase refunded later still counts
    converted_outlier_candidates.sort(key=lambda candidate: candidate[1])
    outliers = [
        OutlierTransaction(
            id=row.id,
            merchant_name=row.merchant_name,
            notes=row.notes,
            amount=int(row.amount),
            currency=accounts_by_id[row.account_id].currency,
            dt=row.date,
        )
        for row, _converted_amount in converted_outlier_candidates[:_OVERVIEW_OUTLIER_LIMIT]
    ]
    return outliers, converter.get_status()
