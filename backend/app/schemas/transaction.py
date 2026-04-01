import uuid
from datetime import datetime

from pydantic import BaseModel, Field


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
    fx_rate: float | None = None
    notes: str | None = None
    tag_ids: list[uuid.UUID] = []


class UpdateTransactionRequest(BaseModel):
    """Partial update for a transaction. account_id and currency are not updatable."""

    account_id: uuid.UUID | None = None
    ts: datetime | None = None
    merchant_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    amount: int | None = None
    fx_rate: float | None = None
    notes: str | None = None
    tag_ids: list[uuid.UUID] | None = None
