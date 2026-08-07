"""Merchant schemas"""

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field

from app.schemas.names import TrimmedName
from app.schemas.transaction import MAX_IMPORT_MAPPINGS

# One payee value asked about, bounded by the column merchants are stored in. A lookup asks about at
# most what one import may declare mappings for, since the import page is what asks it
MerchantNameMatchName = Annotated[TrimmedName, Field(min_length=1, max_length=256)]


class MerchantResponse(BaseModel):
    """Merchant returned by list and detail endpoints."""

    id: uuid.UUID
    owner_id: uuid.UUID | None  # Null on a system merchant, which belongs to everyone
    group_id: uuid.UUID | None
    name: str

    # System merchants ship with the app: they cannot be renamed, deleted, or given a default category
    is_system: bool
    default_category_id: uuid.UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}


class CreateMerchantRequest(BaseModel):
    """Create a new merchant. Personal by default, or group-scoped if group_id is provided."""

    name: TrimmedName = Field(min_length=1, max_length=256)
    default_category_id: uuid.UUID | None = None
    group_id: uuid.UUID | None = None


class UpdateMerchantRequest(BaseModel):
    """Partial update for a merchant. Only provided fields are changed."""

    name: TrimmedName | None = Field(None, min_length=1, max_length=256)
    default_category_id: uuid.UUID | None = None


class MergeMerchantRequest(BaseModel):
    """Move merchant references to another merchant, then delete the source."""

    replacement_merchant_id: uuid.UUID


class MerchantNameMatchRequest(BaseModel):
    """Payee values from a file, asked about together.

    The import page asks this rather than holding every merchant a user has, since a person can
    build up thousands of them while the list endpoint answers a page at a time.
    """

    names: list[MerchantNameMatchName] = Field(min_length=1, max_length=MAX_IMPORT_MAPPINGS)


class MerchantNameMatch(BaseModel):
    """One payee value and the merchant an import would file its rows under."""

    # The value exactly as it was asked about, so the caller can read the answer back against what
    # it sent rather than applying the matching rule a second time
    source: str
    merchant: MerchantResponse
