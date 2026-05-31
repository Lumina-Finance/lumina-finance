from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.fx import FxStatus

NetWorthGroupKind = Literal["asset", "debt"]


class InsightsPeriodGlanceResponse(BaseModel):
    """Compact payload for the insights period-glance card."""

    income: int
    expenses: int
    income_expense_fx_status: FxStatus = Field(default_factory=FxStatus)
    net_worth_change: int
    net_worth_change_fx_status: FxStatus = Field(default_factory=FxStatus)
    top_category_name: str | None = None
    top_category_share_pct: int | None = None
    top_category_fx_status: FxStatus = Field(default_factory=FxStatus)
    biggest_change_name: str | None = None
    biggest_change_amount: int | None = None
    biggest_change_pct: int | None = None
    biggest_change_fx_status: FxStatus = Field(default_factory=FxStatus)


class InsightsFundFlowResponse(BaseModel):
    """Payload for the insights Fund Flow card."""

    income_sources: list[tuple[str, int]]
    expense_categories: list[tuple[str, int]]
    income_outflows: list[tuple[str, int]]
    expense_inflows: list[tuple[str, int]]
    income_source_count: int
    expense_category_count: int
    fx_status: FxStatus = Field(default_factory=FxStatus)


class InsightsIncomeExpenseBreakdownResponse(BaseModel):
    """Payload for the insights income/expense breakdown card.

    Pie rows are ``(id, name, original_category_kind, amount)``.
    ``expense_total`` and ``income_total`` are authoritative center totals
    after flipped refund/loss categories are netted against their original side.
    """

    expense: list[tuple[str, str, str, int]]
    income: list[tuple[str, str, str, int]]
    expense_total: int
    income_total: int
    expense_increases: list[tuple[str, str, int, int, int | None, int]]
    expense_decreases: list[tuple[str, str, int, int, int | None, int]]
    income_increases: list[tuple[str, str, int, int, int | None, int]]
    income_decreases: list[tuple[str, str, int, int, int | None, int]]


class InsightsCashFlowResponse(BaseModel):
    """Payload for the insights cash-flow card."""

    points: list[tuple[date, date, int, int]]


class InsightsNetWorthResponse(BaseModel):
    """Payload for the insights net-worth card."""

    groups: list[tuple[str, str, NetWorthGroupKind]]
    points: list[tuple[date, date, list[int]]]


class InsightsSavingsRateTrendResponse(BaseModel):
    """Payload for the insights savings-rate trend card."""

    points: list[tuple[date, int, int]]


class InsightsMerchantDistributionResponse(BaseModel):
    """Payload for the insights merchant distribution card."""

    merchants: list[tuple[str, str, int, int | None, int | None]]


class InsightsMerchantRankingResponse(BaseModel):
    """Payload for the insights merchant ranking card."""

    merchants: list[tuple[str, str, int, int, int | None]]
