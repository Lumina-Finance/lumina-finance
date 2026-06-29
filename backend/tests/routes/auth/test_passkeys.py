"""Passkey registration and management route tests

The attestation crypto belongs to the WebAuthn library and is verified there, so the registration
happy path stubs only that one call and exercises the real challenge, storage, and identity logic
"""

import json
import uuid
from types import SimpleNamespace

from sqlalchemy import select
from webauthn.helpers import bytes_to_base64url

import app.services.auth.webauthn as webauthn_service
from app.config import WEBAUTHN_ORIGINS, WEBAUTHN_RP_ID
from app.models.auth import AuthIdentity, WebauthnChallenge, WebauthnCredential
from app.models.base import AuthProvider
from tests.conftest import TestSession
from tests.routes.support import SIGNUP_PAYLOAD, _create_user, _get_auth_header


async def _create_second_user(client):
    """Sign up a second user reusing the seeded currency, returning the auth response"""
    payload = {**SIGNUP_PAYLOAD, "email": "second@example.com"}
    return await client.post("/auth/signup", json=payload)


async def _seed_passkey(user_id: str, credential_id: bytes, name: str = "Seeded key") -> uuid.UUID:
    """Insert a passkey and its WebAuthn identity directly for management tests

    Args:
        user_id: Owner of the passkey
        credential_id: Unique raw credential id
        name: Label to store

    Returns:
        The new passkey's id
    """
    async with TestSession() as db:
        passkey = WebauthnCredential(
            user_id=uuid.UUID(user_id),
            credential_id=credential_id,
            public_key=b"public-key-bytes",
            sign_count=0,
            name=name,
        )
        db.add(passkey)

        # Mirror the registration flow, which records a WebAuthn identity alongside the first passkey
        identity_exists = await db.scalar(
            select(AuthIdentity).where(
                AuthIdentity.user_id == uuid.UUID(user_id),
                AuthIdentity.auth_provider == AuthProvider.WEBAUTHN,
            )
        )
        if identity_exists is None:
            db.add(AuthIdentity(user_id=uuid.UUID(user_id), auth_provider=AuthProvider.WEBAUTHN))
        await db.commit()
        return passkey.id


def _build_credential(challenge: str, credential_id: bytes) -> dict:
    """Assemble a registration response whose client data carries the given challenge"""
    client_data = {
        "type": "webauthn.create",
        "challenge": challenge,
        "origin": WEBAUTHN_ORIGINS[0],
    }
    return {
        "id": bytes_to_base64url(credential_id),
        "rawId": bytes_to_base64url(credential_id),
        "type": "public-key",
        "response": {
            "clientDataJSON": bytes_to_base64url(json.dumps(client_data).encode()),
            "attestationObject": bytes_to_base64url(b"stub-attestation"),
            "transports": ["internal", "hybrid"],
        },
        "clientExtensionResults": {},
    }


async def _count_registration_challenges(user_id: str) -> int:
    """Return how many registration challenges are stored for a user"""
    async with TestSession() as db:
        rows = await db.scalars(
            select(WebauthnChallenge).where(
                WebauthnChallenge.user_id == uuid.UUID(user_id),
                WebauthnChallenge.purpose == "registration",
            )
        )
        return len(list(rows))


async def test_config_reports_relying_party_id(client):
    """The public config endpoint returns the configured relying party id"""
    response = await client.get("/auth/passkeys/config")
    assert response.status_code == 200
    assert response.json()["rp_id"] == WEBAUTHN_RP_ID


async def test_registration_options_persist_single_challenge(client):
    """The options endpoint returns ceremony fields and persists exactly one registration challenge"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    user_id = signup.json()["user"]["id"]

    response = await client.post("/auth/passkeys/register/options", headers=auth)
    assert response.status_code == 200

    options = response.json()
    assert "challenge" in options
    assert options["authenticatorSelection"]["residentKey"] == "required"
    assert options["authenticatorSelection"]["userVerification"] == "required"
    assert options["rp"]["id"] == WEBAUTHN_RP_ID

    assert await _count_registration_challenges(user_id) == 1


async def test_registration_options_exclude_existing_passkeys(client):
    """A registered passkey appears in excludeCredentials so it cannot be enrolled twice"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    user_id = signup.json()["user"]["id"]
    credential_id = b"existing-credential-id"
    await _seed_passkey(user_id, credential_id)

    options = (await client.post("/auth/passkeys/register/options", headers=auth)).json()

    excluded = {entry["id"] for entry in options["excludeCredentials"]}
    assert bytes_to_base64url(credential_id) in excluded


