"""OIDC sign-in route tests with the provider protocol mocked at the service seam"""

import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse

import jwt as pyjwt
import pytest
from sqlalchemy import select

from app.encryption import encrypt
from app.models.auth import AuthIdentity
from app.models.base import AuthProvider
from app.models.oidc import OidcAuthorizationRequest, OidcIdentity, OidcProvider
from app.models.user import User
from app.services.auth import oidc_login
from app.services.auth.token_hashing import hash_token
from tests.conftest import TestSession
from tests.routes.support import SIGNUP_PAYLOAD, _seed_currency

ISSUER = "https://idp.test"
CLIENT_ID = "client-123"

_METADATA = {
    "issuer": ISSUER,
    "authorization_endpoint": f"{ISSUER}/authorize",
    "token_endpoint": f"{ISSUER}/token",
    "jwks_uri": f"{ISSUER}/jwks",
}


async def _seed_provider(slug: str = "test-idp", enabled: bool = True) -> OidcProvider:
    """Insert an enabled provider row the routes can resolve"""
    provider = OidcProvider(
        slug=slug,
        display_name="Test IdP",
        issuer=ISSUER,
        client_id=CLIENT_ID,
        client_secret_encrypted=encrypt("secret-abc"),
        scopes="openid email profile",
        enabled=enabled,
    )
    async with TestSession() as session:
        session.add(provider)
        await session.commit()
        await session.refresh(provider)
    return provider


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

    async def fake_verify(id_token, metadata, client_id, expected_nonce):
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


async def _start_sign_in(client, slug: str = "test-idp") -> str:
    """Begin a sign-in and return the state the provider would echo back"""
    resp = await client.post(f"/auth/oidc/{slug}/authorize")
    assert resp.status_code == 200
    params = parse_qs(urlparse(resp.json()["authorization_url"]).query)
    return params["state"][0]


def _claims(**overrides) -> dict:
    """Return verified-token claims for a routine provider user"""
    return {
        "sub": "subject-1",
        "email": "sso-user@example.com",
        "email_verified": True,
        "given_name": "Sso",
        "family_name": "User",
        **overrides,
    }


# --- Provider listing ---


async def test_providers_lists_enabled_only(client):
    """The login page sees enabled providers and never disabled ones"""
    await _seed_provider()
    await _seed_provider(slug="retired-idp", enabled=False)

    resp = await client.get("/auth/oidc/providers")

    assert resp.status_code == 200
    providers = resp.json()["providers"]
    assert [p["slug"] for p in providers] == ["test-idp"]


# --- Authorize ---


async def test_authorize_stores_hashed_single_use_state(client, provider_protocol):
    """Beginning a sign-in stores the roundtrip under the hashed state"""
    await _seed_provider()

    state = await _start_sign_in(client)

    async with TestSession() as session:
        result = await session.execute(select(OidcAuthorizationRequest))
        row = result.scalar_one()
    assert row.state_hash == hash_token(state)
    assert row.state_hash != state


async def test_authorize_rejects_unknown_provider(client):
    """A slug with no enabled provider is refused"""
    resp = await client.post("/auth/oidc/nope/authorize")

    assert resp.status_code == 404


# --- Callback resolution ---


async def test_callback_signs_in_linked_identity(client, provider_protocol):
    """A known provider subject signs its linked user in with no second factor step"""
    await _seed_currency()
    signup = await client.post("/auth/signup", json=SIGNUP_PAYLOAD)
    user_id = uuid.UUID(signup.json()["user"]["id"])
    provider = await _seed_provider()
    async with TestSession() as session:
        session.add(OidcIdentity(user_id=user_id, provider_id=provider.id, subject="subject-1"))
        await session.commit()
    provider_protocol["claims"] = _claims()

    state = await _start_sign_in(client)
    resp = await client.post("/auth/oidc/callback", json={"code": "any", "state": state})

    assert resp.status_code == 200
    body = resp.json()
    assert body["user"]["id"] == str(user_id)
    assert "access_token" in body

    async with TestSession() as session:
        identity = (await session.execute(select(OidcIdentity))).scalar_one()
    assert identity.last_login_at is not None


async def test_callback_auto_links_verified_email(client, provider_protocol):
    """A verified provider email matching a local account links it and signs in"""
    await _seed_currency()
    signup = await client.post("/auth/signup", json=SIGNUP_PAYLOAD)
    user_id = signup.json()["user"]["id"]
    await _seed_provider()
    provider_protocol["claims"] = _claims(email=SIGNUP_PAYLOAD["email"])

    state = await _start_sign_in(client)
    resp = await client.post("/auth/oidc/callback", json={"code": "any", "state": state})

    assert resp.status_code == 200
    assert resp.json()["user"]["id"] == user_id

    async with TestSession() as session:
        identity = (await session.execute(select(OidcIdentity))).scalar_one()
        auth_identity = (
            await session.execute(
                select(AuthIdentity).where(AuthIdentity.auth_provider == AuthProvider.OIDC)
            )
        ).scalar_one()
    assert identity.subject == "subject-1"
    assert str(identity.user_id) == user_id
    assert auth_identity.email_verified is True


