import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class CategoryResponse(BaseModel):
    """Category returned by list and detail endpoints."""

    id: uuid.UUID
    group_id: uuid.UUID | None
    owner_id: uuid.UUID
    name: str
    kind: str
    created_at: datetime

    model_config = {"from_attributes": True}


class CreateCategoryRequest(BaseModel):
    """Create a new category. Personal by default, or group-scoped if group_id is provided."""

    name: str = Field(min_length=1)
    kind: str  # CategoryKind enum value
    group_id: uuid.UUID | None = None


class UpdateCategoryRequest(BaseModel):
    """Partial update for a category. Only provided fields are changed."""

    name: str | None = Field(None, min_length=1)
