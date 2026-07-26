"""Schemas for insights endpoint responses"""

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.fx import FxStatus

NetWorthGroupKind = Literal["asset", "debt"]
InsightsComparisonPeriod = Literal["same_length", "previous_month", "previous_year"]
SavedInsightsRangeUnit = Literal["day", "week", "month", "quarter", "year"]

# this = current period to date, last = previous complete periods, past = rolling window
SavedInsightsRangeQualifier = Literal["this", "last", "past"]

# Guards a saved range against absurd look-backs while leaving room for any sensible window
SAVED_INSIGHTS_RANGE_MAX_AMOUNT = 999


class InsightsPeriodAtAGlanceResponse(BaseModel):
    """Compact payload for the insights Period At A Glance card"""

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
    """Payload for the insights income/expense breakdown card

    Pie rows are ``(id, name, original_category_kind, amount)``
    ``expense_total`` and ``income_total`` are authoritative center totals
    after flipped refund/loss categories are netted against their original side
    """

    expense: list[tuple[str, str, str, int]]
    income: list[tuple[str, str, str, int]]
    expense_total: int
    income_total: int
    expense_increases: list[tuple[str, str, int, int, int | None, int]]
    expense_decreases: list[tuple[str, str, int, int, int | None, int]]
    income_increases: list[tuple[str, str, int, int, int | None, int]]
    income_decreases: list[tuple[str, str, int, int, int | None, int]]
    fx_status: FxStatus = Field(default_factory=FxStatus)


class InsightsCashFlowResponse(BaseModel):
    """Payload for the insights cash-flow card."""

    points: list[tuple[date, date, int, int]]
    fx_status: FxStatus = Field(default_factory=FxStatus)


class InsightsNetWorthResponse(BaseModel):
    """Payload for the insights net-worth card."""

    groups: list[tuple[str, str, NetWorthGroupKind]]
    baseline: list[int] = Field(default_factory=list)
    points: list[tuple[date, date, list[int]]]
    fx_status: FxStatus = Field(default_factory=FxStatus)


class InsightsSavingsRateTrendResponse(BaseModel):
    """Payload for the insights savings-rate trend card."""

    points: list[tuple[date, int, int]]
    fx_status: FxStatus = Field(default_factory=FxStatus)


class InsightsMerchantDistributionResponse(BaseModel):
    """Payload for the insights merchant distribution card."""

    merchants: list[tuple[str, str, int, int | None, int | None]]


class InsightsMerchantRankingResponse(BaseModel):
    """Payload for the insights merchant ranking card."""

    merchants: list[tuple[str, str, int, int, int | None]]


class InsightsMerchantsResponse(BaseModel):
    """Shared payload for insights merchant cards."""

    distribution: list[tuple[str, str, int, int | None, int | None]]
    ranking: list[tuple[str, str, int, int, int | None]]
    fx_status: FxStatus = Field(default_factory=FxStatus)


class SavedInsightsRangeCreate(BaseModel):
    """Payload for saving a named relative insights range"""

    name: str = Field(min_length=1, max_length=64)
    amount: int = Field(ge=1, le=SAVED_INSIGHTS_RANGE_MAX_AMOUNT)
    unit: SavedInsightsRangeUnit
    qualifier: SavedInsightsRangeQualifier = "past"


class SavedInsightsRangeResponse(BaseModel):
    """A user's saved relative insights range"""

    id: uuid.UUID
    name: str
    amount: int
    unit: SavedInsightsRangeUnit
    qualifier: SavedInsightsRangeQualifier
    created_at: datetime

    model_config = {"from_attributes": True}
