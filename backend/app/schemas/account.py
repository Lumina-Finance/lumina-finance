import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field

from app.schemas.institution import InstitutionResponse


class AccountsOverview(BaseModel):
    """One row in `GET /accounts` — the trimmed shape used by the /accounts page and dashboard.

    Excludes `lifetime_contribution_limit` and `created_at` (detail-only fields). Tax-advantaged
    tallies and current-year limits are also detail-only and live on AccountResponse.
    """

    id: uuid.UUID
    owner_id: uuid.UUID | None
    group_id: uuid.UUID | None
    account_kind: str
    account_type: str
    tax_treatment: str
    name: str
    institution: InstitutionResponse | None
    currency: str
    current_balance: int
    credit_limit: int | None
    is_hidden: bool
    closed_at: datetime | None

    model_config = {"from_attributes": True}


class AccountResponse(BaseModel):
    """Full account detail returned by `GET /accounts/{id}`, `POST /accounts`, and `PATCH /accounts/{id}`."""

    id: uuid.UUID
    owner_id: uuid.UUID | None
    group_id: uuid.UUID | None
    account_kind: str
    account_type: str
    tax_treatment: str
    name: str
    institution: InstitutionResponse | None
    currency: str
    current_balance: int
    lifetime_contribution_limit: int | None
    credit_limit: int | None
    # Tax-advantaged tallies. None when tax_treatment == taxable.
    # Lifetime tallies are additionally None when lifetime_contribution_limit is unset.
    ytd_contributions: int | None
    ytd_withdrawals: int | None
    lifetime_contributions: int | None
    lifetime_withdrawals: int | None
    # Current-year tax-advantaged limits sourced from TaxAdvantagedConfig.
    # None when no config row exists for the current UTC year (or for taxable accounts).
    current_year_contribution_limit: int | None
    current_year_withdrawal_limit: int | None
    is_hidden: bool
    closed_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class CreateAccountRequest(BaseModel):
    """Create a new account. Either personal (default) or group-scoped."""

    account_kind: str  # AccountKind enum value — must be consistent with account_type
    account_type: str  # AccountType enum value
    tax_treatment: str = "taxable"  # TaxTreatment enum value
    name: str = Field(min_length=1, max_length=256)
    institution_id: uuid.UUID | None = None
    currency: str = Field(min_length=3, max_length=3)
    lifetime_contribution_limit: int | None = None
    credit_limit: int | None = None  # Only valid on liability accounts
    is_hidden: bool = False
    group_id: uuid.UUID | None = None


class UpdateAccountRequest(BaseModel):
    """Partial update for an account. Only provided fields are changed."""

    tax_treatment: str | None = None
    name: str | None = Field(None, min_length=1, max_length=256)
    institution_id: uuid.UUID | None = None
    lifetime_contribution_limit: int | None = None
    credit_limit: int | None = None  # Only valid on liability accounts
    is_hidden: bool | None = None
    closed_at: datetime | None = None


class AccountBalanceSnapshotResponse(BaseModel):
    """End-of-day balance record. Backend-maintained, derived from transactions."""

    account_id: uuid.UUID
    balance: int  # In currency base units
    dt: date

    model_config = {"from_attributes": True}
