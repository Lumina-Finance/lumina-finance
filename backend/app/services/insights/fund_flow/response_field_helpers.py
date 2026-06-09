"""Response field helpers for fund-flow insights"""

from dataclasses import dataclass
from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import CategoryKind
from app.schemas.fx import FxStatus
from app.services.insights.fund_flow.category_total_helpers import (
    FundFlowCategoryTotals,
    get_converted_fund_flow_category_totals,
)

FundFlowAmountRow = tuple[str, int]


@dataclass(frozen=True)
class FundFlowResponseFields:
    """Store converted values for the Fund Flow response fields

    Attributes:
        income_sources: Positive income-category rows
        expense_categories: Positive expense-category rows after sign normalization
        income_outflows: Negative income-category rows shown as outflows
        expense_inflows: Positive expense-category rows shown as inflows
        fx_status: FX conversion status for the response fields
    """

    income_sources: list[FundFlowAmountRow]
    expense_categories: list[FundFlowAmountRow]
    income_outflows: list[FundFlowAmountRow]
    expense_inflows: list[FundFlowAmountRow]
    fx_status: FxStatus


async def get_fund_flow_response_fields(
    db: AsyncSession,
    accounts: list[Account],
    base_currency: str,
    from_date: date,
    to_date: date,
) -> FundFlowResponseFields:
    """Return converted values for the Fund Flow response fields

    Args:
        db: Active database session
        accounts: Accounts included in the fund-flow insight
        base_currency: User base currency used for converted values
        from_date: Inclusive fund-flow range start date
        to_date: Inclusive fund-flow range end date

    Returns:
        Converted response field values and FX status
    """
    if not accounts:
        fx_status = FxStatus()
        response_fields = FundFlowResponseFields(
            income_sources=[],
            expense_categories=[],
            income_outflows=[],
            expense_inflows=[],
            fx_status=fx_status,
        )
        return response_fields

    converted_totals = await get_converted_fund_flow_category_totals(
        db,
        accounts,
        base_currency,
        from_date,
        to_date,
    )
    response_fields = _get_response_fields_from_category_totals(
        converted_totals.category_totals,
        converted_totals.fx_status,
    )
    return response_fields


def _get_response_fields_from_category_totals(
    category_totals: FundFlowCategoryTotals,
    fx_status: FxStatus,
) -> FundFlowResponseFields:
    """Return Fund Flow response fields from signed category totals

    Args:
        category_totals: Converted category totals keyed by category ID
        fx_status: FX conversion status from category total conversion

    Returns:
        Fund Flow response field values
    """
    income_sources: list[FundFlowAmountRow] = []
    expense_categories: list[FundFlowAmountRow] = []
    income_outflows: list[FundFlowAmountRow] = []
    expense_inflows: list[FundFlowAmountRow] = []

    # Split signed category totals into the four Fund Flow response fields
    for name, kind, total in category_totals.values():
        if total > 0:
            income_sources.append((name, total))
            if kind == CategoryKind.EXPENSE:
                expense_inflows.append((name, total))
        elif total < 0:
            amount = -total
            expense_categories.append((name, amount))
            if kind == CategoryKind.INCOME:
                income_outflows.append((name, amount))

    response_fields = FundFlowResponseFields(
        income_sources=_get_sorted_fund_flow_amount_rows(income_sources),
        expense_categories=_get_sorted_fund_flow_amount_rows(expense_categories),
        income_outflows=_get_sorted_fund_flow_amount_rows(income_outflows),
        expense_inflows=_get_sorted_fund_flow_amount_rows(expense_inflows),
        fx_status=fx_status,
    )
    return response_fields


def _get_sorted_fund_flow_amount_rows(rows: list[FundFlowAmountRow]) -> list[FundFlowAmountRow]:
    """Return fund-flow amount rows sorted by amount and name

    Args:
        rows: Fund-flow amount rows to sort

    Returns:
        Rows sorted by descending amount and then ascending name
    """
    sorted_rows = sorted(rows, key=lambda row: (-row[1], row[0]))
    return sorted_rows
