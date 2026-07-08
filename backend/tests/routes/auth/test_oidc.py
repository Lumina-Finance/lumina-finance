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


async def test_callback_requires_binding_cookie(client, provider_protocol):
    """A callback without the binding cookie cannot complete a login even with a live state"""
    await _seed_provider()
    provider_protocol["claims"] = _claims()

    state = await _start_sign_in(client)

    # A stolen state and code delivered to a browser that never started the flow has no cookie
    client.cookies.delete("oidc_login_binding")
    resp = await client.post("/auth/oidc/callback", json={"code": "any", "state": state})

    assert resp.status_code == 401


async def test_callback_rejects_wrong_binding_cookie(client, provider_protocol):
    """A callback whose binding cookie does not match the stored roundtrip is refused"""
    await _seed_provider()
    provider_protocol["claims"] = _claims()

    state = await _start_sign_in(client)

    client.cookies.set("oidc_login_binding", "not-the-real-secret")
    resp = await client.post("/auth/oidc/callback", json={"code": "any", "state": state})

    assert resp.status_code == 401


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


# --- Linking ---


async def _create_password_user(client):
    """Sign up the default password account and return its auth header and user id"""
    await _seed_currency()
    signup = await client.post("/auth/signup", json=SIGNUP_PAYLOAD)
    assert signup.status_code == 201
    from tests.routes.support import _get_auth_header

    return _get_auth_header(signup), signup.json()["user"]["id"]


async def _start_link(client, auth, slug: str = "test-idp") -> str:
    """Begin a link roundtrip with the account password and return the state"""
    resp = await client.post(
        f"/auth/oidc/{slug}/link", headers=auth, json={"password": SIGNUP_PAYLOAD["password"]}
    )
    assert resp.status_code == 200
    params = parse_qs(urlparse(resp.json()["authorization_url"]).query)
    return params["state"][0]


async def test_link_attaches_provider_to_account(client, provider_protocol):
    """A step-up authorized link roundtrip attaches the provider subject to the account"""
    auth, user_id = await _create_password_user(client)
    await _seed_provider()
    provider_protocol["claims"] = _claims()

    state = await _start_link(client, auth)
    resp = await client.post("/auth/oidc/link/callback", headers=auth, json={"code": "any", "state": state})

    assert resp.status_code == 200
    body = resp.json()
    assert body["provider_slug"] == "test-idp"
    assert body["email"] == "sso-user@example.com"

    async with TestSession() as session:
        identity = (await session.execute(select(OidcIdentity))).scalar_one()
        auth_identity = (
            await session.execute(
                select(AuthIdentity).where(AuthIdentity.auth_provider == AuthProvider.OIDC)
            )
        ).scalar_one()
    assert str(identity.user_id) == user_id
    assert identity.subject == "subject-1"
    assert str(auth_identity.user_id) == user_id


async def test_link_requires_correct_password(client, provider_protocol):
    """A wrong password fails the step-up before any roundtrip is stored"""
    auth, _ = await _create_password_user(client)
    await _seed_provider()

    resp = await client.post(
        "/auth/oidc/test-idp/link", headers=auth, json={"password": "WrongPassword123!"}
    )

    assert resp.status_code == 401

    async with TestSession() as session:
        rows = (await session.execute(select(OidcAuthorizationRequest))).scalars().all()
    assert rows == []


async def test_link_requires_factor_when_enrolled(client, provider_protocol):
    """An account with TOTP enrolled must present a code, the password alone is refused"""
    import pyotp

    auth, _ = await _create_password_user(client)
    await _seed_provider()

    # Enrol and activate TOTP so the step-up demands a current code
    step_up = {"step_up": {"password": SIGNUP_PAYLOAD["password"]}}
    secret = (await client.post("/auth/2fa/setup", headers=auth, json=step_up)).json()["secret"]
    await client.post("/auth/2fa/confirm", headers=auth, json={"code": pyotp.TOTP(secret).now()})
    await client.post("/auth/2fa/complete", headers=auth)

    resp = await client.post(
        "/auth/oidc/test-idp/link", headers=auth, json={"password": SIGNUP_PAYLOAD["password"]}
    )

    assert resp.status_code == 400


async def test_link_callback_rejects_another_account(client, provider_protocol):
    """A link roundtrip only completes for the account whose step-up authorized it"""
    auth, _ = await _create_password_user(client)
    await _seed_provider()
    provider_protocol["claims"] = _claims()
    state = await _start_link(client, auth)

    other_signup = await client.post(
        "/auth/signup", json={**SIGNUP_PAYLOAD, "email": "other@example.com"}
    )
    from tests.routes.support import _get_auth_header

    other_auth = _get_auth_header(other_signup)
    resp = await client.post(
        "/auth/oidc/link/callback", headers=other_auth, json={"code": "any", "state": state}
    )

    assert resp.status_code == 401


