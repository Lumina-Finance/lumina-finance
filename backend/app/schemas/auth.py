"""Authentication schemas"""

import re
import uuid
from datetime import datetime
from typing import Any
from zoneinfo import available_timezones

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.schemas.limits import (
    MAX_EMAIL_LENGTH,
    MAX_OIDC_SLUG_LENGTH,
    MAX_PERSON_NAME_LENGTH,
    MAX_PKCE_VERIFIER_LENGTH,
    MAX_SECOND_FACTOR_CODE_LENGTH,
    MAX_TIMEZONE_LENGTH,
    PasswordText,
    SecondFactorCode,
    Token,
)
from app.schemas.names import TrimmedName
from app.schemas.profile_preferences import ProfilePreferences

_VALID_TIMEZONES = available_timezones()

_MIN_PASSWORD_LENGTH = 12

# Matches the name column width on webauthn_credentials so the label always persists
MAX_PASSKEY_NAME_LENGTH = 100
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

    new_password: PasswordText

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v: str) -> str:
        """Enforce the password policy on the replacement password"""
        return validate_password_strength(v)


class SignupRequest(BaseModel):
    """Signup request payload"""

    email: EmailStr = Field(max_length=MAX_EMAIL_LENGTH)

    # The names travel inside the emailed link, so their length is bounded at the columns' width
    first_name: str = Field(max_length=MAX_PERSON_NAME_LENGTH)
    last_name: str | None = Field(default=None, max_length=MAX_PERSON_NAME_LENGTH)
    tz: str = Field(max_length=MAX_TIMEZONE_LENGTH)  # IANA timezone (e.g., "America/Toronto")
    base_currency: str = Field(max_length=3)  # ISO 4217 code (e.g., "CAD")

    @field_validator("tz")
    @classmethod
    def validate_tz(cls, v: str) -> str:
        """Validate timezone names at the API boundary"""
        return validate_iana_timezone(v)


class ConfirmSignupRequest(NewPasswordRequest):
    """Sign-up confirmation payload pairing the emailed token with the password the person chooses"""

    token: Token


class LoginRequest(BaseModel):
    """Login request payload"""

    email: EmailStr = Field(max_length=MAX_EMAIL_LENGTH)
    password: PasswordText


class ChangePasswordRequest(NewPasswordRequest):
    """Change-password payload for an authenticated user"""

    current_password: PasswordText
    # A current second factor, required when one is active, a passkey assertion or a TOTP code, never a
    # recovery code
    code: str | None = Field(None, max_length=MAX_SECOND_FACTOR_CODE_LENGTH)
    passkey: dict[str, Any] | None = None


class ForgotPasswordRequest(BaseModel):
    """Forgot-password request payload"""

    email: EmailStr = Field(max_length=MAX_EMAIL_LENGTH)


class ResetPasswordRequest(NewPasswordRequest):
    """Password reset payload pairing the emailed token with the new password"""

    token: Token


class ResetLinkRequest(BaseModel):
    """The emailed reset token, checked before the new password is chosen"""

    token: Token


class ResetLinkResponse(BaseModel):
    """What a reset from a still-valid link would also remove, so the form can warn first"""

    sign_in_providers_linked: int = Field(ge=0)


class ResetPasswordVerifyRequest(NewPasswordRequest):
    """Reset completion payload adding the challenge and factor code to the reset request"""

    token: Token
    mfa_token: Token
    code: SecondFactorCode


class UserInfo(ProfilePreferences):
    """Minimal user info returned alongside auth responses"""

    id: uuid.UUID
    email: str
    first_name: str
    last_name: str | None
    tz: str  # IANA timezone needed client-side so settings pages can pre-select
    base_currency: str
    created_at: datetime
    second_factor_reenrollment_required: bool  # true holds the client to the forced re-enrolment screen
    deletion_due_at: datetime | None  # set while the profile waits to be deleted, so the client shows only the cancel screen


