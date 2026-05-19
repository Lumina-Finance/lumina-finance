from datetime import date

from pydantic import BaseModel


class InsightsPeriodGlanceResponse(BaseModel):
    """Compact payload for the insights period-glance card."""

    income: int
    expenses: int
    net_worth_change: int
    top_category_name: str | None = None
    top_category_share_pct: int | None = None
    biggest_change_name: str | None = None
    biggest_change_amount: int | None = None
    biggest_change_pct: int | None = None


class InsightsIncomeExpenseFlowResponse(BaseModel):
    """Payload for the insights income-to-expenses Sankey card."""

    income_sources: list[tuple[str, int]]
    expense_categories: list[tuple[str, int]]
    income_outflows: list[tuple[str, int]]
    expense_inflows: list[tuple[str, int]]
    income_source_count: int
    expense_category_count: int


class InsightsIncomeExpenseBreakdownResponse(BaseModel):
    """Payload for the insights income/expense breakdown card."""

    expense: list[tuple[str, str, int]]
    income: list[tuple[str, str, int]]
    expense_increases: list[tuple[str, str, int, int, int | None, int]]
    expense_decreases: list[tuple[str, str, int, int, int | None, int]]
    income_increases: list[tuple[str, str, int, int, int | None, int]]
    income_decreases: list[tuple[str, str, int, int, int | None, int]]


class InsightsNetWorthResponse(BaseModel):
    """Payload for the insights net-worth card."""

    groups: list[tuple[str, str, str]]
    points: list[tuple[date, date, list[int]]]
