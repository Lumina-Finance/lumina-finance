"""Budget utilization query helpers"""

import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.budget import BaseBudget, Budget, BudgetPermission, BudgetTrackedCategory
from app.models.currency import Currency
from app.models.group import GroupMember
from app.models.transaction import Transaction


async def get_currency_exponents(db: AsyncSession, currencies: set[str]) -> dict[str, int]:
    """Return minor-unit exponents keyed by currency code

    Args:
        db: Active database session
        currencies: Currency codes to load

    Returns:
        Minor-unit exponents keyed by currency code
    """
    if not currencies:
        currency_exponents: dict[str, int] = {}
        return currency_exponents

    # Fetch each currency's decimal precision so converted minor-unit amounts stay correctly scaled
    currency_query = select(Currency.id, Currency.minor_unit_exponent).where(Currency.id.in_(currencies))

    result = await db.execute(currency_query)
    currency_exponents = {row.id: row.minor_unit_exponent for row in result}
    return currency_exponents


async def get_tracked_category_ids_by_budget(
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
    if not budget_ids:
        tracked_category_ids_by_budget: dict[uuid.UUID, list[uuid.UUID]] = {}
        return tracked_category_ids_by_budget

    # Fetch categories tracked by each budget's base budget during that budget period
    tracked_categories_query = (
        select(Budget.id, BudgetTrackedCategory.category_id)
        .join(BudgetTrackedCategory, BudgetTrackedCategory.base_budget_id == Budget.base_budget_id)
        .where(
            Budget.id.in_(budget_ids),
            BudgetTrackedCategory.added_at <= Budget.period_end,
            (BudgetTrackedCategory.removed_at.is_(None)) | (BudgetTrackedCategory.removed_at > Budget.period_end),
        )
        .distinct()
    )

    result = await db.execute(tracked_categories_query)
    tracked_category_ids_by_budget: dict[uuid.UUID, list[uuid.UUID]] = {}
    for budget_id, category_id in result:
        tracked_category_ids_by_budget.setdefault(budget_id, []).append(category_id)
    return tracked_category_ids_by_budget


async def get_budget_spend_rows(db: AsyncSession, budget_ids: list[uuid.UUID]) -> list[Any]:
    """Return aggregated spend rows for budget utilization

    Args:
        db: Active database session
        budget_ids: Budget instance identifiers to inspect

    Returns:
        Aggregated spend rows grouped by budget, category, account, date, and currency pair
    """
    if not budget_ids:
        spend_rows: list[Any] = []
        return spend_rows

    # Fetch spend inside each budget period for the matching personal or group account scope
    budget_spend_query = (
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
        )
    )

    result = await db.execute(budget_spend_query)
    spend_rows = list(result.all())
    return spend_rows


async def get_latest_budget_rows(db: AsyncSession, user_id: uuid.UUID) -> list[tuple[Budget, BaseBudget]]:
    """Return latest budget instance rows for visible base budgets

    Args:
        db: Active database session
        user_id: Authenticated user identifier

    Returns:
        Latest budget instance rows with parent base budget rows
    """
    rank_window = func.row_number().over(
        partition_by=Budget.base_budget_id,
        order_by=(Budget.period_start.desc(), Budget.created_at.desc()),
    )

    # Rank visible budget instances so each accessible base budget contributes only its newest period
    ranked_budget_ids = (
        select(
            Budget.id.label("budget_id"),
            rank_window.label("rank"),
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
    latest_budgets_query = (
        select(Budget, BaseBudget)
        .join(BaseBudget, Budget.base_budget_id == BaseBudget.id)
        .join(ranked_budget_ids, Budget.id == ranked_budget_ids.c.budget_id)
        .where(ranked_budget_ids.c.rank == 1)
        .order_by(BaseBudget.name)
    )

    result = await db.execute(latest_budgets_query)
    budget_rows = list(result.all())
    return budget_rows
