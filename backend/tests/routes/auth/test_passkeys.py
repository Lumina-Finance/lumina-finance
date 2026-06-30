"""Passkey registration, management, and sign-in route tests

The attestation and assertion crypto belong to the WebAuthn library and are verified there, so the
happy paths stub only that one call and exercise the real challenge, storage, and identity logic
"""

import json
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pyotp
from sqlalchemy import select
from webauthn.helpers import bytes_to_base64url

import app.services.auth.webauthn as webauthn_service
from app.config import TWO_FACTOR_STAGING_EXPIRE_SECONDS, WEBAUTHN_ORIGINS, WEBAUTHN_RP_ID
from app.models.auth import AuthIdentity, RecoveryCode, WebauthnChallenge, WebauthnCredential
from app.models.base import AuthProvider
from app.models.user import User
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
            confirmed_at=datetime.now(UTC),
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


async def _register_passkey(client, auth, monkeypatch, credential_id: bytes, name: str):
    """Run a stubbed registration ceremony and return the register response"""
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

    return await client.post(
        "/auth/passkeys/register", headers=auth, json={"name": name, "credential": credential}
    )


async def _has_webauthn_identity(user_id: str) -> bool:
    """Return whether the user has a WebAuthn auth identity"""
    async with TestSession() as db:
        identity = await db.scalar(
            select(AuthIdentity).where(
                AuthIdentity.user_id == uuid.UUID(user_id),
                AuthIdentity.auth_provider == AuthProvider.WEBAUTHN,
            )
        )
        return identity is not None


async def test_first_passkey_is_staged_until_recovery_codes_confirmed(client, monkeypatch):
    """A first passkey returns recovery codes and stays inactive until they are acknowledged"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    user_id = signup.json()["user"]["id"]

    registered = await _register_passkey(client, auth, monkeypatch, b"first-key", "My laptop")
    assert registered.status_code == 201
    body = registered.json()
    assert body["passkey"]["name"] == "My laptop"
    assert len(body["recovery_codes"]) == 10

    # Staged: not yet listed, no identity, until the recovery codes are confirmed
    assert (await client.get("/auth/passkeys", headers=auth)).json() == []
    assert await _has_webauthn_identity(user_id) is False

    confirmed = await client.post("/auth/passkeys/register/confirm", headers=auth)
    assert confirmed.status_code == 204

    assert [p["name"] for p in (await client.get("/auth/passkeys", headers=auth)).json()] == ["My laptop"]
    assert await _has_webauthn_identity(user_id) is True


async def test_second_passkey_activates_without_new_codes(client, monkeypatch):
    """Once recovery codes exist, a further passkey is active immediately and issues no new codes"""
    auth = _get_auth_header(await _create_user(client))

    await _register_passkey(client, auth, monkeypatch, b"first-key", "First")
    await client.post("/auth/passkeys/register/confirm", headers=auth)

    second = await _register_passkey(client, auth, monkeypatch, b"second-key", "Second")
    assert second.status_code == 201
    assert second.json()["recovery_codes"] is None

    names = {p["name"] for p in (await client.get("/auth/passkeys", headers=auth)).json()}
    assert names == {"First", "Second"}


async def test_passkey_after_existing_codes_reuses_them(client, monkeypatch):
    """Registering a passkey when recovery codes already exist issues no new batch and activates now

    The codes are account-level and shared, so a passkey added after TOTP reuses the existing batch
    rather than replacing it, the same way TOTP enrolment reuses a passkey's batch
    """
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    await _seed_active_recovery_code(signup.json()["user"]["id"])

    registered = await _register_passkey(client, auth, monkeypatch, b"after-totp-key", "Phone")
    assert registered.status_code == 201
    assert registered.json()["recovery_codes"] is None
    assert [p["name"] for p in (await client.get("/auth/passkeys", headers=auth)).json()] == ["Phone"]


async def test_confirm_without_staged_passkey_is_rejected(client):
    """Confirming when nothing is staged is refused"""
    auth = _get_auth_header(await _create_user(client))
    response = await client.post("/auth/passkeys/register/confirm", headers=auth)
    assert response.status_code == 400


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


async def _step_up_with_passkey(client, auth, monkeypatch, user_id: str, credential_id: bytes) -> dict:
    """Run a passkey step-up ceremony and return the step-up request body for a sensitive action"""
    options = (await client.post("/auth/passkeys/step-up/options", headers=auth)).json()
    assertion = _build_assertion(options["challenge"], credential_id, user_id)
    monkeypatch.setattr(
        webauthn_service, "verify_authentication_response", lambda **_: SimpleNamespace(new_sign_count=1)
    )
    return {"password": SIGNUP_PAYLOAD["password"], "passkey": assertion}


async def test_remove_last_passkey_drops_identity(client, monkeypatch):
    """Removing the only passkey deletes the WebAuthn identity after a passkey step-up"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    user_id = signup.json()["user"]["id"]
    credential_id = b"last-credential"
    passkey_id = await _seed_passkey(user_id, credential_id)

    body = await _step_up_with_passkey(client, auth, monkeypatch, user_id, credential_id)
    response = await client.post(f"/auth/passkeys/{passkey_id}/remove", headers=auth, json=body)
    assert response.status_code == 204

    assert (await client.get("/auth/passkeys", headers=auth)).json() == []
    assert await _has_webauthn_identity(user_id) is False