class AuthResponse(BaseModel):
    """Response for signup and login with tokens returned through body and cookie"""

    user: UserInfo
    access_token: str
    token_type: str = "bearer"
    # Set only for a native app, which keeps it in its own credential store. A browser gets it as an
    # httpOnly cookie instead, so it is left out of the body entirely rather than sent as null
    refresh_token: str | None = Field(default=None, exclude_if=lambda token: token is None)
    # Set only for a browser, since only a browser encrypts a saved copy of the user's data with the key.
    # A native app keeps no such copy, so both are left out of its body. A browser holding a copy saved
    # under another number drops it unread. The number names the key only while the app encryption key
    # is unchanged, since rotating that key changes every key at the same number
    saved_copy_key: str | None = Field(default=None, exclude_if=lambda key: key is None)
    saved_copy_key_version: int | None = Field(default=None, exclude_if=lambda version: version is None)


class NativeRefreshTokenRequest(BaseModel):
    """A native app's refresh token, presented in the body since it has no cookie to carry it"""

    refresh_token: Token


class RegistrationStatusResponse(BaseModel):
    """Whether the login page may offer sign-up"""

    enabled: bool


class NativeExchangeRequest(BaseModel):
    """The code a web sign-in handed to the app, with the PKCE verifier only the app holds"""

    code: Token
    code_verifier: str = Field(max_length=MAX_PKCE_VERIFIER_LENGTH)


class TotpSetupResponse(BaseModel):
    """Secret and provisioning URI returned when TOTP enrolment begins"""

    secret: str  # base32 secret for manual entry
    provisioning_uri: str  # otpauth URI the client renders as a QR code


class StepUpRequest(BaseModel):
    """Password and a current second factor reauthorizing a sensitive two-factor change

    The factor is a passkey assertion or a TOTP code, never a recovery code, which is a login-only
    break-glass that routes through the destructive recovery sign-in instead
    """

    password: PasswordText
    code: str | None = Field(None, max_length=MAX_SECOND_FACTOR_CODE_LENGTH)  # a current TOTP code
    passkey: dict[str, Any] | None = None  # a passkey assertion, taking priority over a code


class RequestEmailChangeRequest(BaseModel):
    """The address an account wants to sign in with, and the step-up proving who asks

    The step-up is sent by an account with a password. A passwordless account sends none and presents
    the proof of a fresh provider reauthentication instead
    """

    new_email: EmailStr = Field(max_length=MAX_EMAIL_LENGTH)
    step_up: StepUpRequest | None = None


class ConfirmEmailChangeRequest(BaseModel):
    """The emailed token that confirms the new address"""

    token: Token


class ConfirmEmailChangeResponse(BaseModel):
    """The address the account has after the change"""

    email: str


class TotpSetupRequest(BaseModel):
    """Reauthorization gating the start of a TOTP enrolment

    The step-up is checked before the secret is minted, so a wrong current factor is refused before the
    QR is shown and enrolment is confirmed later without stepping up again. Omitted only by a forced
    re-enrol session that has no factor to present yet
    """

    step_up: StepUpRequest | None = None


class TotpConfirmRequest(BaseModel):
    """Authenticator code that confirms a pending TOTP enrolment"""

    code: SecondFactorCode


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


class PasswordResetResponse(BaseModel):
    """A finished password reset that also removed the account's linked sign-in providers

    A reset that removed none answers 204 with no body, so the count is always at least one. The
    success screen words its notice for one provider or several from it
    """

    sign_in_providers_removed: int = Field(ge=1)


class MfaVerifyRequest(BaseModel):
    """Second-factor verification pairing the challenge token with a code"""

    mfa_token: Token
    code: SecondFactorCode


class TotpStatusResponse(BaseModel):
    """Whether the current user has confirmed two-factor authentication"""

    totp_enabled: bool


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

    name: TrimmedName = Field(min_length=1, max_length=MAX_PASSKEY_NAME_LENGTH)

    # The authenticator's attestation response, passed straight to the WebAuthn library to verify
    credential: dict[str, Any]


class PasskeyAuthenticationRequest(BaseModel):
    """A finished sign-in ceremony to verify"""

    # The authenticator's assertion response, passed straight to the WebAuthn library to verify
    credential: dict[str, Any]


class PasskeyMfaOptionsRequest(BaseModel):
    """The login challenge token whose user a passkey second-factor ceremony is scoped to"""

    mfa_token: Token


class PasskeyMfaVerifyRequest(BaseModel):
    """A passkey assertion answering the second-factor step of a password login"""

    mfa_token: Token
    credential: dict[str, Any]


