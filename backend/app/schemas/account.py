import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class AccountResponse(BaseModel):
    """Full account returned by list and detail endpoints."""

    id: uuid.UUID
    owner_id: uuid.UUID | None
    group_id: uuid.UUID | None
    account_kind: str
    account_type: str
    tax_treatment: str
    name: str
    institution_id: uuid.UUID | None
    currency: str
    lifetime_contribution_limit: int | None
    is_hidden: bool
    closed_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class CreateAccountRequest(BaseModel):
    """Create a new account. Either personal (default) or group-scoped."""

    account_type: str  # AccountType enum value
    tax_treatment: str = "taxable"  # TaxTreatment enum value
    name: str = Field(min_length=1, max_length=256)
    institution_id: uuid.UUID | None = None
    currency: str = Field(min_length=3, max_length=3)
    lifetime_contribution_limit: int | None = None
    is_hidden: bool = False
    group_id: uuid.UUID | None = None


class UpdateAccountRequest(BaseModel):
    """Partial update for an account. Only provided fields are changed."""

    tax_treatment: str | None = None
    name: str | None = Field(None, min_length=1, max_length=256)
    institution_id: uuid.UUID | None = None
    lifetime_contribution_limit: int | None = None
    is_hidden: bool | None = None
    closed_at: datetime | None = None


class AccountBalanceSnapshotResponse(BaseModel):
    """End-of-day balance record. Backend-maintained, derived from transactions.

    `ts` is always midnight UTC of the snapshot's day.
    """

    account_id: uuid.UUID
    balance: int  # In currency base units
    ts: datetime

    model_config = {"from_attributes": True}
