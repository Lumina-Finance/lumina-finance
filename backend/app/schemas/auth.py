import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr


class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    first_name: str
    last_name: str | None = None
    tz: str  # IANA timezone (e.g., "America/Toronto")
    base_currency: str  # ISO 4217 code (e.g., "CAD")


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserInfo(BaseModel):
    """Minimal user info returned alongside auth responses."""

    id: uuid.UUID
    email: str
    first_name: str
    last_name: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class AuthResponse(BaseModel):
    """Response for signup and login — access token in body, refresh token in cookie."""

    user: UserInfo
    access_token: str
    token_type: str = "bearer"
