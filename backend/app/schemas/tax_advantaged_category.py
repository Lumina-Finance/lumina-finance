"""Tax-advantaged category schemas"""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.limits import MAX_ENUM_TEXT_LENGTH, NonNegativeMinorUnits

# The years a yearly limit can be recorded for. The path that names one is held to the same range
MIN_TAX_YEAR = 1900
MAX_TAX_YEAR = 2100


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

    year: int = Field(ge=MIN_TAX_YEAR, le=MAX_TAX_YEAR)
    contribution_limit: NonNegativeMinorUnits
    withdrawal_limit: NonNegativeMinorUnits | None = None
    accrued_contributions: NonNegativeMinorUnits = 0
    accrued_withdrawals: NonNegativeMinorUnits = 0


class UpdateTaxAdvantagedCategoryLimitRequest(BaseModel):
    """Validate partial yearly TAC limit updates"""

    contribution_limit: NonNegativeMinorUnits | None = None
    withdrawal_limit: NonNegativeMinorUnits | None = None
    accrued_contributions: NonNegativeMinorUnits = 0
    accrued_withdrawals: NonNegativeMinorUnits = 0


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
    tax_treatment: str = Field(max_length=MAX_ENUM_TEXT_LENGTH)
    currency: str = Field(min_length=3, max_length=3)
    lifetime_contribution_limit: NonNegativeMinorUnits | None = None
    accrued_contributions: NonNegativeMinorUnits = 0
    counts_internal_transfers: bool = False
    group_id: uuid.UUID | None = None


class UpdateTaxAdvantagedCategoryRequest(BaseModel):
    """Validate partial tax-advantaged category updates"""

    name: str | None = Field(default=None, min_length=1, max_length=256)
    tax_treatment: str | None = Field(default=None, max_length=MAX_ENUM_TEXT_LENGTH)
    lifetime_contribution_limit: NonNegativeMinorUnits | None = None
    accrued_contributions: NonNegativeMinorUnits = 0
    counts_internal_transfers: bool = False
    group_id: uuid.UUID | None = None
