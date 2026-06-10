"""Group schemas"""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class GroupResponse(BaseModel):
    """Group returned by list and detail endpoints."""

    id: uuid.UUID
    owner_id: uuid.UUID
    name: str | None
    profile_pic: str | None
    is_archived: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class CreateGroupRequest(BaseModel):
    """Create a new group. The creator becomes the owner and is auto-added as admin."""

    name: str = Field(min_length=1, max_length=128)
    profile_pic: str | None = None


class UpdateGroupRequest(BaseModel):
    """Partial update for a group. Only provided fields are changed."""

    name: str | None = Field(None, min_length=1, max_length=128)
    profile_pic: str | None = None
    is_archived: bool | None = None


class GroupMemberResponse(BaseModel):
    """A single member entry in a group."""

    group_id: uuid.UUID
    user_id: uuid.UUID
    is_admin: bool

    model_config = {"from_attributes": True}


class AddGroupMemberRequest(BaseModel):
    """Add a user to a group. New members join as non-admin."""

    user_id: uuid.UUID


class UpdateGroupMemberAdminRequest(BaseModel):
    """Promote or demote a group member. Only the owner can change admin status."""

    is_admin: bool
