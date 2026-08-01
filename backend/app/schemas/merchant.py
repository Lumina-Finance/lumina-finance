"""Merchant schemas"""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


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

    name: str = Field(min_length=1, max_length=256)
    default_category_id: uuid.UUID | None = None
    group_id: uuid.UUID | None = None


class UpdateMerchantRequest(BaseModel):
    """Partial update for a merchant. Only provided fields are changed."""

    name: str | None = Field(None, min_length=1, max_length=256)
    default_category_id: uuid.UUID | None = None


class MergeMerchantRequest(BaseModel):
    """Move merchant references to another merchant, then delete the source."""

    replacement_merchant_id: uuid.UUID
