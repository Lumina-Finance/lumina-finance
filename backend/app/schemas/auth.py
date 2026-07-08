"""Authentication schemas"""

import re
import uuid
from datetime import datetime
from typing import Any
from zoneinfo import available_timezones

from pydantic import BaseModel, EmailStr, field_validator

_VALID_TIMEZONES = available_timezones()

_MIN_PASSWORD_LENGTH = 12
_MAX_PASSWORD_LENGTH = 128

# Matches the name column width on webauthn_credentials so the label always persists
_MAX_PASSKEY_NAME_LENGTH = 100
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


class NewPasswordRequest(BaseModel):
    """Base for every payload that sets a replacement password under the shared policy"""

    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v: str) -> str:
        """Enforce the password policy on the replacement password"""
        return validate_password_strength(v)


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


class ChangePasswordRequest(NewPasswordRequest):
    """Change-password payload for an authenticated user"""

    current_password: str
    # A current second factor, required when one is active, a passkey assertion or a TOTP code, never a
    # recovery code
    code: str | None = None
    passkey: dict[str, Any] | None = None


class ForgotPasswordRequest(BaseModel):
    """Forgot-password request payload"""

    email: EmailStr


class ResetPasswordRequest(NewPasswordRequest):
    """Password reset payload pairing the emailed token with the new password"""

    token: str


class ResetPasswordVerifyRequest(NewPasswordRequest):
    """Reset completion payload adding the challenge and factor code to the reset request"""

    token: str
    mfa_token: str
    code: str


class UserInfo(BaseModel):
    """Minimal user info returned alongside auth responses"""

    id: uuid.UUID
    email: str
    first_name: str
    last_name: str | None
    tz: str  # IANA timezone needed client-side so settings pages can pre-select
    base_currency: str
    created_at: datetime
    second_factor_reenrollment_required: bool  # true holds the client to the forced re-enrolment screen

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


class StepUpRequest(BaseModel):
    """Password and a current second factor reauthorizing a sensitive two-factor change

    The factor is a passkey assertion or a TOTP code, never a recovery code, which is a login-only
    break-glass that routes through the destructive recovery sign-in instead
    """

    password: str
    code: str | None = None  # a current TOTP code
    passkey: dict[str, Any] | None = None  # a passkey assertion, taking priority over a code


class TotpSetupRequest(BaseModel):
    """Reauthorization gating the start of a TOTP enrolment

    The step-up is checked before the secret is minted, so a wrong current factor is refused before the
    QR is shown and enrolment is confirmed later without stepping up again. Omitted only by a forced
    re-enrol session that has no factor to present yet
    """

    step_up: StepUpRequest | None = None


class TotpConfirmRequest(BaseModel):
    """Authenticator code that confirms a pending TOTP enrolment"""

    code: str


class RecoveryCodesResponse(BaseModel):
    """One-time recovery codes shown once after enrolment or regeneration"""

    recovery_codes: list[str]


class MfaRequiredResponse(BaseModel):
    """Login result when a verified password still needs a second factor"""

    mfa_required: bool = True
    mfa_token: str  # short-lived challenge token exchanged at the verify endpoint
    totp_enabled: bool = False  # an authenticator code can be used
    passkey_available: bool = False  # a passkey can be used, the preferred factor when present
    recovery_only: bool = False  # no usable factor remains, so only a recovery code works


class MfaVerifyRequest(BaseModel):
    """Second-factor verification pairing the challenge token with a code"""

    mfa_token: str
    code: str


class TotpStatusResponse(BaseModel):
    """Whether the current user has confirmed two-factor authentication"""

    totp_enabled: bool


def validate_passkey_name(value: str) -> str:
    """Trim a passkey label and reject one that is empty or too long for the column"""
    trimmed = value.strip()
    if not trimmed:
        msg = "Passkey name cannot be empty"
        raise ValueError(msg)
    if len(trimmed) > _MAX_PASSKEY_NAME_LENGTH:
        msg = f"Passkey name must be at most {_MAX_PASSKEY_NAME_LENGTH} characters"
        raise ValueError(msg)
    return trimmed


class PasskeyConfigResponse(BaseModel):
    """Public passkey settings the client needs before starting a ceremony"""

    rp_id: str  # relying party id the browser binds a passkey to, blank when passkeys are unconfigured


class PasskeyRegistrationOptionsRequest(BaseModel):
    """Reauthorization gating the start of a passkey registration ceremony

    The step-up is checked before the challenge is issued, so the browser never runs a registration
    ceremony until the current factor verifies, and the passkey is added only afterwards. Omitted only
    by a forced re-enrol session that has no factor to present yet
    """

    step_up: StepUpRequest | None = None


class PasskeyRegisterRequest(BaseModel):
    """A finished registration ceremony paired with the label to store it under"""

    name: str

    # The authenticator's attestation response, passed straight to the WebAuthn library to verify
    credential: dict[str, Any]

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        """Normalize the label at the API boundary"""
        return validate_passkey_name(v)


class PasskeyAuthenticationRequest(BaseModel):
    """A finished sign-in ceremony to verify"""

    # The authenticator's assertion response, passed straight to the WebAuthn library to verify
    credential: dict[str, Any]


class PasskeyMfaOptionsRequest(BaseModel):
    """The login challenge token whose user a passkey second-factor ceremony is scoped to"""

    mfa_token: str


class PasskeyMfaVerifyRequest(BaseModel):
    """A passkey assertion answering the second-factor step of a password login"""

    mfa_token: str
    credential: dict[str, Any]


class PasskeyResetVerifyRequest(NewPasswordRequest):
    """A passkey assertion answering the second-factor step of a password reset"""

    token: str
    mfa_token: str
    credential: dict[str, Any]


class PasskeyRenameRequest(BaseModel):
    """A new label for an existing passkey"""

    name: str

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        """Normalize the label at the API boundary"""
        return validate_passkey_name(v)


class PasskeySummary(BaseModel):
    """A registered passkey as shown in the security settings list"""

    id: uuid.UUID
    name: str
    created_at: datetime
    last_used_at: datetime | None

    model_config = {"from_attributes": True}


class PasskeyRegisterResponse(BaseModel):
    """The stored passkey and, for a first passkey, the recovery codes to acknowledge"""

    passkey: PasskeySummary

    # Present only when this passkey is the account's first second factor and is staged pending until
    # these shared recovery codes are saved
    recovery_codes: list[str] | None
