"""Authentication schemas"""

import re
import uuid
from datetime import datetime
from zoneinfo import available_timezones

from pydantic import BaseModel, EmailStr, field_validator

_VALID_TIMEZONES = available_timezones()

_MIN_PASSWORD_LENGTH = 12
_MAX_PASSWORD_LENGTH = 128
_UPPERCASE_PATTERN = re.compile(r"[A-Z]")
_DIGIT_PATTERN = re.compile(r"\d")
_SPECIAL_CHARACTER_PATTERN = re.compile(r"[^A-Za-z0-9]")


def validate_iana_timezone(value: str) -> str:
    """Reject values that are not recognized IANA timezone names"""
    if value not in _VALID_TIMEZONES:
        msg = "Invalid IANA timezone"
        raise ValueError(msg)
    return value


def validate_password_strength(value: str) -> str:
    """Enforce the account password policy on a newly set password

    The policy is applied only where a password is chosen, signup, change, and reset,
    so existing users keep signing in with passwords that predate the policy
    """
    if len(value) < _MIN_PASSWORD_LENGTH:
        msg = f"Password must be at least {_MIN_PASSWORD_LENGTH} characters"
        raise ValueError(msg)
    if len(value) > _MAX_PASSWORD_LENGTH:
        msg = f"Password must be at most {_MAX_PASSWORD_LENGTH} characters"
        raise ValueError(msg)
    if not _UPPERCASE_PATTERN.search(value):
        msg = "Password must contain at least one uppercase letter"
        raise ValueError(msg)
    if not _DIGIT_PATTERN.search(value):
        msg = "Password must contain at least one number"
        raise ValueError(msg)
    if not _SPECIAL_CHARACTER_PATTERN.search(value):
        msg = "Password must contain at least one special character"
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


class ChangePasswordRequest(BaseModel):
    """Change-password payload for an authenticated user"""

    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v: str) -> str:
        """Enforce the password policy on the replacement password"""
        return validate_password_strength(v)


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