async def test_remove_keeps_identity_while_passkeys_remain(client, monkeypatch):
    """Removing one of several passkeys keeps the WebAuthn identity"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    user_id = signup.json()["user"]["id"]
    first = await _seed_passkey(user_id, b"first-credential")
    await _seed_passkey(user_id, b"second-credential")

    # Step up with the passkey that survives the removal
    body = await _step_up_with_passkey(client, auth, monkeypatch, user_id, b"second-credential")
    removed = await client.post(f"/auth/passkeys/{first}/remove", headers=auth, json=body)
    assert removed.status_code == 204

    assert await _has_webauthn_identity(user_id) is True


async def test_remove_passkey_rejects_a_wrong_password(client):
    """Passkey removal refuses a wrong password and leaves the passkey in place"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    passkey_id = await _seed_passkey(signup.json()["user"]["id"], b"protected-credential")

    rejected = await client.post(
        f"/auth/passkeys/{passkey_id}/remove", headers=auth, json={"password": "WrongPass123!", "code": "000000"}
    )
    assert rejected.status_code == 401
    assert len((await client.get("/auth/passkeys", headers=auth)).json()) == 1


async def test_removing_passkey_keeps_recovery_codes_when_totp_survives(client, monkeypatch):
    """Removing a passkey while TOTP remains keeps the shared recovery batch"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    user_id = signup.json()["user"]["id"]
    credential_id = b"removable-with-totp"
    passkey_id = await _seed_passkey(user_id, credential_id)

    # Enrol TOTP so it survives the passkey removal
    secret = (await client.post("/auth/2fa/setup", headers=auth)).json()["secret"]
    await client.post("/auth/2fa/confirm", headers=auth, json={"code": pyotp.TOTP(secret).now()})
    await client.post("/auth/2fa/complete", headers=auth)

    body = await _step_up_with_passkey(client, auth, monkeypatch, user_id, credential_id)
    removed = await client.post(f"/auth/passkeys/{passkey_id}/remove", headers=auth, json=body)
    assert removed.status_code == 204

    async with TestSession() as db:
        active = (
            await db.execute(
                select(RecoveryCode).where(
                    RecoveryCode.user_id == uuid.UUID(user_id), RecoveryCode.pending.is_(False)
                )
            )
        ).scalars().all()
    assert len(active) == 10


async def test_removing_the_last_factor_clears_recovery_codes(client, monkeypatch):
    """Removing the last second factor clears the shared recovery batch"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    user_id = signup.json()["user"]["id"]
    credential_id = b"sole-factor-key"

    # Register a real passkey so a recovery batch is issued, then acknowledge it
    registered = await _register_passkey(client, auth, monkeypatch, credential_id, "Only key")
    passkey_id = registered.json()["passkey"]["id"]
    await client.post("/auth/passkeys/register/confirm", headers=auth)

    body = await _step_up_with_passkey(client, auth, monkeypatch, user_id, credential_id)
    removed = await client.post(f"/auth/passkeys/{passkey_id}/remove", headers=auth, json=body)
    assert removed.status_code == 204

    async with TestSession() as db:
        remaining = (
            await db.execute(select(RecoveryCode).where(RecoveryCode.user_id == uuid.UUID(user_id)))
        ).scalars().all()
    assert remaining == []


