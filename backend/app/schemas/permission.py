"""Permission schemas"""

import uuid
from datetime import datetime

from pydantic import BaseModel

from app.models.base import PermissionLevel

# --- Account permissions ---


class GrantAccountPermissionRequest(BaseModel):
    """Grant or update a member's access level on a group account."""

    user_id: uuid.UUID
    level: PermissionLevel


class AccountPermissionResponse(BaseModel):
    """Account permission returned by list and detail endpoints."""

    id: uuid.UUID
    group_id: uuid.UUID
    user_id: uuid.UUID
    account_id: uuid.UUID
    level: PermissionLevel
    created_at: datetime

    model_config = {"from_attributes": True}


# --- Budget permissions ---


class GrantBudgetPermissionRequest(BaseModel):
    """Grant or update a member's access level on a group budget."""

    user_id: uuid.UUID
    level: PermissionLevel


class BudgetPermissionResponse(BaseModel):
    """Budget permission returned by list and detail endpoints."""

    id: uuid.UUID
    group_id: uuid.UUID
    user_id: uuid.UUID
    base_budget_id: uuid.UUID
    level: PermissionLevel
    created_at: datetime

    model_config = {"from_attributes": True}
