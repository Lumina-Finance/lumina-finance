"""Tag schemas"""

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field, field_validator
from pydantic.json_schema import SkipJsonSchema

from app.schemas.import_run import MAX_IMPORT_MAPPINGS, MAX_IMPORT_TAG_NAME_LENGTH
from app.schemas.names import TrimmedName

# One tag name asked about, as long as a tag can be named. The import page lists a file's longer
# names as rows that won't import and never asks about them, so one reaching here is refused loudly
# rather than matched
TagNameMatchName = Annotated[TrimmedName, Field(min_length=1, max_length=MAX_IMPORT_TAG_NAME_LENGTH)]


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


class TagNameMatchRequest(BaseModel):
    """Tag names from a file, asked about together.

    The import page asks this rather than holding every tag, since the list endpoint answers a page
    at a time. A name longer than a tag may be is refused, as the import page never asks about one.
    """

    names: list[TagNameMatchName] = Field(min_length=1, max_length=MAX_IMPORT_MAPPINGS)


class TagNameMatch(BaseModel):
    """One tag name and the tag an import would file its rows under."""

    # The value exactly as it was asked about, so the caller reads the answer back against what it
    # sent rather than applying the matching rule a second time
    source: str
    tag: TagResponse
