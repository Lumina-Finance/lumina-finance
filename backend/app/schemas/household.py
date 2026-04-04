import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class HouseholdResponse(BaseModel):
    """Household returned by list and detail endpoints."""

    id: uuid.UUID
    owner_id: uuid.UUID
    name: str | None
    profile_pic: str | None
    is_archived: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class CreateHouseholdRequest(BaseModel):
    """Create a new household. The creator becomes the owner and is auto-added as admin."""

    name: str = Field(min_length=1, max_length=128)
    profile_pic: str | None = None


class UpdateHouseholdRequest(BaseModel):
    """Partial update for a household. Only provided fields are changed."""

    name: str | None = Field(None, min_length=1, max_length=128)
    profile_pic: str | None = None
    is_archived: bool | None = None


class HouseholdMemberResponse(BaseModel):
    """A single member entry in a household."""

    household_id: uuid.UUID
    user_id: uuid.UUID
    is_admin: bool

    model_config = {"from_attributes": True}


class AddHouseholdMemberRequest(BaseModel):
    """Add a user to a household. New members join as non-admin."""

    user_id: uuid.UUID


class UpdateHouseholdMemberAdminRequest(BaseModel):
    """Promote or demote a household member. Only the owner can change admin status."""

    is_admin: bool