async def test_management_requires_authentication(client):
    """Listing passkeys without a token is rejected"""
    response = await client.get("/auth/passkeys")
    assert response.status_code in (401, 403)


def _build_assertion(challenge: str, credential_id: bytes, user_id: str) -> dict:
    """Assemble a sign-in assertion whose client data carries the given challenge"""
    client_data = {
        "type": "webauthn.get",
        "challenge": challenge,
        "origin": WEBAUTHN_ORIGINS[0],
    }
    return {
        "id": bytes_to_base64url(credential_id),
        "rawId": bytes_to_base64url(credential_id),
        "type": "public-key",
        "response": {
            "clientDataJSON": bytes_to_base64url(json.dumps(client_data).encode()),
            "authenticatorData": bytes_to_base64url(b"stub-authenticator-data"),
            "signature": bytes_to_base64url(b"stub-signature"),
            "userHandle": bytes_to_base64url(uuid.UUID(user_id).bytes),
        },
        "clientExtensionResults": {},
    }


async def _read_passkey(credential_id: bytes) -> WebauthnCredential | None:
    """Return a stored passkey by its raw credential id"""
    async with TestSession() as db:
        return await db.scalar(
            select(WebauthnCredential).where(WebauthnCredential.credential_id == credential_id)
        )


async def test_authentication_options_persist_unscoped_challenge(client):
    """The options endpoint is public, requires user verification, and stores a userless challenge"""
    response = await client.post("/auth/passkeys/authenticate/options")
    assert response.status_code == 200

    options = response.json()
    assert "challenge" in options
    assert options["userVerification"] == "required"
    assert options["rpId"] == WEBAUTHN_RP_ID

    async with TestSession() as db:
        rows = list(
            await db.scalars(
                select(WebauthnChallenge).where(WebauthnChallenge.purpose == "authentication")
            )
        )
    assert len(rows) == 1
    assert rows[0].user_id is None


async def test_authenticate_signs_in_and_advances_counter(client, monkeypatch):
    """A verified assertion issues tokens, advances the signature counter, and spends the challenge"""
    signup = await _create_user(client)
    user_id = signup.json()["user"]["id"]
    credential_id = b"sign-in-credential"
    await _seed_passkey(user_id, credential_id)

    options = (await client.post("/auth/passkeys/authenticate/options")).json()
    assertion = _build_assertion(options["challenge"], credential_id, user_id)

    # The assertion crypto is the library's responsibility, so only its verdict is stubbed
    monkeypatch.setattr(
        webauthn_service,
        "verify_authentication_response",
        lambda **_: SimpleNamespace(new_sign_count=7),
    )

    signed_in = await client.post("/auth/passkeys/authenticate", json={"credential": assertion})
    assert signed_in.status_code == 200
    body = signed_in.json()
    assert body["access_token"]
    assert body["user"]["id"] == user_id

    stored = await _read_passkey(credential_id)
    assert stored.sign_count == 7
    assert stored.last_used_at is not None

    # The challenge is single-use, so replaying the same assertion is refused
    replay = await client.post("/auth/passkeys/authenticate", json={"credential": assertion})
    assert replay.status_code == 400


async def test_authenticate_rejects_unknown_challenge(client):
    """An assertion whose challenge was never issued is refused before any verification"""
    signup = await _create_user(client)
    user_id = signup.json()["user"]["id"]
    credential_id = b"unknown-challenge-credential"
    await _seed_passkey(user_id, credential_id)

    assertion = _build_assertion(bytes_to_base64url(b"never-issued"), credential_id, user_id)
    response = await client.post("/auth/passkeys/authenticate", json={"credential": assertion})
    assert response.status_code == 400


async def test_authenticate_rejects_unrecognized_credential(client):
    """A valid challenge with a credential id that matches no stored passkey is refused"""
    signup = await _create_user(client)
    user_id = signup.json()["user"]["id"]

    options = (await client.post("/auth/passkeys/authenticate/options")).json()
    assertion = _build_assertion(options["challenge"], b"no-such-credential", user_id)

    response = await client.post("/auth/passkeys/authenticate", json={"credential": assertion})
    assert response.status_code == 401


