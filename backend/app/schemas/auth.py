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

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        """Enforce the password policy when an account is created"""
        return validate_password_strength(v)


class LoginRequest(BaseModel):
    """Login request payload"""

    email: EmailStr
    password: str


class ChangePasswordRequest(BaseModel):
    """Change-password payload for an authenticated user"""

    current_password: str
    new_password: str
    code: str | None = None  # current TOTP or recovery code, required when two-factor is enabled

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v: str) -> str:
        """Enforce the password policy on the replacement password"""
        return validate_password_strength(v)


class ForgotPasswordRequest(BaseModel):
    """Forgot-password request payload"""

    email: EmailStr


class ResetPasswordRequest(BaseModel):
    """Password reset payload pairing the emailed token with the new password"""

    token: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v: str) -> str:
        """Enforce the password policy on the replacement password"""
        return validate_password_strength(v)


class UserInfo(BaseModel):
    """Minimal user info returned alongside auth responses"""

    id: uuid.UUID
    email: str
    first_name: str
    last_name: str | None
    tz: str  # IANA timezone needed client-side so settings pages can pre-select
    base_currency: str
    created_at: datetime
    totp_reenrollment_required: bool  # true holds the client to the forced re-enrolment screen

    model_config = {"from_attributes": True}


class AuthResponse(BaseModel):
    """Response for signup and login with tokens returned through body and cookie"""

    user: UserInfo
    access_token: str
    token_type: str = "bearer"


class TotpSetupResponse(BaseModel):
    """Secret and provisioning URI returned when TOTP enrolment begins"""

    secret: str  # base32 secret for manual entry
    provisioning_uri: str  # otpauth URI the client renders as a QR code


class TotpConfirmRequest(BaseModel):
    """Authenticator code that confirms a pending TOTP enrolment"""

    code: str


class DisableTotpRequest(BaseModel):
    """Password and a current authenticator code authorizing TOTP to be disabled"""

    password: str
    code: str  # a current TOTP code, recovery codes are not accepted for step-up


class RegenerateRecoveryCodesRequest(BaseModel):
    """Password and a current authenticator code authorizing a fresh recovery code batch"""

    password: str
    code: str  # a current TOTP code, recovery codes are not accepted for step-up


class RecoveryCodesResponse(BaseModel):
    """One-time recovery codes shown once after enrolment or regeneration"""

    recovery_codes: list[str]


class MfaRequiredResponse(BaseModel):
    """Login result when a verified password still needs a second factor"""

    mfa_required: bool = True
    mfa_token: str  # short-lived challenge token exchanged at the verify endpoint
    recovery_only: bool = False  # true once the authenticator is revoked, so only a recovery code works


class MfaVerifyRequest(BaseModel):
    """Second-factor verification pairing the challenge token with a code"""

    mfa_token: str
    code: str


class TotpStatusResponse(BaseModel):
    """Whether the current user has confirmed two-factor authentication"""

    totp_enabled: bool
