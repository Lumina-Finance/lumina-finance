import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field

from app.models.base import RecurrenceFreq


class CreateBudgetRequest(BaseModel):
    """Create a new budget. Either owner_id or household_id is set by the route."""

    name: str = Field(min_length=1, max_length=256)
    period_start: date
    period_end: date
    currency: str = Field(min_length=3, max_length=3)
    household_id: uuid.UUID | None = None
    base_budget_id: uuid.UUID | None = None
    recurrence_freq: RecurrenceFreq | None = None
    recurrence_interval: int | None = Field(None, ge=1)
    overall_limit: int | None = None
    category_ids: list[uuid.UUID] = []


class UpdateBudgetRequest(BaseModel):
    """Partial update for a budget. Only provided fields are changed."""

    name: str | None = Field(None, min_length=1, max_length=256)
    period_start: date | None = None
    period_end: date | None = None
    recurrence_freq: RecurrenceFreq | None = None
    recurrence_interval: int | None = Field(None, ge=1)
    overall_limit: int | None = None
    category_ids: list[uuid.UUID] | None = None


class BudgetResponse(BaseModel):
    """Budget returned by list and detail endpoints."""

    id: uuid.UUID
    owner_id: uuid.UUID | None
    household_id: uuid.UUID | None
    base_budget_id: uuid.UUID | None
    name: str
    period_start: date
    period_end: date
    recurrence_freq: RecurrenceFreq | None
    recurrence_interval: int | None
    overall_limit: int | None
    currency: str
    created_at: datetime
    category_ids: list[uuid.UUID] = []

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
    overall_limit: int | None
    total_spent: int
    categories: list[BudgetCategoryUtilization]
