"""Tag schemas"""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class TagResponse(BaseModel):
    """Tag returned by list and detail endpoints."""

    id: uuid.UUID
    group_id: uuid.UUID | None
    owner_id: uuid.UUID
    name: str
    created_at: datetime

    model_config = {"from_attributes": True}


class CreateTagRequest(BaseModel):
    """Create a new tag. Personal by default, or group-scoped if group_id is provided."""

    name: str = Field(min_length=1, max_length=64)
    group_id: uuid.UUID | None = None


class UpdateTagRequest(BaseModel):
    """Partial update for a tag. Only provided fields are changed."""

    name: str | None = Field(None, min_length=1, max_length=64)


class MergeTagRequest(BaseModel):
    """Move tag references to another tag, then delete the source."""

    replacement_tag_id: uuid.UUID
