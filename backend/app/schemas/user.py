"""User schemas"""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.auth import validate_iana_timezone
from app.schemas.fx import FxStatus

RUNWAY_THRESHOLD_MIN_MONTHS = 0
RUNWAY_THRESHOLD_MAX_MONTHS = 12
RUNWAY_THRESHOLD_STEP_MONTHS = 0.5
RUNWAY_THRESHOLD_MIN_SEPARATION_MONTHS = 2
RUNWAY_DEFAULT_RISKY_BELOW_MONTHS = 1
RUNWAY_DEFAULT_HEALTHY_AT_MONTHS = 3


class UserProfile(BaseModel):
    """Full user profile returned by /users/me."""

    id: uuid.UUID
    email: str
    first_name: str
    last_name: str | None
    profile_pic: str | None
    tz: str
    base_currency: str
    created_at: datetime

    model_config = {"from_attributes": True}


class CacheScopeStatus(BaseModel):
    """Latest app-data cache timestamp for one scope."""

    changed_at: datetime | None
    last_change_from_current_session: bool = False


class CacheStatus(BaseModel):
    """Latest visible app-data cache status."""

    changed_at: datetime | None
    personal: CacheScopeStatus
    groups: dict[uuid.UUID, CacheScopeStatus] = Field(default_factory=dict)


class UpdateProfileRequest(BaseModel):
    """Partial update for user profile. Only provided fields are changed."""

    first_name: str | None = Field(None, min_length=1, max_length=256)
    last_name: str | None = None
    profile_pic: str | None = None
    tz: str | None = Field(None, max_length=40)
    base_currency: str | None = Field(None, min_length=3, max_length=3)

    @field_validator("tz")
    @classmethod
    def validate_tz(cls, v: str | None) -> str | None:
        """Validate timezone names when provided."""
        if v is None:
            return v
        return validate_iana_timezone(v)


class RunwayAccountsRequest(BaseModel):
    """Replacement set for active accounts in the user's runway selection."""

    account_ids: list[uuid.UUID]


class RunwayThresholds(BaseModel):
    """User-configured runway status cutoffs."""

    risky_below_months: float = Field(
        RUNWAY_DEFAULT_RISKY_BELOW_MONTHS,
        ge=RUNWAY_THRESHOLD_MIN_MONTHS,
        le=RUNWAY_THRESHOLD_MAX_MONTHS,
    )
    healthy_at_months: float = Field(
        RUNWAY_DEFAULT_HEALTHY_AT_MONTHS,
        ge=RUNWAY_THRESHOLD_MIN_MONTHS,
        le=RUNWAY_THRESHOLD_MAX_MONTHS,
    )

    @model_validator(mode="after")
    def validate_thresholds(self) -> RunwayThresholds:
        """Validate threshold increments and minimum separation."""
        for value in (self.risky_below_months, self.healthy_at_months):
            if not _is_runway_threshold_step(value):
                msg = f"Runway thresholds must use {RUNWAY_THRESHOLD_STEP_MONTHS:g}-month increments"
                raise ValueError(msg)
        if self.healthy_at_months - self.risky_below_months < RUNWAY_THRESHOLD_MIN_SEPARATION_MONTHS:
            msg = f"Healthy threshold must be at least {RUNWAY_THRESHOLD_MIN_SEPARATION_MONTHS:g} months above risky"
            raise ValueError(msg)
        return self


class RunwaySettings(BaseModel):
    """Persisted runway settings."""

    account_ids: list[uuid.UUID]
    archived_account_ids: list[uuid.UUID] = Field(default_factory=list)
    thresholds: RunwayThresholds


class RunwayAccountBalance(BaseModel):
    """Selected runway account balance converted to the user's base currency."""

    account_id: uuid.UUID
    balance: int


class RunwayResponse(BaseModel):
    """Runway projection in months.

    How many months the user's selected active liquid balance covers at their
    trailing 12-month average monthly net expense across readable non-archived accounts.
    """

    months: float | None
    reason: Literal["no_accounts", "insufficient_history"] | None
    avg_monthly_expense: int
    months_covered: int
    liquid_balance: int
    account_balances: list[RunwayAccountBalance] = Field(default_factory=list)
    thresholds: RunwayThresholds
    fx_status: FxStatus


def _is_runway_threshold_step(value: float) -> bool:
    steps = value / RUNWAY_THRESHOLD_STEP_MONTHS
    return abs(steps - round(steps)) < 1e-9
