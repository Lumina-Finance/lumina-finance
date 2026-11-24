"""Shared provider sign-in test support: the protocol client replaced at the sign-in service seam"""

import pytest

from app.services.auth import oidc_login

ISSUER = "https://idp.test"
CLIENT_ID = "client-123"

_METADATA = {
    "issuer": ISSUER,
    "authorization_endpoint": f"{ISSUER}/authorize",
    "token_endpoint": f"{ISSUER}/token",
    "jwks_uri": f"{ISSUER}/jwks",
}


@pytest.fixture
def provider_protocol(monkeypatch):
    """Mock the protocol client at the sign-in service seam and expose the claims to return"""
    stub = {"claims": {}, "token_response": {"id_token": "signed", "access_token": "at"}}

    async def fake_metadata(issuer):
        """Serve the static discovery document"""
        return _METADATA

    async def fake_exchange(metadata, client_id, client_secret, code, code_verifier, redirect_uri):
        """Accept any code and hand back the stub token response"""
        return stub["token_response"]

    async def fake_verify(id_token, metadata, client_id, expected_nonce, max_age=None):
        """Return the stub claims as if the ID token verified"""
        return stub["claims"]

    async def fake_userinfo(metadata, access_token, expected_subject):
        """Return no additional claims"""
        return {}

    monkeypatch.setattr(oidc_login, "get_provider_metadata", fake_metadata)
    monkeypatch.setattr(oidc_login, "exchange_authorization_code", fake_exchange)
    monkeypatch.setattr(oidc_login, "verify_provider_id_token", fake_verify)
    monkeypatch.setattr(oidc_login, "fetch_userinfo", fake_userinfo)
    return stub
