import uuid
from datetime import datetime

from pydantic import BaseModel, Field


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


class RunwayAccountsRequest(BaseModel):
    """Replacement set for the user's runway account selection."""

    account_ids: list[uuid.UUID]
