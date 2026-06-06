import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class TaxAdvantagedPlanLimitResponse(BaseModel):
    """Per-year limits for a tax-advantaged plan."""

    plan_id: uuid.UUID
    year: int
    contribution_limit: int
    withdrawal_limit: int | None
    accrued_contributions: int
    accrued_withdrawals: int

    model_config = {"from_attributes": True}


class CreateTaxAdvantagedPlanLimitRequest(BaseModel):
    """Create a per-year limit row for a tax-advantaged plan."""

    year: int = Field(ge=1900, le=2100)
    contribution_limit: int = Field(ge=0)
    withdrawal_limit: int | None = Field(default=None, ge=0)
    accrued_contributions: int = Field(default=0, ge=0)
    accrued_withdrawals: int = Field(default=0, ge=0)


class UpdateTaxAdvantagedPlanLimitRequest(BaseModel):
    """Partial update for a per-year plan limit row."""

    contribution_limit: int | None = Field(default=None, ge=0)
    withdrawal_limit: int | None = Field(default=None, ge=0)
    accrued_contributions: int = Field(default=0, ge=0)
    accrued_withdrawals: int = Field(default=0, ge=0)


class TaxAdvantagedPlanResponse(BaseModel):
    """Tax-advantaged plan plus derived limit fields."""

    id: uuid.UUID
    plan_owner_user_id: uuid.UUID
    group_id: uuid.UUID | None
    name: str
    tax_treatment: str
    currency: str
    lifetime_contribution_limit: int | None
    accrued_contributions: int
    accrued_lifetime_contribution_limit: int | None
    current_year_contribution_limit: int | None
    current_year_withdrawal_limit: int | None
    ytd_contributions: int
    ytd_withdrawals: int
    lifetime_contributions: int
    lifetime_withdrawals: int
    created_at: datetime

    model_config = {"from_attributes": True}


class CreateTaxAdvantagedPlanRequest(BaseModel):
    """Create an individual-owned tax-advantaged plan."""

    name: str = Field(min_length=1, max_length=256)
    tax_treatment: str
    currency: str = Field(min_length=3, max_length=3)
    lifetime_contribution_limit: int | None = Field(default=None, ge=0)
    accrued_contributions: int = Field(default=0, ge=0)
    group_id: uuid.UUID | None = None


class UpdateTaxAdvantagedPlanRequest(BaseModel):
    """Partial update for a tax-advantaged plan."""

    name: str | None = Field(default=None, min_length=1, max_length=256)
    tax_treatment: str | None = None
    lifetime_contribution_limit: int | None = Field(default=None, ge=0)
    accrued_contributions: int = Field(default=0, ge=0)
    group_id: uuid.UUID | None = None
