import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class CategoryResponse(BaseModel):
    """Category returned by list and detail endpoints."""

    id: uuid.UUID
    household_id: uuid.UUID | None
    owner_id: uuid.UUID
    name: str
    kind: str
    parent_id: uuid.UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}


class CreateCategoryRequest(BaseModel):
    """Create a new category. Personal by default, or household-scoped if household_id is provided."""

    name: str = Field(min_length=1)
    kind: str  # CategoryKind enum value
    parent_id: uuid.UUID | None = None
    household_id: uuid.UUID | None = None


class UpdateCategoryRequest(BaseModel):
    """Partial update for a category. Only provided fields are changed."""

    name: str | None = Field(None, min_length=1)
    parent_id: uuid.UUID | None = None
