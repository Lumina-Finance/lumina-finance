from uuid import uuid4

import jwt
import pytest

from app.config.jwt import (
    JWT_ACCESS_KID,
    JWT_ACCESS_TOKEN_EXPIRE_SECONDS,
    JWT_ALGORITHM,
    JWT_ISSUER,
    JWT_REFRESH_KID,
    JWT_REFRESH_TOKEN_EXPIRE_SECONDS,
)
from app.config.oidc import OIDC_ONBOARDING_TOKEN_EXPIRE_SECONDS, OIDC_REAUTH_STEPUP_TOKEN_EXPIRE_SECONDS
from app.config.two_factor import MFA_CHALLENGE_TOKEN_EXPIRE_SECONDS
from app.routes.auth.token_helpers import (
    decode_access_token,
    decode_mfa_challenge_token,
    decode_oidc_onboarding_token,
    decode_oidc_reauth_stepup_token,
    decode_refresh_token,
)
from app.services.auth.tokens import (
    create_access_token,
    create_mfa_challenge_token,
    create_oidc_onboarding_token,
    create_oidc_reauth_stepup_token,
    create_refresh_token,
)


@pytest.mark.parametrize("token_use", ["access", "refresh", "mfa_challenge", "oidc_onboarding", "oidc_reauth_stepup"])
def test_token_issuers_reuse_validated_signing_keys(monkeypatch, token_use):
    """Guard key parsing while exercising real signing and purpose-specific verification"""
    user_id, session_id = uuid4(), uuid4()
    issuers = {
        "access": (
            lambda: create_access_token(user_id, session_id)[0], decode_access_token,
            JWT_ACCESS_KID, JWT_ACCESS_TOKEN_EXPIRE_SECONDS,
        ),
        "refresh": (
            lambda: create_refresh_token(user_id, session_id)[0], decode_refresh_token,
            JWT_REFRESH_KID, JWT_REFRESH_TOKEN_EXPIRE_SECONDS,
        ),
        "mfa_challenge": (
            lambda: create_mfa_challenge_token(user_id)[0], decode_mfa_challenge_token,
            JWT_ACCESS_KID, MFA_CHALLENGE_TOKEN_EXPIRE_SECONDS,
        ),
        "oidc_onboarding": (
            lambda: create_oidc_onboarding_token("provider", "external-subject", "test@example.com", True, "Test", None),
            decode_oidc_onboarding_token, JWT_ACCESS_KID, OIDC_ONBOARDING_TOKEN_EXPIRE_SECONDS,
        ),
        "oidc_reauth_stepup": (
            lambda: create_oidc_reauth_stepup_token(user_id), decode_oidc_reauth_stepup_token,
            JWT_ACCESS_KID, OIDC_REAUTH_STEPUP_TOKEN_EXPIRE_SECONDS,
        ),
    }

    def reject_reparse(*args, **kwargs):
        raise AssertionError("Signing must reuse the key validated at startup")

    # Importing the real issuers and decoders initializes their keys before this guard
    monkeypatch.setattr(jwt.algorithms, "load_pem_private_key", reject_reparse)
    issue, decode, key_id, lifetime = issuers[token_use]
    for _ in range(2):
        token = issue()
        claims = decode(token)
        header = jwt.get_unverified_header(token)
        assert header["kid"] == key_id
        assert header["alg"] == JWT_ALGORITHM
        assert claims["iss"] == JWT_ISSUER
        assert claims["aud"] == claims["token_use"] == token_use
        assert claims["exp"] - claims["iat"] == lifetime
        if token_use == "oidc_onboarding":
            assert claims["sub"] == "external-subject"
            assert claims["provider_slug"] == "provider"
            assert claims["email"] == "test@example.com"
            assert claims["email_verified"] is True
            assert claims["first_name"] == "Test"
            assert claims["last_name"] is None
        else:
            assert claims["sub"] == str(user_id)
        if token_use in {"access", "refresh"}:
            assert claims["sid"] == str(session_id)
        else:
            assert "sid" not in claims