async def test_authenticate_rejects_malformed_response(client):
    """An assertion missing the client data is rejected as malformed"""
    response = await client.post("/auth/passkeys/authenticate", json={"credential": {"rawId": "x"}})
    assert response.status_code == 400


async def _seed_stale_staged_passkey(user_id: str, credential_id: bytes) -> None:
    """Insert a staged passkey and a pending recovery code old enough to be pruned"""
    stale = datetime.now(UTC) - timedelta(seconds=TWO_FACTOR_STAGING_EXPIRE_SECONDS + 60)
    async with TestSession() as db:
        db.add(WebauthnCredential(
            user_id=uuid.UUID(user_id),
            credential_id=credential_id,
            public_key=b"public-key-bytes",
            sign_count=0,
            name="Staged",
            confirmed_at=None,
            created_at=stale,
        ))
        db.add(RecoveryCode(user_id=uuid.UUID(user_id), code_hash="stale-hash", pending=True, created_at=stale))
        await db.commit()


async def test_login_prunes_stale_passkey_staging(client):
    """Logging in sweeps a staged passkey and its pending recovery codes once they are stale"""
    signup = await _create_user(client)
    user_id = signup.json()["user"]["id"]
    await _seed_stale_staged_passkey(user_id, b"stale-staged-key")

    login = await client.post(
        "/auth/login",
        json={"email": SIGNUP_PAYLOAD["email"], "password": SIGNUP_PAYLOAD["password"]},
    )
    assert login.status_code == 200

    async with TestSession() as db:
        staged = await db.scalar(
            select(WebauthnCredential).where(WebauthnCredential.credential_id == b"stale-staged-key")
        )
        pending = await db.scalar(
            select(RecoveryCode).where(
                RecoveryCode.user_id == uuid.UUID(user_id), RecoveryCode.pending.is_(True)
            )
        )
    assert staged is None
    assert pending is None


async def _login(client, email: str = SIGNUP_PAYLOAD["email"]):
    """Submit the password login for a seeded user"""
    return await client.post("/auth/login", json={"email": email, "password": SIGNUP_PAYLOAD["password"]})


async def test_login_requires_passkey_second_factor(client):
    """A user with a passkey but no TOTP is challenged for the passkey at login"""
    signup = await _create_user(client)
    await _seed_passkey(signup.json()["user"]["id"], b"login-2fa-key")

    login = await _login(client)
    assert login.status_code == 200
    body = login.json()
    assert body["mfa_required"] is True
    assert body["passkey_available"] is True
    assert body["totp_enabled"] is False
    assert body["recovery_only"] is False


async def test_passkey_second_factor_completes_login(client, monkeypatch):
    """The scoped passkey ceremony completes a password login and advances the counter"""
    signup = await _create_user(client)
    user_id = signup.json()["user"]["id"]
    credential_id = b"second-factor-key"
    await _seed_passkey(user_id, credential_id)

    mfa_token = (await _login(client)).json()["mfa_token"]

    options = (await client.post("/auth/passkeys/mfa/options", json={"mfa_token": mfa_token})).json()
    assert bytes_to_base64url(credential_id) in {entry["id"] for entry in options["allowCredentials"]}

    assertion = _build_assertion(options["challenge"], credential_id, user_id)
    monkeypatch.setattr(
        webauthn_service,
        "verify_authentication_response",
        lambda **_: SimpleNamespace(new_sign_count=9),
    )

    verified = await client.post(
        "/auth/passkeys/mfa/verify", json={"mfa_token": mfa_token, "credential": assertion}
    )
    assert verified.status_code == 200
    assert verified.json()["user"]["id"] == user_id

    stored = await _read_passkey(credential_id)
    assert stored.sign_count == 9


