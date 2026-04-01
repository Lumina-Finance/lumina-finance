import uuid

from pydantic import BaseModel, Field


class InstitutionResponse(BaseModel):
    """Financial institution returned by list and detail endpoints."""

    id: uuid.UUID
    status: str
    name: str
    country_code: str
    website: str

    model_config = {"from_attributes": True}


class CreateInstitutionRequest(BaseModel):
    """User-submitted institution. Status defaults to PENDING on the server."""

    name: str = Field(min_length=1, max_length=256)
    country_code: str = Field(min_length=2, max_length=2)
    website: str = Field(min_length=1)
