"""Income-to-expenses Sankey service for the insights page."""

import uuid
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import CategoryKind
from app.models.category import Category
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.insights import InsightsIncomeExpenseFlowResponse
from app.services.insights.common import get_base_currency_accounts


async def _query_flow_entries(
    db: AsyncSession,
    account_ids: list[uuid.UUID],
    from_date: date,
    to_date: date,
) -> tuple[
    list[tuple[str, int]],
    list[tuple[str, int]],
    list[tuple[str, int]],
    list[tuple[str, int]],
]:
    """Return sign-directed category totals for the Sankey card."""
    result = await db.execute(
        select(
            Category.name,
            Category.kind,
            func.sum(Transaction.amount).label("total"),
        )
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.account_id.in_(account_ids),
            Category.kind.in_([CategoryKind.INCOME, CategoryKind.EXPENSE]),
            Transaction.dt >= from_date,
            Transaction.dt <= to_date,
        )
        .group_by(Category.id, Category.name, Category.kind),
    )

    inflows: list[tuple[str, int]] = []
    outflows: list[tuple[str, int]] = []
    expense_inflows: list[tuple[str, int]] = []
    income_outflows: list[tuple[str, int]] = []
    for row in result:
        total = int(row.total or 0)
        if total > 0:
            inflows.append((row.name, total))
            if row.kind == CategoryKind.EXPENSE:
                expense_inflows.append((row.name, total))
        elif total < 0:
            amount = -total
            outflows.append((row.name, amount))
            if row.kind == CategoryKind.INCOME:
                income_outflows.append((row.name, amount))

    def sorted_entries(entries: list[tuple[str, int]]) -> list[tuple[str, int]]:
        return sorted(entries, key=lambda entry: (-entry[1], entry[0]))

    return (
        sorted_entries(inflows),
        sorted_entries(outflows),
        sorted_entries(income_outflows),
        sorted_entries(expense_inflows),
    )


async def get_income_expense_flow(
    db: AsyncSession,
    user: User,
    from_date: date,
    to_date: date,
) -> InsightsIncomeExpenseFlowResponse:
    """Return all positive entries for the income-to-expenses Sankey card."""
    base_currency_accounts = await get_base_currency_accounts(db, user)
    account_ids = [account.id for account in base_currency_accounts]

    if not account_ids:
        return InsightsIncomeExpenseFlowResponse(
            income_sources=[],
            expense_categories=[],
            income_outflows=[],
            expense_inflows=[],
            income_source_count=0,
            expense_category_count=0,
        )

    income_sources, expense_categories, income_outflows, expense_inflows = await _query_flow_entries(
        db,
        account_ids,
        from_date,
        to_date,
    )

    return InsightsIncomeExpenseFlowResponse(
        income_sources=income_sources,
        expense_categories=expense_categories,
        income_outflows=income_outflows,
        expense_inflows=expense_inflows,
        income_source_count=len(income_sources),
        expense_category_count=len(expense_categories),
    )
