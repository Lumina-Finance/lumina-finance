"""Tag schemas"""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator
from pydantic.json_schema import SkipJsonSchema


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

    # None represents omission internally, while explicit null is rejected
    name: str | SkipJsonSchema[None] = Field(None, min_length=1, max_length=64)

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


class MergeTagRequest(BaseModel):
    """Move tag references to another tag, then delete the source."""

    replacement_tag_id: uuid.UUID
