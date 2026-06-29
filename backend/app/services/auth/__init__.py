"""Auth service exports"""

from app.services.auth.change_password import change_password
from app.services.auth.login import login
from app.services.auth.mfa_challenge import issue_mfa_challenge
from app.services.auth.password_reset import request_password_reset, reset_password
from app.services.auth.sessions import delete_expired_auth_sessions, delete_expired_auth_tokens
from app.services.auth.signup import signup
from app.services.auth.tokens import create_access_token, create_refresh_token
from app.services.auth.totp import begin_totp_setup, is_totp_enabled
from app.services.auth.two_factor import (
    complete_totp_enrollment,
    confirm_recovery_codes,
    confirm_totp_enrollment,
    disable_two_factor,
    regenerate_recovery_codes,
)
from app.services.auth.webauthn import (
    build_passkey_authentication_options,
    build_passkey_registration_options,
    build_passkey_second_factor_options,
    confirm_passkey_registration,
    is_passkey_registered,
    list_passkeys,
    prune_stale_passkey_staging,
    register_passkey,
    remove_passkey,
    rename_passkey,
    verify_passkey_authentication,
    verify_passkey_second_factor,
)

__all__ = [
    "begin_totp_setup",
    "build_passkey_authentication_options",
    "build_passkey_registration_options",
    "build_passkey_second_factor_options",
    "change_password",
    "complete_totp_enrollment",
    "confirm_passkey_registration",
    "confirm_recovery_codes",
    "confirm_totp_enrollment",
    "create_access_token",
    "create_refresh_token",
    "delete_expired_auth_sessions",
    "delete_expired_auth_tokens",
    "disable_two_factor",
    "is_passkey_registered",
    "is_totp_enabled",
    "issue_mfa_challenge",
    "list_passkeys",
    "login",
    "prune_stale_passkey_staging",
    "regenerate_recovery_codes",
    "register_passkey",
    "remove_passkey",
    "rename_passkey",
    "request_password_reset",
    "reset_password",
    "signup",
    "verify_passkey_authentication",
    "verify_passkey_second_factor",
]
