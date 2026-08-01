"""Tax-advantaged category schemas"""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class TaxAdvantagedCategoryLimitResponse(BaseModel):
    """Represent per-year limits for a tax-advantaged category"""

    tax_advantaged_category_id: uuid.UUID
    year: int
    contribution_limit: int
    withdrawal_limit: int | None
    accrued_contributions: int
    accrued_withdrawals: int

    model_config = {"from_attributes": True}


class CreateTaxAdvantagedCategoryLimitRequest(BaseModel):
    """Validate per-year limit creation for a tax-advantaged category"""

    year: int = Field(ge=1900, le=2100)
    contribution_limit: int = Field(ge=0)
    withdrawal_limit: int | None = Field(default=None, ge=0)
    accrued_contributions: int = Field(default=0, ge=0)
    accrued_withdrawals: int = Field(default=0, ge=0)


class UpdateTaxAdvantagedCategoryLimitRequest(BaseModel):
    """Validate partial yearly TAC limit updates"""

    contribution_limit: int | None = Field(default=None, ge=0)
    withdrawal_limit: int | None = Field(default=None, ge=0)
    accrued_contributions: int = Field(default=0, ge=0)
    accrued_withdrawals: int = Field(default=0, ge=0)


class TaxAdvantagedCategoryResponse(BaseModel):
    """Represent a tax-advantaged category with derived limit fields"""

    id: uuid.UUID
    category_owner_user_id: uuid.UUID
    group_id: uuid.UUID | None
    name: str
    tax_treatment: str
    currency: str
    lifetime_contribution_limit: int | None
    accrued_contributions: int

    # Whether transfers with both sides inside this category count toward its limits
    counts_internal_transfers: bool
    accrued_lifetime_contribution_limit: int | None
    current_year_contribution_limit: int | None
    current_year_withdrawal_limit: int | None
    ytd_contributions: int
    ytd_withdrawals: int
    lifetime_contributions: int
    lifetime_withdrawals: int
    created_at: datetime

    model_config = {"from_attributes": True}


class CreateTaxAdvantagedCategoryRequest(BaseModel):
    """Validate tax-advantaged category creation"""

    name: str = Field(min_length=1, max_length=256)
    tax_treatment: str
    currency: str = Field(min_length=3, max_length=3)
    lifetime_contribution_limit: int | None = Field(default=None, ge=0)
    accrued_contributions: int = Field(default=0, ge=0)
    counts_internal_transfers: bool = False
    group_id: uuid.UUID | None = None


class UpdateTaxAdvantagedCategoryRequest(BaseModel):
    """Validate partial tax-advantaged category updates"""

    name: str | None = Field(default=None, min_length=1, max_length=256)
    tax_treatment: str | None = None
    lifetime_contribution_limit: int | None = Field(default=None, ge=0)
    accrued_contributions: int = Field(default=0, ge=0)
    counts_internal_transfers: bool = False
    group_id: uuid.UUID | None = None