async def test_disable_totp_via_passkey_step_up(client, monkeypatch):
    """TOTP can be disabled by stepping up with a passkey instead of an authenticator code"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    user_id = signup.json()["user"]["id"]
    credential_id = b"disable-step-up-key"
    await _seed_passkey(user_id, credential_id)

    # Enrol TOTP on top of the passkey so both factors exist
    secret = (await client.post("/auth/2fa/setup", headers=auth)).json()["secret"]
    await client.post("/auth/2fa/confirm", headers=auth, json={"code": pyotp.TOTP(secret).now()})
    await client.post("/auth/2fa/complete", headers=auth)

    options = (await client.post("/auth/passkeys/step-up/options", headers=auth)).json()
    assertion = _build_assertion(options["challenge"], credential_id, user_id)
    monkeypatch.setattr(
        webauthn_service, "verify_authentication_response", lambda **_: SimpleNamespace(new_sign_count=3)
    )

    disabled = await client.post(
        "/auth/2fa/disable", headers=auth, json={"password": SIGNUP_PAYLOAD["password"], "passkey": assertion}
    )
    assert disabled.status_code == 204
    assert (await client.get("/auth/2fa/status", headers=auth)).json()["totp_enabled"] is False


async def test_disabling_totp_keeps_recovery_codes_when_a_passkey_survives(client, monkeypatch):
    """Disabling TOTP leaves the shared recovery batch intact while a passkey still relies on it"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    user_id = signup.json()["user"]["id"]
    credential_id = b"survivor-key"
    await _seed_passkey(user_id, credential_id)

    # Enrol TOTP alongside the passkey so they share one recovery batch
    secret = (await client.post("/auth/2fa/setup", headers=auth)).json()["secret"]
    await client.post("/auth/2fa/confirm", headers=auth, json={"code": pyotp.TOTP(secret).now()})
    await client.post("/auth/2fa/complete", headers=auth)

    options = (await client.post("/auth/passkeys/step-up/options", headers=auth)).json()
    assertion = _build_assertion(options["challenge"], credential_id, user_id)
    monkeypatch.setattr(
        webauthn_service, "verify_authentication_response", lambda **_: SimpleNamespace(new_sign_count=2)
    )
    disabled = await client.post(
        "/auth/2fa/disable", headers=auth, json={"password": SIGNUP_PAYLOAD["password"], "passkey": assertion}
    )
    assert disabled.status_code == 204

    # The batch survives because the passkey still depends on it
    async with TestSession() as db:
        active = (
            await db.execute(
                select(RecoveryCode).where(
                    RecoveryCode.user_id == uuid.UUID(user_id), RecoveryCode.pending.is_(False)
                )
            )
        ).scalars().all()
    assert len(active) == 10


async def test_regenerate_recovery_codes_via_passkey_step_up(client, monkeypatch):
    """A passkey-only user can regenerate recovery codes by stepping up with their passkey"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    user_id = signup.json()["user"]["id"]
    credential_id = b"regen-step-up-key"
    await _seed_passkey(user_id, credential_id)

    options = (await client.post("/auth/passkeys/step-up/options", headers=auth)).json()
    assertion = _build_assertion(options["challenge"], credential_id, user_id)
    monkeypatch.setattr(
        webauthn_service, "verify_authentication_response", lambda **_: SimpleNamespace(new_sign_count=4)
    )

    regenerated = await client.post(
        "/auth/2fa/recovery-codes", headers=auth, json={"password": SIGNUP_PAYLOAD["password"], "passkey": assertion}
    )
    assert regenerated.status_code == 200
    assert len(regenerated.json()["recovery_codes"]) == 10


async def test_mfa_options_rejects_invalid_token(client):
    """Passkey second-factor options are refused for a token that does not verify"""
    response = await client.post("/auth/passkeys/mfa/options", json={"mfa_token": "not-a-token"})
    assert response.status_code == 401


async def test_passkey_second_factor_rejects_another_users_passkey(client):
    """An assertion signed by a different user's passkey cannot satisfy the challenge"""
    signup = await _create_user(client)
    user_id = signup.json()["user"]["id"]
    await _seed_passkey(user_id, b"owner-key")
    other = await _create_second_user(client)
    await _seed_passkey(other.json()["user"]["id"], b"foreign-key")

    mfa_token = (await _login(client)).json()["mfa_token"]
    options = (await client.post("/auth/passkeys/mfa/options", json={"mfa_token": mfa_token})).json()

    # Present the other user's credential against this user's challenge
    assertion = _build_assertion(options["challenge"], b"foreign-key", user_id)
    response = await client.post(
        "/auth/passkeys/mfa/verify", json={"mfa_token": mfa_token, "credential": assertion}
    )
    assert response.status_code == 401


