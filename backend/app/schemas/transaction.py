import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field


class TopCategorySpend(BaseModel):
    """One row in the top-categories breakdown."""

    category_id: uuid.UUID
    category_name: str
    total: int


class DailyCashFlow(BaseModel):
    """Inflow and outflow totals for a single day."""

    date: date
    inflow: int
    outflow: int


class OutlierTransaction(BaseModel):
    """A single large-spend transaction surfaced as unusual."""

    id: uuid.UUID
    merchant_name: str | None
    notes: str | None
    amount: int
    ts: datetime


class TransactionsOverview(BaseModel):
    """Aggregated metrics for the transactions page header.

    Nullable fields signal "no data for this period" — the frontend can
    show a placeholder instead of rendering empty charts.
    """

    total_inflow: int | None
    total_outflow: int | None
    top_categories: list[TopCategorySpend] | None
    daily_cash_flow: list[DailyCashFlow] | None
    outliers: list[OutlierTransaction] | None


class TransactionResponse(BaseModel):
    """Transaction returned by list and detail endpoints."""

    id: uuid.UUID
    created_by_user_id: uuid.UUID
    account_id: uuid.UUID
    ts: datetime
    merchant_id: uuid.UUID | None
    category_id: uuid.UUID
    amount: int
    currency: str
    fx_rate: float | None
    notes: str | None
    created_at: datetime
    updated_at: datetime
    tag_ids: list[uuid.UUID] = []

    model_config = {"from_attributes": True}


class CreateTransactionRequest(BaseModel):
    """Create a new transaction for the authenticated user."""

    account_id: uuid.UUID
    ts: datetime
    category_id: uuid.UUID
    amount: int
    currency: str = Field(min_length=3, max_length=3)
    merchant_id: uuid.UUID | None = None
    fx_rate: float | None = Field(None, gt=0)
    notes: str | None = None
    tag_ids: list[uuid.UUID] = []


class UpdateTransactionRequest(BaseModel):
    """Partial update for a transaction. account_id and currency are not updatable."""

    account_id: uuid.UUID | None = None
    ts: datetime | None = None
    merchant_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    amount: int | None = None
    fx_rate: float | None = Field(None, gt=0)
    notes: str | None = None
    tag_ids: list[uuid.UUID] | None = None
