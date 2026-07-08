"""Auth service exports"""

from app.services.auth.change_password import change_password
from app.services.auth.login import login
from app.services.auth.mfa_challenge import MFA_PURPOSE_LOGIN, MFA_PURPOSE_PASSWORD_RESET, issue_mfa_challenge
from app.services.auth.oidc_login import (
    OidcOnboardingClaims,
    begin_oidc_sign_in,
    complete_oidc_sign_in,
    complete_oidc_signup,
)
from app.services.auth.oidc_providers import (
    get_enabled_oidc_provider_by_slug,
    list_enabled_oidc_providers,
    sync_oidc_providers,
)
from app.services.auth.password_reset import (
    begin_password_reset,
    complete_password_reset,
    ensure_reset_token_active,
    request_password_reset,
)
from app.services.auth.sessions import delete_expired_auth_sessions, delete_expired_auth_tokens
from app.services.auth.signup import signup
from app.services.auth.step_up import authorize_factor_addition
from app.services.auth.tokens import create_access_token, create_oidc_onboarding_token, create_refresh_token
from app.services.auth.totp import begin_totp_setup, is_totp_enabled
from app.services.auth.two_factor import (
    SECOND_FACTOR_RECOVERY_CODE,
    complete_totp_enrollment,
    confirm_recovery_codes,
    confirm_totp_enrollment,
    disable_two_factor,
    regenerate_recovery_codes,
    remove_passkey_with_step_up,
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
    "MFA_PURPOSE_LOGIN",
    "MFA_PURPOSE_PASSWORD_RESET",
    "SECOND_FACTOR_RECOVERY_CODE",
    "OidcOnboardingClaims",
    "authorize_factor_addition",
    "begin_oidc_sign_in",
    "begin_password_reset",
    "begin_totp_setup",
    "build_passkey_authentication_options",
    "build_passkey_registration_options",
    "build_passkey_second_factor_options",
    "change_password",
    "complete_oidc_sign_in",
    "complete_oidc_signup",
    "complete_password_reset",
    "complete_totp_enrollment",
    "confirm_passkey_registration",
    "confirm_recovery_codes",
    "confirm_totp_enrollment",
    "create_access_token",
    "create_oidc_onboarding_token",
    "create_refresh_token",
    "delete_expired_auth_sessions",
    "delete_expired_auth_tokens",
    "disable_two_factor",
    "ensure_reset_token_active",
    "get_enabled_oidc_provider_by_slug",
    "is_passkey_registered",
    "is_totp_enabled",
    "issue_mfa_challenge",
    "list_enabled_oidc_providers",
    "list_passkeys",
    "login",
    "prune_stale_passkey_staging",
    "regenerate_recovery_codes",
    "register_passkey",
    "remove_passkey",
    "remove_passkey_with_step_up",
    "rename_passkey",
    "request_password_reset",
    "signup",
    "sync_oidc_providers",
    "verify_passkey_authentication",
    "verify_passkey_second_factor",
]