async def _set_reenrollment_required(user_id: str) -> None:
    """Restrict the user as a recovery-code login would, pending second-factor re-establishment"""
    async with TestSession() as db:
        user = await db.get(User, uuid.UUID(user_id))
        user.second_factor_reenrollment_required = True
        await db.commit()


async def _seed_active_recovery_code(user_id: str) -> None:
    """Insert one active recovery code, standing in for a batch that survives a recovery login"""
    async with TestSession() as db:
        db.add(RecoveryCode(user_id=uuid.UUID(user_id), code_hash="active-hash", pending=False))
        await db.commit()


async def _is_reenrollment_required(user_id: str) -> bool:
    """Return whether the user is still restricted to second-factor re-establishment"""
    async with TestSession() as db:
        user = await db.get(User, uuid.UUID(user_id))
        return user.second_factor_reenrollment_required


async def test_restricted_session_reestablishes_with_passkey(client, monkeypatch):
    """A recovery-code login re-enrols a passkey with a fresh batch, lifting the restriction on confirm

    A forced re-enrol never reuses the surviving recovery codes, so the passkey is staged with a fresh
    batch and stays restricted until those codes are acknowledged
    """
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    user_id = signup.json()["user"]["id"]
    await _seed_active_recovery_code(user_id)
    await _set_reenrollment_required(user_id)

    registered = await _register_passkey(client, auth, monkeypatch, b"reestablish-key", "Recovery key")
    assert registered.status_code == 201
    assert len(registered.json()["recovery_codes"]) == 10

    # Staged and still restricted until the fresh codes are acknowledged
    assert await _is_reenrollment_required(user_id) is True
    assert (await client.get("/auth/passkeys", headers=auth)).status_code == 403

    confirmed = await client.post("/auth/passkeys/register/confirm", headers=auth)
    assert confirmed.status_code == 204

    # Restriction lifted, but completing the forced re-enrol signed the restricted session out
    assert await _is_reenrollment_required(user_id) is False
    assert (await client.get("/auth/passkeys", headers=auth)).status_code == 401

    # The passkey is active on the account, ready for the user's fresh login
    async with TestSession() as db:
        active = (
            await db.execute(
                select(WebauthnCredential).where(
                    WebauthnCredential.user_id == uuid.UUID(user_id),
                    WebauthnCredential.confirmed_at.is_not(None),
                )
            )
        ).scalars().all()
    assert [passkey.name for passkey in active] == ["Recovery key"]


async def test_recovery_code_login_wipes_all_passkeys(client, monkeypatch):
    """A recovery-code sign-in deletes every passkey and the WebAuthn identity"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    user_id = signup.json()["user"]["id"]

    registered = await _register_passkey(client, auth, monkeypatch, b"to-wipe-key", "Laptop")
    codes = registered.json()["recovery_codes"]
    await client.post("/auth/passkeys/register/confirm", headers=auth)
    assert await _has_webauthn_identity(user_id) is True

    login = await client.post("/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": SIGNUP_PAYLOAD["password"]})
    verify = await client.post("/auth/2fa/verify", json={"mfa_token": login.json()["mfa_token"], "code": codes[0]})
    assert verify.status_code == 200
    assert verify.json()["user"]["second_factor_reenrollment_required"] is True

    # The passkey rows and the WebAuthn identity are gone, leaving only the forced re-enrol path
    async with TestSession() as db:
        remaining = (
            await db.execute(select(WebauthnCredential).where(WebauthnCredential.user_id == uuid.UUID(user_id)))
        ).scalars().all()
        assert remaining == []
    assert await _has_webauthn_identity(user_id) is False


async def test_restricted_session_cannot_manage_passkeys(client):
    """A restricted session is still kept out of passkey management until it re-establishes"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    await _set_reenrollment_required(signup.json()["user"]["id"])

    response = await client.get("/auth/passkeys", headers=auth)
    assert response.status_code == 403
