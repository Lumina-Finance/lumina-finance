import uuid

from pydantic import BaseModel, Field


class TaxAdvantagedConfigResponse(BaseModel):
    """Per-account, per-year contribution and withdrawal limits for a tax-advantaged account."""

    account_id: uuid.UUID
    year: int
    contribution_limit: int  # Annual limit in currency base units
    withdrawal_limit: int | None  # Null means no withdrawal limit

    model_config = {"from_attributes": True}


class CreateTaxAdvantagedConfigRequest(BaseModel):
    """Create a config row for a given year on a tax-advantaged account.

    ``account_id`` comes from the URL path. Year must be a sensible calendar
    year; the route validates account kind/tax_treatment compatibility.
    """

    year: int = Field(ge=1900, le=2100)
    contribution_limit: int = Field(ge=0)
    withdrawal_limit: int | None = Field(default=None, ge=0)


class UpdateTaxAdvantagedConfigRequest(BaseModel):
    """Partial update for an existing config row. ``account_id`` and ``year`` come from the URL path."""

    contribution_limit: int | None = Field(default=None, ge=0)
    withdrawal_limit: int | None = Field(default=None, ge=0)
