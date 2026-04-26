import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.auth import validate_iana_timezone


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
    """Replacement set for the user's runway account selection."""

    account_ids: list[uuid.UUID]


class RunwayResponse(BaseModel):
    """Runway projection in months.

    How many months the user's selected liquid balance covers at their trailing
    12-month average monthly expense.
    """

    months: float | None
    reason: Literal["no_accounts", "insufficient_history"] | None
    avg_monthly_expense: int
    months_covered: int
    liquid_balance: int
