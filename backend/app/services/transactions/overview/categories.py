"""Transaction overview category conversion"""
import uuid

from app.models.account import Account
from app.schemas.fx import FxStatus
from app.schemas.transaction import TopCategorySpend
from app.services.fx import FxConverter


async def convert_overview_top_categories(
    *,
    category_total_rows,
    accounts_by_id: dict[uuid.UUID, Account],
    converter: FxConverter,
    base_currency: str,
) -> tuple[list[TopCategorySpend], FxStatus]:
    """Convert and rank top spending categories for the overview

    Args:
        category_total_rows: Category total rows grouped by account and date
        accounts_by_id: Account rows keyed by account ID
        converter: Request-scoped FX converter
        base_currency: User base currency used for overview metrics

    Returns:
        Top converted category response rows and FX status for the conversion
    """
    category_totals: dict[uuid.UUID, tuple[str, int]] = {}

    # Convert account-level category rows into base-currency totals grouped by category
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

        name, current_total = category_totals.get(row.category_id, (row.category_name, 0))
        category_totals[row.category_id] = (name, current_total + converted_total)

    # A category counts as spending only while its refunds leave the total negative, so one that
    # refunds cancel out drops from the list rather than being ranked last
    top_categories = [
        TopCategorySpend(category_id=category_id, category_name=name, total=total)
        for category_id, (name, total) in category_totals.items()
        if total < 0
    ]
    top_categories.sort(key=lambda category: category.total)
    return top_categories[:5], converter.get_status()
