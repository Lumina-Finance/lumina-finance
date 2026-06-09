"""Budget utilization services"""
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.budget import BaseBudget, Budget, BudgetPermission, BudgetTrackedCategory
from app.models.currency import Currency
from app.models.group import GroupMember
from app.models.transaction import Transaction
from app.schemas.budget import BudgetCategoryUtilization, BudgetUtilizationResponse, LatestBudgetUtilizationResponse
from app.services.fx import FxConverter


async def _get_currency_exponents(db: AsyncSession, currencies: set[str]) -> dict[str, int]:
    """Return minor-unit exponents keyed by currency code

    Args:
        db: Active database session
        currencies: Currency codes to load

    Returns:
        Minor-unit exponents keyed by currency code
    """
    # Fetch each currency's decimal precision so converted minor-unit amounts stay correctly scaled
    result = await db.execute(
        select(Currency.id, Currency.minor_unit_exponent).where(Currency.id.in_(currencies)),
    )
    return {row.id: row.minor_unit_exponent for row in result}


async def _get_tracked_category_ids_by_budget(
    db: AsyncSession,
    budget_ids: list[uuid.UUID],
) -> dict[uuid.UUID, list[uuid.UUID]]:
    """Return tracked category IDs keyed by budget instance ID

    Args:
        db: Active database session
        budget_ids: Budget instance identifiers to inspect

    Returns:
        Tracked category identifiers keyed by budget instance identifier
    """
    # Fetch categories tracked by each budget's base budget during that budget period
    result = await db.execute(
        select(Budget.id, BudgetTrackedCategory.category_id)
        .join(BudgetTrackedCategory, BudgetTrackedCategory.base_budget_id == Budget.base_budget_id)
        .where(
            Budget.id.in_(budget_ids),
            BudgetTrackedCategory.added_at <= Budget.period_end,
            (BudgetTrackedCategory.removed_at.is_(None)) | (BudgetTrackedCategory.removed_at > Budget.period_end),
        )
        .distinct(),
    )
    tracked_category_ids_by_budget: dict[uuid.UUID, list[uuid.UUID]] = {}
    for budget_id, category_id in result:
        tracked_category_ids_by_budget.setdefault(budget_id, []).append(category_id)
    return tracked_category_ids_by_budget


async def _get_budget_spend_rows(db: AsyncSession, budget_ids: list[uuid.UUID]):
    """Return aggregated spend rows for budget utilization

    Args:
        db: Active database session
        budget_ids: Budget instance identifiers to inspect

    Returns:
        Aggregated spend rows grouped by budget, category, account, date, and currency pair
    """
    # Fetch spend that falls inside each budget period and belongs to the matching personal or group account scope
    result = await db.execute(
        select(
            Budget.id,
            Transaction.category_id,
            Transaction.account_id,
            Transaction.dt.label("date"),
            Account.currency.label("account_currency"),
            BaseBudget.currency.label("budget_currency"),
            func.sum(Transaction.amount).label("amount_sum"),
        )
        .join(BaseBudget, Budget.base_budget_id == BaseBudget.id)
        .join(
            BudgetTrackedCategory,
            (BudgetTrackedCategory.base_budget_id == BaseBudget.id)
            & (BudgetTrackedCategory.added_at <= Budget.period_end)
            & (
                (BudgetTrackedCategory.removed_at.is_(None))
                | (BudgetTrackedCategory.removed_at > Budget.period_end)
            ),
        )
        .join(Transaction, Transaction.category_id == BudgetTrackedCategory.category_id)
        .join(Account, Transaction.account_id == Account.id)
        .where(
            Budget.id.in_(budget_ids),
            Transaction.dt >= Budget.period_start,
            Transaction.dt <= Budget.period_end,
            (
                (BaseBudget.group_id.is_not(None) & (Account.group_id == BaseBudget.group_id))
                | (BaseBudget.group_id.is_(None) & (Account.owner_id == BaseBudget.owner_id))
            ),
        )
        .group_by(
            Budget.id,
            Transaction.category_id,
            Transaction.account_id,
            Transaction.dt,
            Account.currency,
            BaseBudget.currency,
        ),
    )
    return result.all()


