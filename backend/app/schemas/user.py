import uuid
from datetime import datetime

from pydantic import BaseModel


class UserProfile(BaseModel):
    """Full user profile returned by /users/me."""

    id: uuid.UUID
    email: str
    first_name: str
    last_name: str | None
    profile_pic: str | None
    tz: str
    base_currency: str
    created_at: datetime

    model_config = {"from_attributes": True}