async def test_register_stores_passkey_and_records_identity(client, monkeypatch):
    """A verified ceremony stores the passkey, records the identity, and spends the challenge once"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    user_id = signup.json()["user"]["id"]
    credential_id = b"new-credential-id"

    options = (await client.post("/auth/passkeys/register/options", headers=auth)).json()
    credential = _build_credential(options["challenge"], credential_id)

    # The attestation crypto is the library's responsibility, so only its verdict is stubbed
    monkeypatch.setattr(
        webauthn_service,
        "verify_registration_response",
        lambda **_: SimpleNamespace(
            credential_id=credential_id,
            credential_public_key=b"verified-public-key",
            sign_count=1,
        ),
    )

    registered = await client.post(
        "/auth/passkeys/register", headers=auth, json={"name": "My laptop", "credential": credential}
    )
    assert registered.status_code == 201
    assert registered.json()["name"] == "My laptop"

    listing = await client.get("/auth/passkeys", headers=auth)
    assert [passkey["name"] for passkey in listing.json()] == ["My laptop"]

    async with TestSession() as db:
        identity = await db.scalar(
            select(AuthIdentity).where(
                AuthIdentity.user_id == uuid.UUID(user_id),
                AuthIdentity.auth_provider == AuthProvider.WEBAUTHN,
            )
        )
        assert identity is not None

    # The challenge is single-use, so replaying the same response is refused
    replay = await client.post(
        "/auth/passkeys/register", headers=auth, json={"name": "My laptop", "credential": credential}
    )
    assert replay.status_code == 400


async def test_register_rejects_unknown_challenge(client):
    """A response whose challenge was never issued is refused before any verification"""
    auth = _get_auth_header(await _create_user(client))
    credential = _build_credential(bytes_to_base64url(b"never-issued"), b"some-credential")

    response = await client.post(
        "/auth/passkeys/register", headers=auth, json={"name": "Key", "credential": credential}
    )
    assert response.status_code == 400


async def test_register_rejects_malformed_response(client):
    """A response missing the client data is rejected as malformed"""
    auth = _get_auth_header(await _create_user(client))

    response = await client.post(
        "/auth/passkeys/register", headers=auth, json={"name": "Key", "credential": {"id": "x"}}
    )
    assert response.status_code == 400


async def test_rename_passkey_updates_label(client):
    """Renaming a passkey returns the new label"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    passkey_id = await _seed_passkey(signup.json()["user"]["id"], b"rename-credential")

    response = await client.patch(
        f"/auth/passkeys/{passkey_id}", headers=auth, json={"name": "Renamed key"}
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Renamed key"


async def test_rename_rejects_another_users_passkey(client):
    """A user cannot rename a passkey that belongs to someone else"""
    auth = _get_auth_header(await _create_user(client))
    other = await _create_second_user(client)
    other_passkey = await _seed_passkey(other.json()["user"]["id"], b"other-credential")

    response = await client.patch(
        f"/auth/passkeys/{other_passkey}", headers=auth, json={"name": "Hijack"}
    )
    assert response.status_code == 404


async def test_remove_last_passkey_drops_identity(client):
    """Removing the only passkey deletes the WebAuthn identity"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    user_id = signup.json()["user"]["id"]
    passkey_id = await _seed_passkey(user_id, b"last-credential")

    response = await client.delete(f"/auth/passkeys/{passkey_id}", headers=auth)
    assert response.status_code == 204

    listing = await client.get("/auth/passkeys", headers=auth)
    assert listing.json() == []

    async with TestSession() as db:
        identity = await db.scalar(
            select(AuthIdentity).where(
                AuthIdentity.user_id == uuid.UUID(user_id),
                AuthIdentity.auth_provider == AuthProvider.WEBAUTHN,
            )
        )
        assert identity is None


async def test_remove_keeps_identity_while_passkeys_remain(client):
    """Removing one of several passkeys keeps the WebAuthn identity"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    user_id = signup.json()["user"]["id"]
    first = await _seed_passkey(user_id, b"first-credential")
    await _seed_passkey(user_id, b"second-credential")

    await client.delete(f"/auth/passkeys/{first}", headers=auth)

    async with TestSession() as db:
        identity = await db.scalar(
            select(AuthIdentity).where(
                AuthIdentity.user_id == uuid.UUID(user_id),
                AuthIdentity.auth_provider == AuthProvider.WEBAUTHN,
            )
        )
        assert identity is not None


async def test_management_requires_authentication(client):
    """Listing passkeys without a token is rejected"""
    response = await client.get("/auth/passkeys")
    assert response.status_code in (401, 403)