async def _get_latest_budget_rows(db: AsyncSession, user_id: uuid.UUID) -> list[tuple[Budget, BaseBudget]]:
    """Return latest budget instance rows for visible base budgets

    Args:
        db: Active database session
        user_id: Authenticated user identifier

    Returns:
        Latest budget instance rows with parent base budget rows
    """
    # Rank visible budget instances so each accessible base budget contributes only its newest period
    ranked_budget_ids = (
        select(
            Budget.id.label("budget_id"),
            func.row_number()
            .over(
                partition_by=Budget.base_budget_id,
                order_by=(Budget.period_start.desc(), Budget.created_at.desc()),
            )
            .label("rank"),
        )
        .join(BaseBudget, Budget.base_budget_id == BaseBudget.id)
        .outerjoin(GroupMember, BaseBudget.group_id == GroupMember.group_id)
        .outerjoin(
            BudgetPermission,
            (BudgetPermission.base_budget_id == BaseBudget.id) & (BudgetPermission.user_id == user_id),
        )
        .where(
            (BaseBudget.owner_id == user_id)
            | ((GroupMember.user_id == user_id) & (GroupMember.is_admin.is_(True)))
            | (BudgetPermission.user_id == user_id),
        )
        .subquery()
    )
    # Fetch the latest visible budget instance for each base budget in display order
    result = await db.execute(
        select(Budget, BaseBudget)
        .join(BaseBudget, Budget.base_budget_id == BaseBudget.id)
        .join(ranked_budget_ids, Budget.id == ranked_budget_ids.c.budget_id)
        .where(ranked_budget_ids.c.rank == 1)
        .order_by(BaseBudget.name),
    )
    return result.all()


def _create_converter_with_cached_rates(converter: FxConverter) -> FxConverter:
    """Return a converter with copied FX cache state

    Args:
        converter: Converter whose cached rates should be reused

    Returns:
        Independent converter with copied rates and failure tracking
    """
    budget_converter = FxConverter(
        provider=converter.provider,
        currency_exponents=converter.currency_exponents,
    )
    budget_converter.rates = converter.rates.copy()
    budget_converter.failed_rates = converter.failed_rates.copy()
    return budget_converter


async def _prefetch_budget_rates(converter: FxConverter, spend_rows) -> None:
    """Prefetch FX rates needed for budget spend rows

    Args:
        converter: Converter that will cache the fetched rates
        spend_rows: Aggregated spend rows with account and budget currencies
    """
    date_ranges_by_currency_pair: dict[tuple[str, str], tuple] = {}
    for row in spend_rows:
        base = row.account_currency
        quote = row.budget_currency
        if base == quote:
            continue
        start_date, end_date = date_ranges_by_currency_pair.get((base, quote), (row.date, row.date))
        date_ranges_by_currency_pair[(base, quote)] = (min(start_date, row.date), max(end_date, row.date))

    for (base, quote), (start_date, end_date) in sorted(date_ranges_by_currency_pair.items()):
        await converter.prefetch_rates(
            base=base,
            quote=quote,
            start_date=start_date,
            end_date=end_date,
        )


def _get_spend_rows_by_budget(spend_rows) -> dict[uuid.UUID, list]:
    """Return spend rows keyed by budget instance ID

    Args:
        spend_rows: Aggregated spend rows to group

    Returns:
        Spend rows keyed by budget instance identifier
    """
    spend_rows_by_budget: dict[uuid.UUID, list] = {}
    for row in spend_rows:
        spend_rows_by_budget.setdefault(row.id, []).append(row)
    return spend_rows_by_budget


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
        return []

    # Load tracked category history and matching spend before FX conversion
    budget_ids = [budget.id for budget, _ in budget_rows]
    tracked_category_ids_by_budget = await _get_tracked_category_ids_by_budget(db, budget_ids)
    spend_rows = await _get_budget_spend_rows(db, budget_ids)

    # Prime one converter with all needed rates, then isolate FX status per budget
    converter = FxConverter(
        currency_exponents=await _get_currency_exponents(
            db,
            {
                *(base_budget.currency for _, base_budget in budget_rows),
                *(row.account_currency for row in spend_rows),
            },
        ),
    )
    await _prefetch_budget_rates(converter, spend_rows)

    spend_rows_by_budget = _get_spend_rows_by_budget(spend_rows)

    responses = []
    for budget, base_budget in budget_rows:
        budget_converter = _create_converter_with_cached_rates(converter)
        spend_by_category = {
            category_id: 0
            for category_id in tracked_category_ids_by_budget.get(budget.id, [])
        }
        # Store debits as positive spend in the budget currency
        for row in spend_rows_by_budget.get(budget.id, []):
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
            for category_id in tracked_category_ids_by_budget.get(budget.id, [])
        ]
        responses.append(
            BudgetUtilizationResponse(
                budget_id=budget.id,
                period_start=budget.period_start,
                period_end=budget.period_end,
                overall_limit=budget.overall_limit,
                total_spent=sum(category.spent for category in categories),
                categories=categories,
                fx_status=budget_converter.get_status(),
            ),
        )
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
    budget_rows = await _get_latest_budget_rows(db, user_id)
    utilizations = await get_budget_utilization_responses(db, budget_rows)
    return [
        LatestBudgetUtilizationResponse(
            **utilization.model_dump(),
            base_budget_id=base_budget.id,
            name=base_budget.name,
            currency=base_budget.currency,
        )
        for utilization, (_, base_budget) in zip(utilizations, budget_rows, strict=True)
    ]
