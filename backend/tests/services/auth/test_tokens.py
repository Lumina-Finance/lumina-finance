from uuid import uuid4

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

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
from app.routes.auth import token_helpers
from app.routes.auth.token_helpers import (
    decode_access_token,
    decode_mfa_challenge_token,
    decode_native_handoff_token,
    decode_oidc_onboarding_token,
    decode_oidc_reauth_stepup_token,
    decode_refresh_token,
)
from app.services.auth import tokens
from app.services.auth.tokens import (
    SignupConfirmationClaims,
    create_access_token,
    create_mfa_challenge_token,
    create_native_handoff_token,
    create_oidc_onboarding_token,
    create_oidc_reauth_stepup_token,
    create_refresh_token,
    create_signup_confirmation_token,
    decode_signup_confirmation_token,
)
from tests.routes.support.auth_helpers import SECOND_ACCESS_KID, signed_again


@pytest.mark.parametrize("token_use", ["access", "refresh", "mfa_challenge", "oidc_onboarding", "oidc_reauth_stepup"])
def test_token_issuers_reuse_validated_signing_keys(monkeypatch, token_use):
    """Guard key parsing while exercising real signing and purpose-specific verification"""
    user_id, session_id = uuid4(), uuid4()
    issuers = {
        "access": (
            lambda: create_access_token(user_id, session_id)[0],
            decode_access_token,
            JWT_ACCESS_KID,
            JWT_ACCESS_TOKEN_EXPIRE_SECONDS,
        ),
        "refresh": (
            lambda: create_refresh_token(user_id, session_id)[0],
            decode_refresh_token,
            JWT_REFRESH_KID,
            JWT_REFRESH_TOKEN_EXPIRE_SECONDS,
        ),
        "mfa_challenge": (
            lambda: create_mfa_challenge_token(user_id)[0],
            decode_mfa_challenge_token,
            JWT_ACCESS_KID,
            MFA_CHALLENGE_TOKEN_EXPIRE_SECONDS,
        ),
        "oidc_onboarding": (
            lambda: create_oidc_onboarding_token("provider", "external-subject", "test@example.com", True, "Test", None),
            decode_oidc_onboarding_token,
            JWT_ACCESS_KID,
            OIDC_ONBOARDING_TOKEN_EXPIRE_SECONDS,
        ),
        "oidc_reauth_stepup": (
            lambda: create_oidc_reauth_stepup_token(user_id)[0],
            decode_oidc_reauth_stepup_token,
            JWT_ACCESS_KID,
            OIDC_REAUTH_STEPUP_TOKEN_EXPIRE_SECONDS,
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
        # A token names its issuer, so another issuer refuses it
        monkeypatch.setattr(token_helpers, "JWT_ISSUER", "https://other.example.test/auth")
        with pytest.raises(jwt.InvalidIssuerError):
            decode(token)
        monkeypatch.setattr(token_helpers, "JWT_ISSUER", JWT_ISSUER)


@pytest.mark.parametrize(
    "token_use", ["access", "mfa_challenge", "native_handoff", "oidc_onboarding", "oidc_reauth_stepup", "signup_confirmation"]
)
def test_every_token_signed_with_an_access_key_verifies_under_the_second_key(monkeypatch, token_use):
    """Someone midway through sign-in, a sign-up link or a step-up when the keys swap keeps going"""
    user_id, session_id = uuid4(), uuid4()
    profile = SignupConfirmationClaims(email="test@example.com", first_name="Test", last_name=None, tz="UTC", base_currency="CAD")
    flows = {
        "access": (lambda: create_access_token(user_id, session_id)[0], decode_access_token),
        "mfa_challenge": (lambda: create_mfa_challenge_token(user_id)[0], decode_mfa_challenge_token),
        "native_handoff": (lambda: create_native_handoff_token(user_id, session_id, "challenge")[0], decode_native_handoff_token),
        "oidc_onboarding": (
            lambda: create_oidc_onboarding_token("provider", "external-subject", "test@example.com", True, "Test", None),
            decode_oidc_onboarding_token,
        ),
        "oidc_reauth_stepup": (lambda: create_oidc_reauth_stepup_token(user_id)[0], decode_oidc_reauth_stepup_token),
        "signup_confirmation": (lambda: create_signup_confirmation_token(profile), decode_signup_confirmation_token),
    }
    second_private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    monkeypatch.setattr(tokens, "JWT_ACCESS_SECOND_KEY", (SECOND_ACCESS_KID, second_private_key.public_key()))
    issue, decode = flows[token_use]

    token = issue()
    assert decode(token), "the signing key's token"
    assert decode(signed_again(token, second_private_key, SECOND_ACCESS_KID)), "the second key's token"
