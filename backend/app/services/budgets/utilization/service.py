"""Budget utilization services"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.budget import BaseBudget, Budget
from app.schemas.budget import BudgetCategoryUtilization, BudgetUtilizationResponse, LatestBudgetUtilizationResponse
from app.services.budgets.utilization.conversion_helpers import (
    create_converter_with_cached_rates,
    get_spend_rows_by_budget,
    prefetch_budget_rates,
)
from app.services.budgets.utilization.query_helpers import (
    get_budget_spend_rows,
    get_currency_exponents,
    get_latest_budget_rows,
    get_tracked_category_ids_by_budget,
)
from app.services.fx import FxConverter


async def get_budget_utilization_responses(
    db: AsyncSession,
    budget_rows: list[tuple[Budget, BaseBudget]],
) -> list[BudgetUtilizationResponse]:
    """Return utilization responses for budget instances

    Args:
        db: Active database session
        budget_rows: Budget instance rows with their parent base budget rows

    Returns:
        Utilization responses with per-category spend totals in budget currency
    """
    if not budget_rows:
        responses: list[BudgetUtilizationResponse] = []
        return responses

    # Load tracked category history and matching spend before FX conversion
    budget_ids = [budget.id for budget, _ in budget_rows]
    tracked_category_ids_by_budget = await get_tracked_category_ids_by_budget(db, budget_ids)
    spend_rows = await get_budget_spend_rows(db, budget_ids)

    # Prime one converter with all needed rates, then isolate FX status per budget
    currencies = {
        *(base_budget.currency for _, base_budget in budget_rows),
        *(row.account_currency for row in spend_rows),
    }
    currency_exponents = await get_currency_exponents(db, currencies)
    converter = FxConverter(currency_exponents=currency_exponents)
    await prefetch_budget_rates(converter, spend_rows)

    spend_rows_by_budget = get_spend_rows_by_budget(spend_rows)

    responses: list[BudgetUtilizationResponse] = []
    for budget, base_budget in budget_rows:
        budget_response = await _get_budget_utilization_response(
            budget,
            base_budget,
            tracked_category_ids_by_budget.get(budget.id, []),
            spend_rows_by_budget.get(budget.id, []),
            converter,
        )
        responses.append(budget_response)
    return responses


async def get_latest_budget_utilization_responses(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> list[LatestBudgetUtilizationResponse]:
    """Return latest utilization responses for visible base budgets

    Args:
        db: Active database session
        user_id: Authenticated user identifier

    Returns:
        Latest budget utilization responses ordered by base budget name
    """
    budget_rows = await get_latest_budget_rows(db, user_id)
    utilizations = await get_budget_utilization_responses(db, budget_rows)
    latest_responses = [
        LatestBudgetUtilizationResponse(
            **utilization.model_dump(),
            base_budget_id=base_budget.id,
            name=base_budget.name,
            currency=base_budget.currency,
        )
        for utilization, (_, base_budget) in zip(utilizations, budget_rows, strict=True)
    ]
    return latest_responses


async def _get_budget_utilization_response(
    budget: Budget,
    base_budget: BaseBudget,
    tracked_category_ids: list[uuid.UUID],
    spend_rows: list,
    shared_converter: FxConverter,
) -> BudgetUtilizationResponse:
    """Return utilization response for one budget instance

    Args:
        budget: Budget instance being summarized
        base_budget: Parent base budget for shared budget settings
        tracked_category_ids: Category identifiers tracked by the budget during the period
        spend_rows: Aggregated spend rows belonging to the budget
        shared_converter: Converter with prefetched FX rates for all budgets

    Returns:
        Utilization response with spend totals and FX status for one budget
    """
    budget_converter = create_converter_with_cached_rates(shared_converter)
    spend_by_category = {
        category_id: 0
        for category_id in tracked_category_ids
    }

    # Store debits as positive spend in the budget currency
    for row in spend_rows:
        converted_amount = await budget_converter.convert_minor_units(
            int(row.amount_sum or 0),
            base=row.account_currency,
            quote=base_budget.currency,
            rate_date=row.date,
        )
        if converted_amount is None:
            continue

        spend_by_category[row.category_id] = spend_by_category.get(row.category_id, 0) - converted_amount

    categories = [
        BudgetCategoryUtilization(
            category_id=category_id,
            spent=spend_by_category.get(category_id, 0),
        )
        for category_id in tracked_category_ids
    ]
    response = BudgetUtilizationResponse(
        budget_id=budget.id,
        period_start=budget.period_start,
        period_end=budget.period_end,
        overall_limit=budget.overall_limit,
        total_spent=sum(category.spent for category in categories),
        categories=categories,
        fx_status=budget_converter.get_status(),
    )
    return response
