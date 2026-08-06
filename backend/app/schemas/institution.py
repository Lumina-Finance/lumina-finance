"""Institution schemas"""

import uuid

from pydantic import BaseModel, Field, field_validator


class InstitutionResponse(BaseModel):
    """Financial institution returned by the list, detail and correction endpoints, and embedded in AccountResponse."""

    id: uuid.UUID
    status: str
    name: str
    country_code: str
    website: str
    logo_url: str | None = None

    model_config = {"from_attributes": True}


class CreateInstitutionRequest(BaseModel):
    """User-submitted institution. Status defaults to PENDING on the server."""

    name: str = Field(min_length=1, max_length=256)
    country_code: str = Field(min_length=2, max_length=2)
    website: str = Field(min_length=1)
    logo_url: str | None = None


class UpdateInstitutionRequest(BaseModel):
    """User-submitted correction to an institution. Only provided fields are changed."""

    name: str | None = Field(None, min_length=1, max_length=256)
    country_code: str | None = Field(None, min_length=2, max_length=2)
    website: str | None = Field(None, min_length=1)
    logo_url: str | None = None

    @field_validator("name", "country_code", "website", mode="before")
    @classmethod
    def reject_explicit_null(cls, value: str | None) -> str | None:
        """Reject a null on a column that cannot hold one

        A field left out of the request never reaches this, so only a client that sent
        null is rejected. logo_url is left out because clearing the logo is a correction
        someone can legitimately make

        Args:
            value: Field value as it arrived in the request body

        Returns:
            The value unchanged

        Raises:
            ValueError: The field was sent as null
        """
        if value is None:
            msg = "must not be null"
            raise ValueError(msg)
        return value
