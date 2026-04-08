import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field

from app.models.base import RecurrenceFreq


class CreateBaseBudgetRequest(BaseModel):
    """Create a new base budget. Either owner_id (inferred from user) or group_id is used."""

    name: str = Field(min_length=1, max_length=256)
    currency: str = Field(min_length=3, max_length=3)
    group_id: uuid.UUID | None = None
    recurrence_freq: RecurrenceFreq | None = None
    recurrence_interval: int | None = Field(None, ge=1)
    category_ids: list[uuid.UUID] = []


class UpdateBaseBudgetRequest(BaseModel):
    """Partial update for a base budget. Only provided fields are changed."""

    name: str | None = Field(None, min_length=1, max_length=256)
    recurrence_freq: RecurrenceFreq | None = None
    recurrence_interval: int | None = Field(None, ge=1)
    category_ids: list[uuid.UUID] | None = None


class BaseBudgetResponse(BaseModel):
    """Base budget returned by list and detail endpoints."""

    id: uuid.UUID
    owner_id: uuid.UUID | None
    group_id: uuid.UUID | None
    name: str
    currency: str
    recurrence_freq: RecurrenceFreq | None
    recurrence_interval: int | None
    created_at: datetime
    category_ids: list[uuid.UUID] = []  # Currently active tracked categories

    model_config = {"from_attributes": True}


class CreateBudgetRequest(BaseModel):
    """Create a per-period instance under a base budget. base_budget_id comes from the route path."""

    period_start: date
    period_end: date
    overall_limit: int = Field(..., gt=0)


class UpdateBudgetRequest(BaseModel):
    """Partial update for a budget instance. Only provided fields are changed."""

    period_start: date | None = None
    period_end: date | None = None
    overall_limit: int | None = Field(None, gt=0)


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
    """Aggregated spending for a budget, grouped by tracked category.

    `spent` values are positive when the net is an outflow. Currently-active
    tracked categories are always included even with zero spend so the
    frontend can render all of them.
    """

    budget_id: uuid.UUID
    period_start: date
    period_end: date
    overall_limit: int
    total_spent: int
    categories: list[BudgetCategoryUtilization]