class PasskeyResetVerifyRequest(NewPasswordRequest):
    """A passkey assertion answering the second-factor step of a password reset"""

    token: Token
    mfa_token: Token
    credential: dict[str, Any]


class PasskeyRenameRequest(BaseModel):
    """A new label for an existing passkey"""

    name: TrimmedName = Field(min_length=1, max_length=MAX_PASSKEY_NAME_LENGTH)


class PasskeySummary(BaseModel):
    """A registered passkey as shown in the security settings list"""

    id: uuid.UUID
    name: str
    created_at: datetime
    last_used_at: datetime | None

    model_config = {"from_attributes": True}


class OidcProviderInfo(BaseModel):
    """One sign-in provider as offered on the login page"""

    slug: str
    display_name: str

    model_config = {"from_attributes": True}


class OidcProvidersResponse(BaseModel):
    """The enabled single sign-on providers the login page can offer"""

    providers: list[OidcProviderInfo]


class OidcAuthorizeResponse(BaseModel):
    """The provider URL the browser is redirected to for sign-in"""

    authorization_url: str


class OidcCallbackRequest(BaseModel):
    """The code and state the provider sent back to the callback page"""

    code: Token
    state: Token


class OidcOnboardingResponse(BaseModel):
    """Callback result for a first-time sign-in that still needs profile fields

    The token carries the verified provider claims, while the profile fields are echoed
    separately so the completion form can prefill without decoding the token
    """

    onboarding_required: bool = True
    onboarding_token: str
    email: str
    first_name: str
    last_name: str | None


class OidcReauthRequest(BaseModel):
    """The provider slug a passwordless account re-authenticates through to set a password"""

    slug: str = Field(max_length=MAX_OIDC_SLUG_LENGTH)


class SetPasswordRequest(NewPasswordRequest):
    """First-password payload for an account authorized by a provider reauth"""


class OidcSignupRequest(BaseModel):
    """Signup completion payload pairing the onboarding token with the collected profile fields"""

    onboarding_token: Token
    first_name: str = Field(max_length=MAX_PERSON_NAME_LENGTH)
    last_name: str | None = Field(None, max_length=MAX_PERSON_NAME_LENGTH)
    tz: str = Field(max_length=MAX_TIMEZONE_LENGTH)  # IANA timezone (e.g., "America/Toronto")
    base_currency: str = Field(max_length=3)  # ISO 4217 code (e.g., "CAD")

    @field_validator("tz")
    @classmethod
    def validate_tz(cls, v: str) -> str:
        """Validate timezone names at the API boundary"""
        return validate_iana_timezone(v)

    @field_validator("first_name")
    @classmethod
    def validate_first_name(cls, v: str) -> str:
        """Reject a blank first name at the API boundary"""
        trimmed = v.strip()
        if not trimmed:
            msg = "First name cannot be empty"
            raise ValueError(msg)
        return trimmed


class OidcIdentitySummary(BaseModel):
    """A linked sign-in provider as shown in the security settings list"""

    id: uuid.UUID
    provider_slug: str
    provider_display_name: str
    email: str  # email the provider asserted, required for every linked identity
    created_at: datetime
    last_login_at: datetime | None


class OidcIdentitiesResponse(BaseModel):
    """The account's linked providers and whether step-up gated actions are available

    Link and unlink step up with the password, so an account created through a provider
    must set one first, and the flag lets the client show that prompt instead
    """

    identities: list[OidcIdentitySummary]
    has_password: bool

    # Whole days a confirmed profile deletion waits before the data goes, 0 when it goes at once. The delete
    # profile dialogue reads it to show the date the deletion would be due
    profile_deletion_wait_days: int = 0


class PasskeyRegisterResponse(BaseModel):
    """The stored passkey and, for a first passkey, the recovery codes to acknowledge"""

    passkey: PasskeySummary

    # Present only when this passkey is the account's first second factor and is staged pending until
    # these shared recovery codes are saved
    recovery_codes: list[str] | None


class DiscoveryDocumentResponse(BaseModel):
    """What a token verifier reads to find the issuer's signing keys"""

    issuer: str
    jwks_uri: str
    id_token_signing_alg_values_supported: list[str]
