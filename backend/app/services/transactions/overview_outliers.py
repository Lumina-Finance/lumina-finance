"""Transaction overview outlier conversion"""
import uuid

from app.models.account import Account
from app.schemas.fx import FxStatus
from app.schemas.transaction import OutlierTransaction
from app.services.fx import FxConverter


async def convert_overview_outliers(
    *,
    category_total_rows,
    outlier_candidate_rows,
    accounts_by_id: dict[uuid.UUID, Account],
    converter: FxConverter,
    base_currency: str,
) -> tuple[list[OutlierTransaction], FxStatus]:
    """Convert and rank overview outlier transactions

    Args:
        category_total_rows: Category total rows used to cap outlier contribution
        outlier_candidate_rows: Candidate transaction rows eligible for outlier ranking
        accounts_by_id: Account rows keyed by account ID
        converter: Request-scoped FX converter
        base_currency: User base currency used for overview metrics

    Returns:
        Top converted outlier response rows and FX status for the conversion
    """
    category_totals: dict[uuid.UUID, int] = {}

    # Convert category totals into base-currency spend caps for each outlier category
    for row in category_total_rows:
        currency = accounts_by_id[row.account_id].currency
        converted_total = await converter.convert_minor_units(
            int(row.total or 0),
            base=currency,
            quote=base_currency,
            rate_date=row.date,
        )
        if converted_total is None:
            continue

        category_totals[row.category_id] = category_totals.get(row.category_id, 0) + converted_total

    # Cap each category's outlier contribution at that category's converted spend total
    remaining_by_category = {
        category_id: -total
        for category_id, total in category_totals.items()
        if total < 0
    }

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

    outliers = []

    # Rank converted candidates and apply category caps before returning the top rows
    for row, converted_amount in sorted(converted_outlier_candidates, key=lambda item: item[1]):
        remaining = remaining_by_category.get(row.category_id, 0)
        if remaining <= 0:
            continue
        amount = -min(-converted_amount, remaining)
        remaining_by_category[row.category_id] = remaining + amount
        outliers.append(OutlierTransaction(
            id=row.id,
            merchant_name=row.merchant_name,
            notes=row.notes,
            amount=int(row.amount),
            currency=accounts_by_id[row.account_id].currency,
            dt=row.date,
        ))

    return outliers[:3], converter.get_status()