async def test_link_state_cannot_complete_login(client, provider_protocol):
    """A link roundtrip can never complete the public login callback"""
    auth, _ = await _create_password_user(client)
    await _seed_provider()
    provider_protocol["claims"] = _claims()
    state = await _start_link(client, auth)

    resp = await client.post("/auth/oidc/callback", json={"code": "any", "state": state})

    assert resp.status_code == 401


async def test_login_state_cannot_complete_link(client, provider_protocol):
    """A login roundtrip can never complete the authenticated link callback"""
    auth, _ = await _create_password_user(client)
    await _seed_provider()
    provider_protocol["claims"] = _claims()
    state = await _start_sign_in(client)

    resp = await client.post("/auth/oidc/link/callback", headers=auth, json={"code": "any", "state": state})

    assert resp.status_code == 401


async def test_link_rejects_subject_owned_by_another_account(client, provider_protocol):
    """A subject already linked to another account cannot be linked again"""
    auth, _ = await _create_password_user(client)
    provider = await _seed_provider()
    provider_protocol["claims"] = _claims()

    async with TestSession() as session:
        other_user = User(
            id=uuid.uuid4(),
            email="other@example.com",
            first_name="Other",
            tz="America/Toronto",
            base_currency="CAD",
        )
        session.add(other_user)
        await session.flush()
        session.add(OidcIdentity(user_id=other_user.id, provider_id=provider.id, subject="subject-1"))
        await session.commit()

    state = await _start_link(client, auth)
    resp = await client.post("/auth/oidc/link/callback", headers=auth, json={"code": "any", "state": state})

    assert resp.status_code == 409


async def test_identities_lists_links_and_password_flag(client, provider_protocol):
    """The settings listing returns the linked providers and the password availability"""
    auth, _ = await _create_password_user(client)
    await _seed_provider()
    provider_protocol["claims"] = _claims()
    state = await _start_link(client, auth)
    await client.post("/auth/oidc/link/callback", headers=auth, json={"code": "any", "state": state})

    resp = await client.get("/auth/oidc/identities", headers=auth)

    assert resp.status_code == 200
    body = resp.json()
    assert body["has_password"] is True
    assert len(body["identities"]) == 1
    assert body["identities"][0]["provider_display_name"] == "Test IdP"


async def test_unlink_removes_identity_after_step_up(client, provider_protocol):
    """Unlinking with the password removes the identity and the OIDC auth identity"""
    auth, _ = await _create_password_user(client)
    await _seed_provider()
    provider_protocol["claims"] = _claims()
    state = await _start_link(client, auth)
    linked = await client.post(
        "/auth/oidc/link/callback", headers=auth, json={"code": "any", "state": state}
    )
    identity_id = linked.json()["id"]

    resp = await client.post(
        f"/auth/oidc/identities/{identity_id}/remove",
        headers=auth,
        json={"password": SIGNUP_PAYLOAD["password"]},
    )

    assert resp.status_code == 204
    async with TestSession() as session:
        identities = (await session.execute(select(OidcIdentity))).scalars().all()
        oidc_auth_identities = (
            await session.execute(
                select(AuthIdentity).where(AuthIdentity.auth_provider == AuthProvider.OIDC)
            )
        ).scalars().all()
    assert identities == []
    assert oidc_auth_identities == []


async def test_unlink_rejects_wrong_password(client, provider_protocol):
    """A wrong password fails the unlink step-up and keeps the identity"""
    auth, _ = await _create_password_user(client)
    await _seed_provider()
    provider_protocol["claims"] = _claims()
    state = await _start_link(client, auth)
    linked = await client.post(
        "/auth/oidc/link/callback", headers=auth, json={"code": "any", "state": state}
    )
    identity_id = linked.json()["id"]

    resp = await client.post(
        f"/auth/oidc/identities/{identity_id}/remove",
        headers=auth,
        json={"password": "WrongPassword123!"},
    )

    assert resp.status_code == 401
    async with TestSession() as session:
        identities = (await session.execute(select(OidcIdentity))).scalars().all()
    assert len(identities) == 1


async def test_passwordless_account_cannot_unlink(client, provider_protocol):
    """An account created through a provider has no password, so unlink step-up is refused"""
    await _seed_currency()
    await _seed_provider()
    onboarding = await _onboard(client, provider_protocol)
    completed = await client.post(
        "/auth/oidc/signup",
        json={
            "onboarding_token": onboarding["onboarding_token"],
            "first_name": "Sso",
            "tz": "America/Toronto",
            "base_currency": "CAD",
        },
    )
    from tests.routes.support import _get_auth_header

    auth = _get_auth_header(completed)
    listing = (await client.get("/auth/oidc/identities", headers=auth)).json()
    assert listing["has_password"] is False
    identity_id = listing["identities"][0]["id"]

    resp = await client.post(
        f"/auth/oidc/identities/{identity_id}/remove",
        headers=auth,
        json={"password": "AnyPassword123!"},
    )

    assert resp.status_code == 401
