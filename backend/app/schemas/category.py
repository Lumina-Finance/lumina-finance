"""Category schemas"""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator
from pydantic.json_schema import SkipJsonSchema

from app.schemas.names import TrimmedName


class CategoryResponse(BaseModel):
    """Category returned by list and detail endpoints."""

    id: uuid.UUID
    group_id: uuid.UUID | None
    owner_id: uuid.UUID | None
    name: str
    kind: str
    icon: str | None
    is_system: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class CreateCategoryRequest(BaseModel):
    """Create a new category. Personal by default, or group-scoped if group_id is provided."""

    name: TrimmedName = Field(min_length=1)
    kind: str  # CategoryKind enum value
    icon: str | None = None
    group_id: uuid.UUID | None = None


class UpdateCategoryRequest(BaseModel):
    """Partial update for a category. Only provided fields are changed."""

    # None represents omission internally, while explicit null is rejected
    name: TrimmedName | SkipJsonSchema[None] = Field(None, min_length=1)
    icon: str | None = None

    @field_validator("name", mode="before")
    @classmethod
    def reject_explicit_null_name(cls, value: object) -> object:
        """Reject a supplied null name while leaving omitted names unchanged

        Args:
            value: Name as supplied in the request body

        Returns:
            The value for normal name validation

        Raises:
            ValueError: The supplied name is null
        """
        if value is None:
            raise ValueError("must not be null")
        return value


class MergeCategoryRequest(BaseModel):
    """Move category references to another category, then delete the source."""

    replacement_category_id: uuid.UUID
