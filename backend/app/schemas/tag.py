import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class TagResponse(BaseModel):
    """Tag returned by list and detail endpoints."""

    id: uuid.UUID
    owner_id: uuid.UUID
    name: str
    created_at: datetime

    model_config = {"from_attributes": True}


class CreateTagRequest(BaseModel):
    """Create a new tag for the authenticated user."""

    name: str = Field(min_length=1, max_length=64)


class UpdateTagRequest(BaseModel):
    """Partial update for a tag. Only provided fields are changed."""

    name: str | None = Field(None, min_length=1, max_length=64)
