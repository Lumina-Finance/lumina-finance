"""Authentication schemas"""

import uuid
from datetime import datetime
from zoneinfo import available_timezones

from pydantic import BaseModel, EmailStr, field_validator

_VALID_TIMEZONES = available_timezones()


def validate_iana_timezone(value: str) -> str:
    """Reject values that are not recognized IANA timezone names"""
    if value not in _VALID_TIMEZONES:
        msg = "Invalid IANA timezone"
        raise ValueError(msg)
    return value


class SignupRequest(BaseModel):
    """Signup request payload"""

    email: EmailStr
    password: str
    first_name: str
    last_name: str | None = None
    tz: str  # IANA timezone (e.g., "America/Toronto")
    base_currency: str  # ISO 4217 code (e.g., "CAD")

    @field_validator("tz")
    @classmethod
    def validate_tz(cls, v: str) -> str:
        """Validate timezone names at the API boundary"""
        return validate_iana_timezone(v)


class LoginRequest(BaseModel):
    """Login request payload"""

    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    """Access token response payload"""

    access_token: str
    token_type: str = "bearer"


class UserInfo(BaseModel):
    """Minimal user info returned alongside auth responses"""

    id: uuid.UUID
    email: str
    first_name: str
    last_name: str | None
    tz: str  # IANA timezone needed client-side so settings pages can pre-select
    base_currency: str
    created_at: datetime

    model_config = {"from_attributes": True}


class AuthResponse(BaseModel):
    """Response for signup and login with tokens returned through body and cookie"""

    user: UserInfo
    access_token: str
    token_type: str = "bearer"