async def test_callback_rejects_unverified_email_collision(client, provider_protocol):
    """An unverified provider email matching a local account is refused, never linked"""
    await _seed_currency()
    await client.post("/auth/signup", json=SIGNUP_PAYLOAD)
    await _seed_provider()
    provider_protocol["claims"] = _claims(email=SIGNUP_PAYLOAD["email"], email_verified=False)

    state = await _start_sign_in(client)
    resp = await client.post("/auth/oidc/callback", json={"code": "any", "state": state})

    assert resp.status_code == 409

    # The structured detail hands the client the address so it can prefill a password sign-in
    detail = resp.json()["detail"]
    assert detail["code"] == "email_already_registered"
    assert detail["email"] == SIGNUP_PAYLOAD["email"]

    async with TestSession() as session:
        identities = (await session.execute(select(OidcIdentity))).scalars().all()
    assert identities == []


async def test_callback_onboards_new_user(client, provider_protocol):
    """A first-time sign-in returns the onboarding step instead of creating anything"""
    await _seed_provider()
    provider_protocol["claims"] = _claims()

    state = await _start_sign_in(client)
    resp = await client.post("/auth/oidc/callback", json={"code": "any", "state": state})

    assert resp.status_code == 200
    body = resp.json()
    assert body["onboarding_required"] is True
    assert body["email"] == "sso-user@example.com"
    assert body["first_name"] == "Sso"

    async with TestSession() as session:
        users = (await session.execute(select(User))).scalars().all()
        identities = (await session.execute(select(OidcIdentity))).scalars().all()
    assert users == []
    assert identities == []


async def test_callback_burns_state_once(client, provider_protocol):
    """A replayed callback finds the roundtrip already spent"""
    await _seed_provider()
    provider_protocol["claims"] = _claims()

    state = await _start_sign_in(client)
    first = await client.post("/auth/oidc/callback", json={"code": "any", "state": state})
    replay = await client.post("/auth/oidc/callback", json={"code": "any", "state": state})

    assert first.status_code == 200
    assert replay.status_code == 401


async def test_callback_rejects_expired_state(client, provider_protocol):
    """A roundtrip past its expiry no longer completes"""
    provider = await _seed_provider()
    async with TestSession() as session:
        session.add(
            OidcAuthorizationRequest(
                state_hash=hash_token("stale-state"),
                nonce="n",
                code_verifier="v",
                provider_id=provider.id,
                expires_at=datetime.now(UTC) - timedelta(minutes=1),
            )
        )
        await session.commit()

    resp = await client.post("/auth/oidc/callback", json={"code": "any", "state": "stale-state"})

    assert resp.status_code == 401


# --- Signup completion ---


async def _onboard(client, provider_protocol) -> dict:
    """Run a first-time sign-in and return the onboarding response body"""
    provider_protocol["claims"] = _claims()
    state = await _start_sign_in(client)
    resp = await client.post("/auth/oidc/callback", json={"code": "any", "state": state})
    assert resp.status_code == 200
    return resp.json()


async def test_signup_creates_user_with_linked_identity(client, provider_protocol):
    """Completing onboarding creates the user, the provider link, and the OIDC auth identity"""
    await _seed_currency()
    await _seed_provider()
    onboarding = await _onboard(client, provider_protocol)

    resp = await client.post(
        "/auth/oidc/signup",
        json={
            "onboarding_token": onboarding["onboarding_token"],
            "first_name": "Sso",
            "last_name": "User",
            "tz": "America/Toronto",
            "base_currency": "CAD",
        },
    )

    assert resp.status_code == 201
    body = resp.json()
    assert body["user"]["email"] == "sso-user@example.com"
    assert "access_token" in body

    async with TestSession() as session:
        identity = (await session.execute(select(OidcIdentity))).scalar_one()
        auth_identity = (
            await session.execute(
                select(AuthIdentity).where(AuthIdentity.auth_provider == AuthProvider.OIDC)
            )
        ).scalar_one()
    assert identity.subject == "subject-1"
    assert str(auth_identity.user_id) == body["user"]["id"]


async def test_signup_replay_conflicts_once_linked(client, provider_protocol):
    """Replaying a spent onboarding token conflicts instead of creating a duplicate"""
    await _seed_currency()
    await _seed_provider()
    onboarding = await _onboard(client, provider_protocol)
    payload = {
        "onboarding_token": onboarding["onboarding_token"],
        "first_name": "Sso",
        "tz": "America/Toronto",
        "base_currency": "CAD",
    }

    first = await client.post("/auth/oidc/signup", json=payload)
    replay = await client.post("/auth/oidc/signup", json=payload)

    assert first.status_code == 201
    assert replay.status_code == 409


async def test_signup_rejects_forged_onboarding_token(client):
    """A token signed with the wrong key or use never completes signup"""
    forged = pyjwt.encode(
        {
            "sub": "subject-1",
            "provider_slug": "test-idp",
            "email": "sso-user@example.com",
            "token_use": "oidc_onboarding",
            "exp": datetime.now(UTC) + timedelta(minutes=5),
            "iss": "lumina-finance",
        },
        "not-the-server-key",
        algorithm="HS256",
    )

    resp = await client.post(
        "/auth/oidc/signup",
        json={
            "onboarding_token": forged,
            "first_name": "Sso",
            "tz": "America/Toronto",
            "base_currency": "CAD",
        },
    )

    assert resp.status_code == 401
