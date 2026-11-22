"""Budget schemas"""

import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field, model_validator

from app.models.base import RecurrenceFreq
from app.schemas.fx import FxStatus
from app.schemas.limits import PositiveMinorUnits
from app.utils.date_window import WindowDate

# Longest cadence a base budget stores, the largest value its small-integer column holds
MAX_BUDGET_INSTANCE_LENGTH = 32767

# Budgets a person keeps, archived ones included and group budgets not counted. It keeps the budget
# list and the home page's latest utilizations small, and the budgets page's add control repeats it
MAX_BASE_BUDGETS = 100

# Categories one budget tracks. It keeps a period's utilization and the budget forms small
MAX_BUDGET_CATEGORIES = 100


def validate_recurrence_anchor_fields(
    freq: RecurrenceFreq,
    weekday: int | None,
    dom: int | None,
    month: int | None,
) -> None:
    """Enforce that exactly the right anchor fields are set for a cadence

    Args:
        freq: Budget recurrence frequency
        weekday: Weekday anchor, required for weekly budgets only
        dom: Day-of-month anchor, required for monthly and yearly budgets
        month: Month anchor, required for yearly budgets only

    Raises:
        ValueError: An anchor field is missing or set for a cadence that does not use it
    """
    if freq == RecurrenceFreq.WEEKLY:
        if weekday is None:
            msg = "recurrence_weekday is required for weekly budgets"
            raise ValueError(msg)
        if dom is not None or month is not None:
            msg = "recurrence_dom and recurrence_month must be null for weekly budgets"
            raise ValueError(msg)
    elif freq == RecurrenceFreq.MONTHLY:
        if dom is None:
            msg = "recurrence_dom is required for monthly budgets"
            raise ValueError(msg)
        if weekday is not None or month is not None:
            msg = "recurrence_weekday and recurrence_month must be null for monthly budgets"
            raise ValueError(msg)
    elif freq == RecurrenceFreq.YEARLY:
        if dom is None or month is None:
            msg = "recurrence_dom and recurrence_month are required for yearly budgets"
            raise ValueError(msg)
        if weekday is not None:
            msg = "recurrence_weekday must be null for yearly budgets"
            raise ValueError(msg)


class CreateBaseBudgetRequest(BaseModel):
    """Create a new base budget. Either owner_id (inferred from user) or group_id is used."""

    name: str = Field(min_length=1, max_length=256)
    currency: str = Field(min_length=3, max_length=3)
    group_id: uuid.UUID | None = None
    recurrence_freq: RecurrenceFreq
    instance_length: int = Field(1, ge=1, le=MAX_BUDGET_INSTANCE_LENGTH)
    recurrence_weekday: int | None = Field(None, ge=0, le=6)
    recurrence_dom: int | None = Field(None, ge=1, le=31)
    recurrence_month: int | None = Field(None, ge=1, le=12)
    recurs: bool = False
    category_ids: list[uuid.UUID] = Field(min_length=1)
    period_start: WindowDate | None = None
    overall_limit: PositiveMinorUnits | None = None

    @model_validator(mode="after")
    def _validate_recurrence_field_pairing(self):
        """Enforce that exactly the right anchor fields are set for the chosen cadence."""
        validate_recurrence_anchor_fields(
            self.recurrence_freq,
            self.recurrence_weekday,
            self.recurrence_dom,
            self.recurrence_month,
        )
        if (self.period_start is None) != (self.overall_limit is None):
            msg = "period_start and overall_limit must be provided together"
            raise ValueError(msg)
        return self


class UpdateBaseBudgetRequest(BaseModel):
    """Partial update for a base budget. Cadence fields are immutable after creation."""

    name: str | None = Field(None, min_length=1, max_length=256)
    recurs: bool | None = None
    is_archived: bool | None = None
    category_ids: list[uuid.UUID] | None = Field(None, min_length=1)


class BaseBudgetResponse(BaseModel):
    """Base budget returned by list and detail endpoints."""

    id: uuid.UUID
    owner_id: uuid.UUID | None
    group_id: uuid.UUID | None
    name: str
    currency: str
    recurrence_freq: RecurrenceFreq
    instance_length: int
    recurrence_weekday: int | None
    recurrence_dom: int | None
    recurrence_month: int | None
    recurs: bool
    is_archived: bool
    created_at: datetime
    category_ids: list[uuid.UUID] = []  # Currently active tracked categories

    model_config = {"from_attributes": True}


class CreateBudgetRequest(BaseModel):
    """Create a per-period instance under a base budget

    Only period_start and overall_limit are user-provided. period_end is
    computed from the parent base's cadence settings
    """

    period_start: WindowDate
    overall_limit: PositiveMinorUnits


class UpdateBudgetRequest(BaseModel):
    """Partial update for a budget instance. Only overall_limit is editable."""

    overall_limit: PositiveMinorUnits | None = None


class BudgetResponse(BaseModel):
    """Budget instance returned by list and detail endpoints, with its parent base embedded."""

    id: uuid.UUID
    base_budget_id: uuid.UUID
    period_start: date
    period_end: date
    overall_limit: int
    created_at: datetime
    base_budget: BaseBudgetResponse

    model_config = {"from_attributes": True}


class BudgetCategoryUtilization(BaseModel):
    """Per-category spend total for a budget's period."""

    category_id: uuid.UUID
    spent: int  # Positive = net outflow in the budget's currency (minor units)


class BudgetUtilizationResponse(BaseModel):
    """Aggregated spending for a budget, grouped by tracked category

    `spent` values are positive when the net is an outflow. Currently-active
    tracked categories are included even with zero spend so the frontend can
    render all of them. A base budget's history keeps categories on its latest
    periods only, and an older period lists none while its total_spent still
    counts every category
    """

    budget_id: uuid.UUID
    period_start: date
    period_end: date
    overall_limit: int
    total_spent: int
    categories: list[BudgetCategoryUtilization]
    fx_status: FxStatus = Field(default_factory=FxStatus)


class LatestBudgetUtilizationResponse(BudgetUtilizationResponse):
    """Latest-period budget utilization with enough base metadata for summary widgets."""

    base_budget_id: uuid.UUID
    name: str
    currency: str
