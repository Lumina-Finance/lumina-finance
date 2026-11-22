"""Passkey registration, management, and sign-in route tests

Most tests replace the library's attestation and assertion checks with fixed results so they can
exercise the real challenge, storage, and identity logic. The ceremony tests at the end of this file
instead sign real responses with a software authenticator, so a library upgrade that changes what
those calls accept, return, or raise fails here rather than passing unnoticed
"""

import asyncio
import hashlib
import json
import os
import struct
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import cbor2
import pyotp
import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException
from sqlalchemy import func, select, text, update
from sqlalchemy.exc import DBAPIError
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url

import app.services.auth.webauthn as webauthn_service
from app.config.two_factor import TWO_FACTOR_STAGING_EXPIRE_SECONDS
from app.config.webauthn import WEBAUTHN_ORIGINS, WEBAUTHN_RP_ID
from app.models.auth import AuthIdentity, RecoveryCode, WebauthnChallenge, WebauthnCredential
from app.models.auth_session import AuthSession
from app.models.base import AuthProvider
from app.models.user import User
from app.services.auth import two_factor
from app.services.auth.recovery_codes import generate_recovery_codes
from app.services.auth.saved_copy_key import derive_saved_copy_key
from app.services.service_name import set_service_name
from tests.conftest import TestSession
from tests.routes.support import (
    SIGNUP_PAYLOAD,
    _assert_other_sessions_ended,
    _assert_other_sessions_kept,
    _assert_session_works,
    _count_sign_in_provider_links,
    _create_user,
    _get_auth_header,
    _get_browser_lockout,
    _get_step_up_lockout,
    _link_sign_in_providers,
    _saved_copy_key,
    _seed_reset_token,
    _sign_in_again,
    sign_up_confirmed,
)

_NEW_PASSWORD = "NewSecurePass123!"

# Authenticator data flag bits, which tell the library whether the user was present and verified and
# whether an attested credential follows the header
_FLAG_USER_PRESENT = 0x01
_FLAG_USER_VERIFIED = 0x04
_FLAG_BACKUP_ELIGIBLE = 0x08
_FLAG_BACKED_UP = 0x10
_FLAG_ATTESTED_CREDENTIAL = 0x40

# An authenticator that reports no make and model sends an all-zero identifier
_TEST_AAGUID = bytes(16)

_CREDENTIAL_ID_BYTES = 32
_P256_COORDINATE_BYTES = 32

# Counter a signed assertion reports, which has to exceed the count stored at registration
_ASSERTION_SIGN_COUNT = 5


async def _create_second_user(client):
    """Sign up a second user reusing the seeded currency, returning the auth response"""
    payload = {**SIGNUP_PAYLOAD, "email": "second@example.com"}
    return await sign_up_confirmed(client, payload)


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


async def _seed_passkeys(user_id: str, count: int, *, confirmed: bool = True) -> None:
    """Insert the given number of passkeys at once, confirmed or staged, with ids no other test uses"""
    async with TestSession() as db:
        db.add_all(
            WebauthnCredential(
                user_id=uuid.UUID(user_id),
                credential_id=f"bulk-{confirmed}-{index}".encode(),
                public_key=b"public-key-bytes",
                sign_count=0,
                name=f"Bulk key {index}",
                confirmed_at=datetime.now(UTC) if confirmed else None,
            )
            for index in range(count)
        )
        if confirmed:
            # A confirmed passkey comes with the identity and recovery codes the first one stages
            db.add(AuthIdentity(user_id=uuid.UUID(user_id), auth_provider=AuthProvider.WEBAUTHN))
            db.add(RecoveryCode(user_id=uuid.UUID(user_id), code_hash="seeded-active-code", pending=False))
        await db.commit()


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


async def test_registration_options_persist_single_challenge(client, environment_naming_another_service):
    """The options endpoint returns ceremony fields under the fixed name and persists one challenge

    Variables naming another service stay set throughout the request
    """
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    user_id = signup.json()["user"]["id"]

    response = await client.post("/auth/passkeys/register/options", headers=auth, json={"step_up": {"password": SIGNUP_PAYLOAD["password"]}})
    assert response.status_code == 200

    options = response.json()
    assert "challenge" in options
    assert options["authenticatorSelection"]["residentKey"] == "required"
    assert options["authenticatorSelection"]["userVerification"] == "required"
    assert options["rp"]["id"] == WEBAUTHN_RP_ID
    assert options["rp"]["name"] == "Lumina Finance Self-Hosted"

    assert await _count_registration_challenges(user_id) == 1


async def test_registration_options_carry_the_service_name_code_set(client):
    """The prompt shows the name code gave the service"""
    auth = _get_auth_header(await _create_user(client))
    set_service_name("Example Service")

    options = await _request_registration_options(client, auth)

    assert options["rp"]["name"] == "Example Service"


async def test_registration_options_exclude_existing_passkeys(client, monkeypatch):
    """A registered passkey appears in excludeCredentials so it cannot be enrolled twice"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    user_id = signup.json()["user"]["id"]
    credential_id = b"existing-credential-id"
    await _seed_passkey(user_id, credential_id)

    # The existing passkey is a factor now, so starting another registration steps up with it
    step_up = await _step_up_with_passkey(client, auth, monkeypatch, user_id, credential_id)
    options = (await client.post("/auth/passkeys/register/options", headers=auth, json={"step_up": step_up})).json()

    excluded = {entry["id"] for entry in options["excludeCredentials"]}
    assert bytes_to_base64url(credential_id) in excluded


async def _register_passkey(client, auth, monkeypatch, credential_id: bytes, name: str, *, step_up=None, transports=None):
    """Run a stubbed registration ceremony and return the register response

    The step-up now gates the options call so it runs before the ceremony, so the first passkey defaults
    to a password-only reauthorization and a later one passes an explicit step_up carrying a current factor.
    The transports the browser reports default to two known ones
    """
    options_body = {"step_up": step_up or {"password": SIGNUP_PAYLOAD["password"]}}
    options = (await client.post("/auth/passkeys/register/options", headers=auth, json=options_body)).json()
    credential = _build_credential(options["challenge"], credential_id)
    if transports is not None:
        credential["response"]["transports"] = transports

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

    return await client.post("/auth/passkeys/register", headers=auth, json={"name": name, "credential": credential})


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


async def test_abandoned_staged_passkey_is_superseded_by_a_new_one(client, monkeypatch):
    """Staging a fresh passkey supersedes one left staged by an abandoned attempt

    Confirming the new recovery codes then activates only the new passkey rather than also reviving the
    abandoned one
    """
    auth = _get_auth_header(await _create_user(client))

    # First attempt is staged then abandoned without acknowledging its recovery codes
    await _register_passkey(client, auth, monkeypatch, b"abandoned-key", "Abandoned")

    # A second successful attempt supersedes the abandoned staging
    second = await _register_passkey(client, auth, monkeypatch, b"kept-key", "Kept")
    assert second.status_code == 201
    assert len(second.json()["recovery_codes"]) == 10

    await client.post("/auth/passkeys/register/confirm", headers=auth)

    # Only the passkey whose codes were acknowledged is active, the abandoned one is gone
    assert [p["name"] for p in (await client.get("/auth/passkeys", headers=auth)).json()] == ["Kept"]


async def test_totp_setup_supersedes_an_abandoned_staged_passkey(client, monkeypatch):
    """Beginning TOTP enrolment drops a passkey left staged

    Confirming it later cannot activate it nor promote the authenticator's recovery batch as though the
    passkey's own codes were saved
    """
    auth = _get_auth_header(await _create_user(client))

    # Stage a first passkey with its own pending recovery batch, then abandon it
    registered = await _register_passkey(client, auth, monkeypatch, b"abandoned-key", "Abandoned")
    assert registered.json()["recovery_codes"] is not None

    # Enrol TOTP: setup supersedes the staged passkey and its batch, confirm stages a fresh one that
    # belongs to the authenticator, not the abandoned passkey
    secret = (await client.post("/auth/2fa/setup", headers=auth, json={"step_up": {"password": SIGNUP_PAYLOAD["password"]}})).json()["secret"]
    totp_batch = (await client.post("/auth/2fa/confirm", headers=auth, json={"code": pyotp.TOTP(secret).now()})).json()["recovery_codes"]
    assert len(totp_batch) == 10

    # The staged passkey is gone, so confirming it is refused and it never becomes a live factor
    confirm = await client.post("/auth/passkeys/register/confirm", headers=auth)
    assert confirm.status_code == 400
    assert (await client.get("/auth/passkeys", headers=auth)).json() == []

    # The authenticator is not stranded either: its own enrolment completes and turns two-factor on
    assert (await client.post("/auth/2fa/complete", headers=auth)).status_code == 204
    assert (await client.get("/auth/2fa/status", headers=auth)).json()["totp_enabled"] is True


async def test_registering_a_passkey_supersedes_an_abandoned_staged_totp(client, monkeypatch):
    """Registering a passkey drops an unconfirmed authenticator, the mirror of the setup-time sweep

    Completing that stranded TOTP later cannot turn it on against the passkey's recovery batch, and the
    passkey still confirms cleanly against its own
    """
    auth = _get_auth_header(await _create_user(client))
    password = SIGNUP_PAYLOAD["password"]

    # Stage a first authenticator with its own pending batch, but do not complete enrolment
    secret = (await client.post("/auth/2fa/setup", headers=auth, json={"step_up": {"password": password}})).json()["secret"]
    totp_batch = (await client.post("/auth/2fa/confirm", headers=auth, json={"code": pyotp.TOTP(secret).now()})).json()["recovery_codes"]
    assert len(totp_batch) == 10

    # Registering a passkey supersedes the staged authenticator and stages the passkey's own batch
    registered = await _register_passkey(client, auth, monkeypatch, b"kept-key", "Kept")
    assert registered.json()["recovery_codes"] is not None

    # The authenticator is gone, so completing it is refused and two-factor never turns on
    assert (await client.post("/auth/2fa/complete", headers=auth)).status_code == 400
    assert (await client.get("/auth/2fa/status", headers=auth)).json()["totp_enabled"] is False

    # The passkey still confirms cleanly against its own recovery batch
    assert (await client.post("/auth/passkeys/register/confirm", headers=auth)).status_code == 204
    assert [p["name"] for p in (await client.get("/auth/passkeys", headers=auth)).json()] == ["Kept"]


async def test_second_passkey_activates_without_new_codes(client, monkeypatch):
    """Once recovery codes exist, a further passkey is active immediately and issues no new codes"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    user_id = signup.json()["user"]["id"]

    await _register_passkey(client, auth, monkeypatch, b"first-key", "First")
    await client.post("/auth/passkeys/register/confirm", headers=auth)

    # The first passkey is now a live factor, so adding a second steps up with it
    step_up = await _step_up_with_passkey(client, auth, monkeypatch, user_id, b"first-key")
    second = await _register_passkey(client, auth, monkeypatch, b"second-key", "Second", step_up=step_up)
    assert second.status_code == 201
    assert second.json()["recovery_codes"] is None

    names = {p["name"] for p in (await client.get("/auth/passkeys", headers=auth)).json()}
    assert names == {"First", "Second"}


async def test_first_passkey_confirmed_signs_out_other_sessions(client, monkeypatch):
    """Turning on a first passkey signs out every other device and keeps the one that turned it on"""
    signup = await _create_user(client)
    caller = (_get_auth_header(signup), signup.cookies["refresh_token"])
    other = await _sign_in_again(client)
    await _assert_session_works(client, caller)
    await _assert_session_works(client, other)

    await _register_passkey(client, caller[0], monkeypatch, b"first-key", "First")
    confirmed = await client.post("/auth/passkeys/register/confirm", headers=caller[0])
    assert confirmed.status_code == 204

    await _assert_other_sessions_ended(client, caller, other)


async def test_passkey_confirmation_refused_keeps_other_sessions(client):
    """Confirming with no staged passkey is refused and signs nobody out"""
    signup = await _create_user(client)
    caller = (_get_auth_header(signup), signup.cookies["refresh_token"])
    other = await _sign_in_again(client)

    confirmed = await client.post("/auth/passkeys/register/confirm", headers=caller[0])
    assert confirmed.status_code == 400

    await _assert_other_sessions_kept(client, caller, other)


async def test_later_passkey_added_keeps_other_sessions(client, monkeypatch):
    """A second passkey is a stronger account, not a credential change, so other devices stay signed in"""
    signup = await _create_user(client)
    user_id = signup.json()["user"]["id"]
    caller = (_get_auth_header(signup), signup.cookies["refresh_token"])
    other = await _sign_in_again(client)

    # Seeded directly, since once a passkey is confirmed the account challenges at sign-in
    await _seed_passkeys(user_id, 1)
    step_up = await _step_up_with_passkey(client, caller[0], monkeypatch, user_id, b"bulk-True-0")
    second = await _register_passkey(client, caller[0], monkeypatch, b"second-key", "Second", step_up=step_up)
    assert second.status_code == 201

    await _assert_other_sessions_kept(client, caller, other)


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

    # Registration is ungated because the options step already stepped up, so the unknown challenge is
    # what fails here
    response = await client.post("/auth/passkeys/register", headers=auth, json={"name": "Key", "credential": credential})
    assert response.status_code == 400


async def test_register_rejects_malformed_response(client):
    """A response missing the client data is rejected as malformed"""
    auth = _get_auth_header(await _create_user(client))

    # Registration is ungated because the options step already stepped up, so the malformed attestation
    # is what fails here
    response = await client.post("/auth/passkeys/register", headers=auth, json={"name": "Key", "credential": {"id": "x"}})
    assert response.status_code == 400


_MALFORMED_DETAIL = "This passkey sent details we couldn't read"
_LIMIT_DETAIL = "You've reached the limit of 20 passkeys"
_CONFIRMED_LIMIT = 20
_EIGHT_TRANSPORTS = ["usb", "nfc", "ble", "hybrid", "internal", "usb", "nfc", "ble"]


async def test_register_keeps_the_known_transports_and_drops_the_rest(client, monkeypatch):
    """A browser that reports a transport the library doesn't know yet still registers, and only the known ones are kept"""
    auth = _get_auth_header(await _create_user(client))

    registered = await _register_passkey(client, auth, monkeypatch, b"transport-key", "Phone", transports=["internal", "teleport", "hybrid"])

    assert registered.status_code == 201
    assert (await _read_passkey(b"transport-key")).transports == "internal,hybrid"


async def test_register_accepts_eight_transports(client, monkeypatch):
    """Eight transport hints, the most one authenticator reports, are stored"""
    auth = _get_auth_header(await _create_user(client))

    registered = await _register_passkey(client, auth, monkeypatch, b"eight-key", "Phone", transports=_EIGHT_TRANSPORTS)

    assert registered.status_code == 201
    assert (await _read_passkey(b"eight-key")).transports == ",".join(_EIGHT_TRANSPORTS)


@pytest.mark.parametrize(
    "transports",
    [[*_EIGHT_TRANSPORTS, "usb"], ["usb"] * 1000, [1, 2], "internal", {"internal": True}, ["internal", None]],
    ids=["nine", "a-thousand", "numbers", "text-not-a-list", "object", "null-entry"],
)
async def test_register_refuses_transports_that_are_not_a_short_list_of_text(client, monkeypatch, transports):
    """Nine or more hints, or hints that are not text, are refused as unreadable and nothing is stored"""
    auth = _get_auth_header(await _create_user(client))

    registered = await _register_passkey(client, auth, monkeypatch, b"bad-transport-key", "Phone", transports=transports)

    assert (registered.status_code, registered.json()["detail"]) == (400, _MALFORMED_DETAIL)
    assert await _read_passkey(b"bad-transport-key") is None


@pytest.mark.parametrize(("size", "status"), [(1023, 201), (1024, 400)])
async def test_register_refuses_a_credential_id_over_1023_bytes(client, monkeypatch, size, status):
    """A credential id is at most 1023 bytes, so 1023 registers and 1024 is refused as unreadable"""
    auth = _get_auth_header(await _create_user(client))
    credential_id = b"k" * size

    registered = await _register_passkey(client, auth, monkeypatch, credential_id, "Long id")

    assert registered.status_code == status
    if status == 400:
        assert registered.json()["detail"] == _MALFORMED_DETAIL
        assert await _read_passkey(credential_id) is None


async def test_register_refuses_a_credential_another_account_already_holds(client, monkeypatch):
    """A credential id already stored is answered as already registered, not as a server error"""
    first = await _create_user(client)
    await _seed_passkey(first.json()["user"]["id"], b"shared-credential")
    second = await sign_up_confirmed(client, {**SIGNUP_PAYLOAD, "email": "second@example.com"})
    assert second.status_code == 201

    registered = await _register_passkey(client, _get_auth_header(second), monkeypatch, b"shared-credential", "Copy")

    assert (registered.status_code, registered.json()["detail"]) == (400, "This passkey is already registered")


async def test_register_refuses_a_passkey_added_after_its_options_brought_the_account_to_the_limit(client, monkeypatch):
    """Nineteen passkeys beside a staged one leave room for one more, and the register step refuses it once the account holds twenty"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    user_id = signup.json()["user"]["id"]
    await _seed_passkeys(user_id, _CONFIRMED_LIMIT - 1)
    await _seed_passkeys(user_id, 1, confirmed=False)

    # A staged passkey is not usable yet, so it does not count against the limit
    step_up = await _step_up_with_passkey(client, auth, monkeypatch, user_id, b"bulk-True-0")
    options = await client.post("/auth/passkeys/register/options", headers=auth, json={"step_up": step_up})
    assert options.status_code == 200
    credential = _build_credential(options.json()["challenge"], b"twentieth-key")
    await _seed_passkey(user_id, b"extra-key")

    # The twentieth was added behind this ceremony's back, so the register step is where it is refused
    monkeypatch.setattr(
        webauthn_service,
        "verify_registration_response",
        lambda **_: SimpleNamespace(credential_id=b"twentieth-key", credential_public_key=b"verified-public-key", sign_count=1),
    )
    late = await client.post("/auth/passkeys/register", headers=auth, json={"name": "Late", "credential": credential})
    assert (late.status_code, late.json()["detail"]) == (422, _LIMIT_DETAIL)
    assert await _read_passkey(b"twentieth-key") is None


async def test_twentieth_passkey_registers_and_the_next_is_refused(client, monkeypatch):
    """The twentieth passkey is stored, and a twenty-first ceremony is refused before it starts"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    user_id = signup.json()["user"]["id"]
    await _seed_passkeys(user_id, _CONFIRMED_LIMIT - 1)

    step_up = await _step_up_with_passkey(client, auth, monkeypatch, user_id, b"bulk-True-0")
    twentieth = await _register_passkey(client, auth, monkeypatch, b"twentieth-key", "Twentieth", step_up=step_up)
    assert twentieth.status_code == 201

    step_up = await _step_up_with_passkey(client, auth, monkeypatch, user_id, b"bulk-True-0")
    refused = await client.post("/auth/passkeys/register/options", headers=auth, json={"step_up": step_up})
    assert (refused.status_code, refused.json()["detail"]) == (422, _LIMIT_DETAIL)


async def test_two_registrations_at_nineteen_passkeys_store_only_one(client, monkeypatch):
    """Two ceremonies finishing together with room for one more can't both be stored"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    user_id = signup.json()["user"]["id"]
    await _seed_passkeys(user_id, _CONFIRMED_LIMIT - 1)

    ceremonies = []
    for credential_id in (b"racing-key-one", b"racing-key-two"):
        step_up = await _step_up_with_passkey(client, auth, monkeypatch, user_id, b"bulk-True-0")
        options = (await client.post("/auth/passkeys/register/options", headers=auth, json={"step_up": step_up})).json()
        ceremonies.append(_build_credential(options["challenge"], credential_id))
    monkeypatch.setattr(
        webauthn_service,
        "verify_registration_response",
        lambda **kwargs: SimpleNamespace(
            credential_id=base64url_to_bytes(kwargs["credential"]["rawId"]), credential_public_key=b"verified-public-key", sign_count=1
        ),
    )

    # The first registration waits after counting, and the second sets off while it does
    first_held = asyncio.Event()
    release = asyncio.Event()
    claims = []
    claim_challenge = webauthn_service._claim_registration_challenge

    async def hold_the_first(*args, **kwargs):
        """Park the first registration to finish, once it holds whatever the count relied on"""
        claims.append(None)
        if len(claims) == 1:
            first_held.set()
            await release.wait()
        return await claim_challenge(*args, **kwargs)

    monkeypatch.setattr(webauthn_service, "_claim_registration_challenge", hold_the_first)

    async def register(credential: dict):
        """Finish one registration ceremony"""
        return await client.post("/auth/passkeys/register", headers=auth, json={"name": "Racing", "credential": credential})

    requests = [asyncio.create_task(register(ceremonies[0]))]
    try:
        async with asyncio.timeout(10):
            await first_held.wait()
            requests.append(asyncio.create_task(register(ceremonies[1])))

            # The second either queues behind the first's lock on the account or, with no lock, carries on to its own claim
            while len(claims) < 2 and not await _any_backend_waiting_for_a_lock():
                await asyncio.sleep(0.02)
            release.set()
            responses = await asyncio.gather(*requests)
    finally:
        release.set()
        await asyncio.gather(*requests, return_exceptions=True)

    assert sorted(response.status_code for response in responses) == [201, 422]
    async with TestSession() as db:
        held = await db.scalar(select(func.count()).select_from(WebauthnCredential).where(WebauthnCredential.confirmed_at.is_not(None)))
    assert held == _CONFIRMED_LIMIT


async def _any_backend_waiting_for_a_lock() -> bool:
    """Return whether a request of this test's database is waiting on a row lock"""
    async with TestSession() as observer:
        # The wait columns of pg_stat_activity are hidden from another role, but the lock table is not
        waiting = await observer.scalar(
            text(
                "SELECT count(*) FROM pg_locks WHERE NOT granted "
                "AND pid IN (SELECT pid FROM pg_stat_activity WHERE datname = current_database())"
            )
        )
    return waiting > 0


async def test_registration_options_without_reauthentication_is_rejected(client):
    """Starting registration with no step-up is refused, so a stolen access token cannot plant a factor"""
    auth = _get_auth_header(await _create_user(client))

    # The gate is on options, so no challenge is issued and no ceremony can run
    response = await client.post("/auth/passkeys/register/options", headers=auth, json={})
    assert response.status_code == 401
    assert (await client.get("/auth/passkeys", headers=auth)).json() == []


async def test_registration_options_reject_a_wrong_password(client):
    """A wrong step-up password is refused before any registration challenge is issued"""
    auth = _get_auth_header(await _create_user(client))

    response = await client.post("/auth/passkeys/register/options", headers=auth, json={"step_up": {"password": "WrongPassword123!"}})
    assert response.status_code == 401


async def test_adding_a_second_passkey_requires_the_existing_factor(client):
    """Once a factor is active, a password-only step-up cannot start adding another passkey"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    await _seed_passkey(signup.json()["user"]["id"], b"existing-factor-key")

    # Password alone no longer suffices once a factor exists, the current factor must be presented
    response = await client.post("/auth/passkeys/register/options", headers=auth, json={"step_up": {"password": SIGNUP_PAYLOAD["password"]}})
    assert response.status_code == 400


async def test_rename_passkey_updates_label(client):
    """Renaming a passkey returns the new label"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    passkey_id = await _seed_passkey(signup.json()["user"]["id"], b"rename-credential")

    response = await client.patch(f"/auth/passkeys/{passkey_id}", headers=auth, json={"name": "Renamed key"})
    assert response.status_code == 200
    assert response.json()["name"] == "Renamed key"


async def test_rename_rejects_another_users_passkey(client):
    """A user cannot rename a passkey that belongs to someone else"""
    auth = _get_auth_header(await _create_user(client))
    other = await _create_second_user(client)
    other_passkey = await _seed_passkey(other.json()["user"]["id"], b"other-credential")

    response = await client.patch(f"/auth/passkeys/{other_passkey}", headers=auth, json={"name": "Hijack"})
    assert response.status_code == 404


async def _step_up_with_passkey(client, auth, monkeypatch, user_id: str, credential_id: bytes) -> dict:
    """Run a passkey step-up ceremony and return the step-up request body for a sensitive action"""
    options = (await client.post("/auth/passkeys/step-up/options", headers=auth)).json()
    assertion = _build_assertion(options["challenge"], credential_id, user_id)
    monkeypatch.setattr(webauthn_service, "verify_authentication_response", lambda **_: SimpleNamespace(new_sign_count=1))
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


async def test_passkey_removed_signs_out_other_sessions(client, monkeypatch):
    """Removing a passkey signs out every other device and keeps the one that removed it"""
    signup = await _create_user(client)
    user_id = signup.json()["user"]["id"]
    caller = (_get_auth_header(signup), signup.cookies["refresh_token"])
    other = await _sign_in_again(client)
    first = await _seed_passkey(user_id, b"first-credential")
    await _seed_passkey(user_id, b"second-credential")
    await _assert_session_works(client, caller)
    await _assert_session_works(client, other)

    body = await _step_up_with_passkey(client, caller[0], monkeypatch, user_id, b"second-credential")
    removed = await client.post(f"/auth/passkeys/{first}/remove", headers=caller[0], json=body)
    assert removed.status_code == 204

    await _assert_other_sessions_ended(client, caller, other)


async def test_passkey_removal_refused_keeps_other_sessions(client, monkeypatch):
    """A wrong password, or a passkey that is not the user's, is refused and signs nobody out"""
    signup = await _create_user(client)
    user_id = signup.json()["user"]["id"]
    caller = (_get_auth_header(signup), signup.cookies["refresh_token"])
    other = await _sign_in_again(client)
    passkey_id = await _seed_passkey(user_id, b"protected-credential")

    wrong_password = await client.post(
        f"/auth/passkeys/{passkey_id}/remove", headers=caller[0], json={"password": "WrongPass123!", "code": "000000"}
    )
    assert wrong_password.status_code == 401

    body = await _step_up_with_passkey(client, caller[0], monkeypatch, user_id, b"protected-credential")
    unknown = await client.post(f"/auth/passkeys/{uuid.uuid4()}/remove", headers=caller[0], json=body)
    assert unknown.status_code == 404

    await _assert_other_sessions_kept(client, caller, other)


async def test_passkey_removal_failing_while_ending_sessions_keeps_passkey_and_codes(client, monkeypatch):
    """The removal, the recovery code drop and the sign-outs land together or not at all"""
    signup = await _create_user(client)
    user_id = signup.json()["user"]["id"]
    caller = (_get_auth_header(signup), signup.cookies["refresh_token"])
    other = await _sign_in_again(client)

    # One passkey with its recovery batch, so removing it would also drop the identity and the codes
    await _seed_passkeys(user_id, 1)
    passkey_id = (await client.get("/auth/passkeys", headers=caller[0])).json()[0]["id"]
    body = await _step_up_with_passkey(client, caller[0], monkeypatch, user_id, b"bulk-True-0")

    async def fail_ending_sessions(db, ending_user_id, keep_session_id):
        """Fail inside the database, so the transaction is really broken"""
        await db.execute(text("SELECT 1 / 0"))

    monkeypatch.setattr(two_factor, "delete_other_user_auth_sessions", fail_ending_sessions)
    with pytest.raises(DBAPIError, match="division by zero"):
        await client.post(f"/auth/passkeys/{passkey_id}/remove", headers=caller[0], json=body)

    async with TestSession() as db:
        assert await db.get(WebauthnCredential, uuid.UUID(passkey_id)) is not None, "the passkey is still there"
        codes = await db.scalar(select(func.count()).select_from(RecoveryCode).where(RecoveryCode.user_id == uuid.UUID(user_id)))
        assert codes == 1, "the recovery codes are still there"
    assert await _has_webauthn_identity(user_id) is True
    await _assert_other_sessions_kept(client, caller, other)


async def test_remove_passkey_rejects_a_wrong_password(client):
    """Passkey removal refuses a wrong password and leaves the passkey in place"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    passkey_id = await _seed_passkey(signup.json()["user"]["id"], b"protected-credential")

    rejected = await client.post(f"/auth/passkeys/{passkey_id}/remove", headers=auth, json={"password": "WrongPass123!", "code": "000000"})
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
    # Adding TOTP as a second factor steps up with the existing passkey before the secret is minted
    totp_step_up = await _step_up_with_passkey(client, auth, monkeypatch, user_id, credential_id)
    secret = (await client.post("/auth/2fa/setup", headers=auth, json={"step_up": totp_step_up})).json()["secret"]
    await client.post("/auth/2fa/confirm", headers=auth, json={"code": pyotp.TOTP(secret).now()})
    await client.post("/auth/2fa/complete", headers=auth)

    body = await _step_up_with_passkey(client, auth, monkeypatch, user_id, credential_id)
    removed = await client.post(f"/auth/passkeys/{passkey_id}/remove", headers=auth, json=body)
    assert removed.status_code == 204

    async with TestSession() as db:
        active = (
            (await db.execute(select(RecoveryCode).where(RecoveryCode.user_id == uuid.UUID(user_id), RecoveryCode.pending.is_(False))))
            .scalars()
            .all()
        )
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
        remaining = (await db.execute(select(RecoveryCode).where(RecoveryCode.user_id == uuid.UUID(user_id)))).scalars().all()
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
        return await db.scalar(select(WebauthnCredential).where(WebauthnCredential.credential_id == credential_id))


async def test_authentication_options_persist_unscoped_challenge(client):
    """The options endpoint is public, requires user verification, and stores a userless challenge"""
    response = await client.post("/auth/passkeys/authenticate/options")
    assert response.status_code == 200

    options = response.json()
    assert "challenge" in options
    assert options["userVerification"] == "required"
    assert options["rpId"] == WEBAUTHN_RP_ID

    async with TestSession() as db:
        rows = list(await db.scalars(select(WebauthnChallenge).where(WebauthnChallenge.purpose == "authentication")))
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


async def test_an_expired_sign_in_challenge_is_refused_and_left_to_the_scheduled_cleanup(client, monkeypatch):
    """Starting any passkey ceremony deletes no expired challenge, and answering one past its expiry is refused"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    user_id = signup.json()["user"]["id"]
    credential_id = b"expired-challenge-credential"
    expired = (await client.post("/auth/passkeys/authenticate/options")).json()
    async with TestSession() as db:
        expired_id = (await db.scalars(select(WebauthnChallenge.id))).one()
        await db.execute(update(WebauthnChallenge).values(expires_at=datetime.now(UTC) - timedelta(seconds=1)))
        await db.commit()
    monkeypatch.setattr(webauthn_service, "verify_authentication_response", lambda **_: SimpleNamespace(new_sign_count=1))

    async def is_expired_challenge_kept():
        async with TestSession() as db:
            return await db.get(WebauthnChallenge, expired_id) is not None

    registration = await client.post(
        "/auth/passkeys/register/options", headers=auth, json={"step_up": {"password": SIGNUP_PAYLOAD["password"]}}
    )
    assert registration.status_code == 200
    assert await is_expired_challenge_kept(), "starting a registration leaves it to the scheduled cleanup"
    await _seed_passkey(user_id, credential_id)
    mfa_token = (await _login(client)).json()["mfa_token"]
    assert (await client.post("/auth/passkeys/mfa/options", json={"mfa_token": mfa_token})).status_code == 200
    assert await is_expired_challenge_kept(), "starting a second-factor step leaves it to the scheduled cleanup"
    assert (await client.post("/auth/passkeys/authenticate/options")).status_code == 200
    assert await is_expired_challenge_kept(), "starting a sign-in leaves it to the scheduled cleanup"

    refused = await client.post(
        "/auth/passkeys/authenticate", json={"credential": _build_assertion(expired["challenge"], credential_id, user_id)}
    )
    assert (refused.status_code, refused.json()["detail"]) == (400, "Passkey challenge expired")


async def test_authenticate_rejects_malformed_response(client):
    """An assertion missing the client data is rejected as malformed"""
    response = await client.post("/auth/passkeys/authenticate", json={"credential": {"rawId": "x"}})
    assert response.status_code == 400


async def _seed_stale_staged_passkey(user_id: str, credential_id: bytes) -> None:
    """Insert a staged passkey and a pending recovery code old enough to be pruned"""
    stale = datetime.now(UTC) - timedelta(seconds=TWO_FACTOR_STAGING_EXPIRE_SECONDS + 60)
    async with TestSession() as db:
        db.add(
            WebauthnCredential(
                user_id=uuid.UUID(user_id),
                credential_id=credential_id,
                public_key=b"public-key-bytes",
                sign_count=0,
                name="Staged",
                confirmed_at=None,
                created_at=stale,
            )
        )
        db.add(RecoveryCode(user_id=uuid.UUID(user_id), code_hash="stale-hash", pending=True, created_at=stale))
        await db.commit()


async def _stage_passkey_with_pending_codes(user_id: str, credential_id: bytes) -> None:
    """Stage an unconfirmed passkey with a pending recovery batch, as a first-factor registration leaves it"""
    async with TestSession() as db:
        db.add(
            WebauthnCredential(
                user_id=uuid.UUID(user_id),
                credential_id=credential_id,
                public_key=b"public-key-bytes",
                sign_count=0,
                name="Staged",
                confirmed_at=None,
            )
        )
        await generate_recovery_codes(db, uuid.UUID(user_id), pending=True)
        await db.commit()


async def test_concurrent_passkey_confirmation_keeps_the_recovery_codes(client):
    """Two confirms racing on one staged passkey activate it once and never strand it without codes"""
    signup = await _create_user(client)
    user_id = signup.json()["user"]["id"]
    await _stage_passkey_with_pending_codes(user_id, b"race-staged-key")
    user_uuid = uuid.UUID(user_id)

    async with TestSession() as db:
        session_id = await db.scalar(select(AuthSession.id).where(AuthSession.user_id == user_uuid))

    async with TestSession() as first, TestSession() as second:
        results = await asyncio.gather(
            webauthn_service.confirm_passkey_registration(first, user_uuid, session_id),
            webauthn_service.confirm_passkey_registration(second, user_uuid, session_id),
            return_exceptions=True,
        )

    successes = [result for result in results if not isinstance(result, Exception)]
    failures = [result for result in results if isinstance(result, Exception)]

    # One confirm promotes the passkey while the other, serialized behind the row lock, finds nothing staged
    assert len(successes) == 1
    assert len(failures) == 1
    assert isinstance(failures[0], HTTPException)
    assert failures[0].status_code == 400

    async with TestSession() as check:
        active_passkeys = await check.execute(
            select(WebauthnCredential).where(WebauthnCredential.user_id == user_uuid, WebauthnCredential.confirmed_at.is_not(None))
        )
        active_codes = await check.execute(select(RecoveryCode).where(RecoveryCode.user_id == user_uuid, RecoveryCode.pending.is_(False)))
        pending_codes = await check.execute(select(RecoveryCode).where(RecoveryCode.user_id == user_uuid, RecoveryCode.pending.is_(True)))

    # The passkey is active and still backed by its promoted batch, never left enforced with no codes
    assert len(active_passkeys.scalars().all()) == 1
    assert len(active_codes.scalars().all()) == 10
    assert pending_codes.scalars().all() == []


async def test_confirm_refuses_a_staged_passkey_past_its_lifetime(client):
    """A first passkey left unacknowledged past the staging lifetime can't be turned on later"""
    signup = await _create_user(client)
    await _seed_stale_staged_passkey(signup.json()["user"]["id"], b"stale-staged-key")

    confirm = await client.post("/auth/passkeys/register/confirm", headers=_get_auth_header(signup))
    assert confirm.status_code == 400
    assert confirm.json()["detail"] == "No passkey awaiting confirmation"
    async with TestSession() as db:
        staged = await db.scalar(select(WebauthnCredential).where(WebauthnCredential.credential_id == b"stale-staged-key"))
    assert staged.confirmed_at is None


async def test_registration_options_drop_only_the_users_expired_staged_passkeys(client, monkeypatch):
    """Starting again after an expired passkey setup frees that authenticator and keeps every other passkey"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    user_id = signup.json()["user"]["id"]
    other_id = (await _create_second_user(client)).json()["user"]["id"]
    await _seed_passkey(user_id, b"old-confirmed-key")
    async with TestSession() as db:
        await db.execute(
            update(WebauthnCredential)
            .where(WebauthnCredential.credential_id == b"old-confirmed-key")
            .values(created_at=datetime.now(UTC) - timedelta(days=30))
        )
        await db.commit()
    await _seed_stale_staged_passkey(user_id, b"stale-staged-key")
    await _stage_passkey_with_pending_codes(user_id, b"fresh-staged-key")
    await _seed_stale_staged_passkey(other_id, b"other-stale-key")

    step_up = await _step_up_with_passkey(client, auth, monkeypatch, user_id, b"old-confirmed-key")
    response = await client.post("/auth/passkeys/register/options", headers=auth, json={"step_up": step_up})
    assert response.status_code == 200

    excluded = {entry["id"] for entry in response.json()["excludeCredentials"]}
    assert excluded == {bytes_to_base64url(b"old-confirmed-key"), bytes_to_base64url(b"fresh-staged-key")}
    async with TestSession() as db:
        remaining = set((await db.scalars(select(WebauthnCredential.credential_id))).all())
    assert remaining == {b"old-confirmed-key", b"fresh-staged-key", b"other-stale-key"}


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


async def test_passkey_ceremony_that_never_started_does_not_use_up_an_attempt(client):
    """A passkey answer to a challenge the server never issued is a protocol error, so it leaves the lockout allowance whole"""
    signup = await _create_user(client)
    user_id = signup.json()["user"]["id"]
    await _seed_passkey(user_id, b"unstarted-key")
    mfa_token = (await _login(client)).json()["mfa_token"]

    stale = _build_assertion("never-issued-challenge", b"unstarted-key", user_id)
    verified = await client.post("/auth/passkeys/mfa/verify", json={"mfa_token": mfa_token, "credential": stale})

    assert verified.status_code == 400
    lockout = await _get_browser_lockout(client)
    assert lockout is None or lockout.failed_attempt_count == 0


async def test_step_up_with_a_passkey_ceremony_that_never_started_does_not_use_up_an_attempt(client):
    """A step-up whose passkey answers a challenge the server never issued is refused as a protocol error without counting"""
    signup = await _create_user(client)
    user_id = signup.json()["user"]["id"]
    await _seed_passkey(user_id, b"unstarted-step-up-key")
    stale = _build_assertion("never-issued-challenge", b"unstarted-step-up-key", user_id)

    refused = await client.post(
        "/auth/2fa/recovery-codes", headers=_get_auth_header(signup), json={"password": SIGNUP_PAYLOAD["password"], "passkey": stale}
    )

    assert refused.status_code == 400
    lockout = await _get_step_up_lockout(_get_auth_header(signup))
    assert lockout is None or lockout.failed_attempt_count == 0


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

    verified = await client.post("/auth/passkeys/mfa/verify", json={"mfa_token": mfa_token, "credential": assertion})
    assert verified.status_code == 200
    assert verified.json()["user"]["id"] == user_id
    assert _saved_copy_key(verified) == (derive_saved_copy_key(uuid.UUID(user_id), 0), 0)

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
    # Adding TOTP as a second factor steps up with the existing passkey before the secret is minted
    totp_step_up = await _step_up_with_passkey(client, auth, monkeypatch, user_id, credential_id)
    secret = (await client.post("/auth/2fa/setup", headers=auth, json={"step_up": totp_step_up})).json()["secret"]
    await client.post("/auth/2fa/confirm", headers=auth, json={"code": pyotp.TOTP(secret).now()})
    await client.post("/auth/2fa/complete", headers=auth)

    options = (await client.post("/auth/passkeys/step-up/options", headers=auth)).json()
    assertion = _build_assertion(options["challenge"], credential_id, user_id)
    monkeypatch.setattr(webauthn_service, "verify_authentication_response", lambda **_: SimpleNamespace(new_sign_count=3))

    disabled = await client.post("/auth/2fa/disable", headers=auth, json={"password": SIGNUP_PAYLOAD["password"], "passkey": assertion})
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
    # Adding TOTP as a second factor steps up with the existing passkey before the secret is minted
    totp_step_up = await _step_up_with_passkey(client, auth, monkeypatch, user_id, credential_id)
    secret = (await client.post("/auth/2fa/setup", headers=auth, json={"step_up": totp_step_up})).json()["secret"]
    await client.post("/auth/2fa/confirm", headers=auth, json={"code": pyotp.TOTP(secret).now()})
    await client.post("/auth/2fa/complete", headers=auth)

    options = (await client.post("/auth/passkeys/step-up/options", headers=auth)).json()
    assertion = _build_assertion(options["challenge"], credential_id, user_id)
    monkeypatch.setattr(webauthn_service, "verify_authentication_response", lambda **_: SimpleNamespace(new_sign_count=2))
    disabled = await client.post("/auth/2fa/disable", headers=auth, json={"password": SIGNUP_PAYLOAD["password"], "passkey": assertion})
    assert disabled.status_code == 204

    # The batch survives because the passkey still depends on it
    async with TestSession() as db:
        active = (
            (await db.execute(select(RecoveryCode).where(RecoveryCode.user_id == uuid.UUID(user_id), RecoveryCode.pending.is_(False))))
            .scalars()
            .all()
        )
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
    monkeypatch.setattr(webauthn_service, "verify_authentication_response", lambda **_: SimpleNamespace(new_sign_count=4))

    regenerated = await client.post(
        "/auth/2fa/recovery-codes", headers=auth, json={"password": SIGNUP_PAYLOAD["password"], "passkey": assertion}
    )
    assert regenerated.status_code == 200
    assert len(regenerated.json()["recovery_codes"]) == 10


async def test_passkey_step_up_protocol_error_does_not_lock(client, monkeypatch):
    """A passkey step-up with a never-issued challenge fails as a protocol error without counting toward the lockout"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    user_id = signup.json()["user"]["id"]
    credential_id = b"slow-ceremony-key"
    await _seed_passkey(user_id, credential_id)

    # Enrol TOTP too so both factors exist and disabling is permitted
    # Adding TOTP as a second factor steps up with the existing passkey before the secret is minted
    totp_step_up = await _step_up_with_passkey(client, auth, monkeypatch, user_id, credential_id)
    secret = (await client.post("/auth/2fa/setup", headers=auth, json={"step_up": totp_step_up})).json()["secret"]
    await client.post("/auth/2fa/confirm", headers=auth, json={"code": pyotp.TOTP(secret).now()})
    await client.post("/auth/2fa/complete", headers=auth)

    # An assertion whose challenge was never issued is a 400 protocol error, not a factor failure
    bogus = _build_assertion(bytes_to_base64url(b"never-issued-challenge"), credential_id, user_id)
    for _ in range(6):
        rejected = await client.post("/auth/2fa/disable", headers=auth, json={"password": SIGNUP_PAYLOAD["password"], "passkey": bogus})
        assert rejected.status_code == 400

    # Six protocol errors did not trip the lockout, so a password login is still accepted
    login = await client.post("/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": SIGNUP_PAYLOAD["password"]})
    assert login.status_code == 200


async def test_removing_passkey_keeps_recovery_codes_when_another_passkey_survives(client, monkeypatch):
    """Removing one passkey while another remains keeps the shared recovery batch"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    user_id = signup.json()["user"]["id"]

    # The first passkey issues the batch and a second one reuses it, so two confirmed passkeys share it
    registered = await _register_passkey(client, auth, monkeypatch, b"first-pk", "First")
    first_id = registered.json()["passkey"]["id"]
    await client.post("/auth/passkeys/register/confirm", headers=auth)
    second_step_up = await _step_up_with_passkey(client, auth, monkeypatch, user_id, b"first-pk")
    await _register_passkey(client, auth, monkeypatch, b"second-pk", "Second", step_up=second_step_up)

    body = await _step_up_with_passkey(client, auth, monkeypatch, user_id, b"second-pk")
    removed = await client.post(f"/auth/passkeys/{first_id}/remove", headers=auth, json=body)
    assert removed.status_code == 204

    async with TestSession() as db:
        active = (
            (await db.execute(select(RecoveryCode).where(RecoveryCode.user_id == uuid.UUID(user_id), RecoveryCode.pending.is_(False))))
            .scalars()
            .all()
        )
    assert len(active) == 10


async def test_removing_passkey_via_step_up_with_the_same_passkey(client, monkeypatch):
    """A passkey can authorize its own removal, the verification running before the row is deleted"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    user_id = signup.json()["user"]["id"]
    credential_id = b"self-remove-key"
    passkey_id = await _seed_passkey(user_id, credential_id)

    body = await _step_up_with_passkey(client, auth, monkeypatch, user_id, credential_id)
    removed = await client.post(f"/auth/passkeys/{passkey_id}/remove", headers=auth, json=body)
    assert removed.status_code == 204
    assert (await client.get("/auth/passkeys", headers=auth)).json() == []


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
    response = await client.post("/auth/passkeys/mfa/verify", json={"mfa_token": mfa_token, "credential": assertion})
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
            (
                await db.execute(
                    select(WebauthnCredential).where(
                        WebauthnCredential.user_id == uuid.UUID(user_id),
                        WebauthnCredential.confirmed_at.is_not(None),
                    )
                )
            )
            .scalars()
            .all()
        )
    assert [passkey.name for passkey in active] == ["Recovery key"]


async def test_passkey_sign_in_carries_the_saved_copy_key_and_re_establishing_a_passkey_changes_it(client, monkeypatch):
    """A passkey sign-in and the renewal after it return the user's key, and the re-enrol that signs out everywhere replaces it"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    user_id = signup.json()["user"]["id"]
    old_key, old_version = _saved_copy_key(signup)

    # The assertion crypto is the library's responsibility, so only its verdict is stubbed
    monkeypatch.setattr(webauthn_service, "verify_authentication_response", lambda **_: SimpleNamespace(new_sign_count=7))
    credential_id = b"key-credential"
    await _seed_passkey(user_id, credential_id)

    async def sign_in_with_passkey():
        options = (await client.post("/auth/passkeys/authenticate/options")).json()
        assertion = _build_assertion(options["challenge"], credential_id, user_id)
        return await client.post("/auth/passkeys/authenticate", json={"credential": assertion})

    signed_in = await sign_in_with_passkey()
    assert _saved_copy_key(signed_in) == (old_key, old_version), "a passkey sign-in returns the user's key"
    client.cookies.set("refresh_token", signed_in.cookies["refresh_token"])
    assert _saved_copy_key(await client.post("/auth/refresh")) == (old_key, old_version), "so does the renewal"

    await _seed_active_recovery_code(user_id)
    await _set_reenrollment_required(user_id)
    assert (await _register_passkey(client, auth, monkeypatch, b"replacement-key", "Replacement")).status_code == 201
    assert (await client.post("/auth/passkeys/register/confirm", headers=auth)).status_code == 204

    # The registration stubbed the assertion check for the new passkey, so restore the sign-in stub
    monkeypatch.setattr(webauthn_service, "verify_authentication_response", lambda **_: SimpleNamespace(new_sign_count=8))
    new_key, new_version = _saved_copy_key(await sign_in_with_passkey())
    assert new_version == old_version + 1
    assert new_key != old_key


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
        remaining = (await db.execute(select(WebauthnCredential).where(WebauthnCredential.user_id == uuid.UUID(user_id)))).scalars().all()
        assert remaining == []
    assert await _has_webauthn_identity(user_id) is False


async def test_restricted_session_cannot_manage_passkeys(client):
    """A restricted session is still kept out of passkey management until it re-establishes"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    await _set_reenrollment_required(signup.json()["user"]["id"])

    response = await client.get("/auth/passkeys", headers=auth)
    assert response.status_code == 403


@pytest.mark.parametrize(
    ("linked_providers", "expected_status", "expected_body"),
    [(0, 204, b""), (1, 200, b'{"sign_in_providers_removed":1}')],
)
async def test_passkey_completes_password_reset(client, monkeypatch, linked_providers, expected_status, expected_body):
    """The reset-scoped passkey ceremony completes a factor-gated password reset, unlinking any providers"""
    signup = await _create_user(client)
    user_id = signup.json()["user"]["id"]
    credential_id = b"reset-factor-key"
    await _seed_passkey(user_id, credential_id)
    await _link_sign_in_providers(uuid.UUID(user_id), linked_providers)

    raw_token = await _seed_reset_token(uuid.UUID(user_id))
    begin = await client.post("/auth/password/reset", json={"token": raw_token, "new_password": _NEW_PASSWORD})
    assert begin.status_code == 200
    assert begin.json()["passkey_available"] is True
    mfa_token = begin.json()["mfa_token"]

    options = (await client.post("/auth/passkeys/reset/options", json={"mfa_token": mfa_token})).json()
    assert bytes_to_base64url(credential_id) in {entry["id"] for entry in options["allowCredentials"]}

    assertion = _build_assertion(options["challenge"], credential_id, user_id)
    monkeypatch.setattr(
        webauthn_service,
        "verify_authentication_response",
        lambda **_: SimpleNamespace(new_sign_count=3),
    )

    verified = await client.post(
        "/auth/passkeys/reset/verify",
        json={"token": raw_token, "new_password": _NEW_PASSWORD, "mfa_token": mfa_token, "credential": assertion},
    )
    assert verified.status_code == expected_status
    assert verified.content == expected_body
    assert await _count_sign_in_provider_links(uuid.UUID(user_id)) == (0, 0)

    # The new password authenticates and the passkey factor survives the reset
    login = await client.post("/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": _NEW_PASSWORD})
    assert login.status_code == 200
    assert login.json()["passkey_available"] is True


async def test_passkey_reset_options_reject_a_login_challenge(client):
    """The reset options endpoint refuses a challenge issued by login"""
    signup = await _create_user(client)
    await _seed_passkey(signup.json()["user"]["id"], b"login-scope-key")

    login_mfa_token = (await _login(client)).json()["mfa_token"]

    response = await client.post("/auth/passkeys/reset/options", json={"mfa_token": login_mfa_token})
    assert response.status_code == 401


class _SoftwareAuthenticator:
    """A passkey authenticator that signs real ceremony responses with a generated ES256 key"""

    def __init__(self) -> None:
        """Generate this authenticator's signing key and credential id"""
        self._private_key = ec.generate_private_key(ec.SECP256R1())
        self.credential_id = os.urandom(_CREDENTIAL_ID_BYTES)

    def build_registration_response(self, challenge: str) -> dict:
        """Assemble a registration response whose attestation carries this authenticator's public key

        Args:
            challenge: Base64url challenge the server issued for the ceremony

        Returns:
            The body a browser would send back to finish registration
        """
        flags = _FLAG_USER_PRESENT | _FLAG_USER_VERIFIED | _FLAG_BACKUP_ELIGIBLE | _FLAG_BACKED_UP | _FLAG_ATTESTED_CREDENTIAL
        authenticator_data = self._build_authenticator_data(flags, sign_count=0)

        # A passkey with no hardware attestation to offer reports the "none" format and an empty statement
        attestation = cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": authenticator_data})

        return {
            "id": bytes_to_base64url(self.credential_id),
            "rawId": bytes_to_base64url(self.credential_id),
            "type": "public-key",
            "response": {
                "clientDataJSON": bytes_to_base64url(self._build_client_data(challenge, "webauthn.create")),
                "attestationObject": bytes_to_base64url(attestation),
                "transports": ["internal", "hybrid"],
            },
            "clientExtensionResults": {},
        }

    def build_assertion(self, challenge: str, user_id: str, sign_count: int) -> dict:
        """Assemble a sign-in assertion signed by this authenticator's key

        Args:
            challenge: Base64url challenge the server issued for the ceremony
            user_id: Account the discoverable credential belongs to
            sign_count: Counter this authenticator reports for the signature

        Returns:
            The body a browser would send back to finish a sign-in
        """
        flags = _FLAG_USER_PRESENT | _FLAG_USER_VERIFIED | _FLAG_BACKUP_ELIGIBLE | _FLAG_BACKED_UP
        authenticator_data = self._build_authenticator_data(flags, sign_count=sign_count)
        client_data = self._build_client_data(challenge, "webauthn.get")

        # The signature covers the authenticator data followed by the hash of the client data
        signature = self._private_key.sign(authenticator_data + hashlib.sha256(client_data).digest(), ec.ECDSA(hashes.SHA256()))

        return {
            "id": bytes_to_base64url(self.credential_id),
            "rawId": bytes_to_base64url(self.credential_id),
            "type": "public-key",
            "response": {
                "clientDataJSON": bytes_to_base64url(client_data),
                "authenticatorData": bytes_to_base64url(authenticator_data),
                "signature": bytes_to_base64url(signature),
                "userHandle": bytes_to_base64url(uuid.UUID(user_id).bytes),
            },
            "clientExtensionResults": {},
        }

    def _build_authenticator_data(self, flags: int, sign_count: int) -> bytes:
        """Assemble authenticator data, appending the credential and key when it is an attested one"""
        header = hashlib.sha256(WEBAUTHN_RP_ID.encode()).digest() + struct.pack(">BI", flags, sign_count)
        if not flags & _FLAG_ATTESTED_CREDENTIAL:
            return header
        return header + _TEST_AAGUID + struct.pack(">H", len(self.credential_id)) + self.credential_id + self._encode_cose_public_key()

    def _encode_cose_public_key(self) -> bytes:
        """Encode this authenticator's public key in the COSE form the library reads"""
        numbers = self._private_key.public_key().public_numbers()

        # COSE labels: 1 is the key type where 2 means elliptic curve, 3 is the algorithm where -7
        # means ES256, -1 is the curve where 1 means P-256, and -2 and -3 hold the point coordinates
        return cbor2.dumps(
            {
                1: 2,
                3: -7,
                -1: 1,
                -2: numbers.x.to_bytes(_P256_COORDINATE_BYTES, "big"),
                -3: numbers.y.to_bytes(_P256_COORDINATE_BYTES, "big"),
            }
        )

    @staticmethod
    def _build_client_data(challenge: str, ceremony_type: str) -> bytes:
        """Assemble the client data a browser echoes back for a ceremony"""
        return json.dumps(
            {
                "type": ceremony_type,
                "challenge": challenge,
                "origin": WEBAUTHN_ORIGINS[0],
            }
        ).encode()


async def _request_registration_options(client, auth) -> dict:
    """Return registration ceremony options, reauthorizing with the account password"""
    response = await client.post("/auth/passkeys/register/options", headers=auth, json={"step_up": {"password": SIGNUP_PAYLOAD["password"]}})
    return response.json()


async def _register_real_passkey(client, auth, authenticator: _SoftwareAuthenticator, name: str = "Real key"):
    """Run a registration ceremony end to end with nothing replaced, returning the register response"""
    options = await _request_registration_options(client, auth)
    credential = authenticator.build_registration_response(options["challenge"])
    return await client.post("/auth/passkeys/register", headers=auth, json={"name": name, "credential": credential})


async def test_real_ceremony_registers_and_signs_in(client):
    """A genuinely signed passkey registers and then signs in, with the library verifying both

    Every other ceremony test replaces the library's verification with a fixed result, so this is the
    only coverage that fails when a library upgrade changes what those calls accept or return
    """
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    user_id = signup.json()["user"]["id"]
    authenticator = _SoftwareAuthenticator()

    registered = await _register_real_passkey(client, auth, authenticator, "Verified laptop")
    assert registered.status_code == 201
    assert len(registered.json()["recovery_codes"]) == 10
    assert (await client.post("/auth/passkeys/register/confirm", headers=auth)).status_code == 204

    # The stored key is read out of the attestation, so an empty one means the library returned nothing
    stored = await _read_passkey(authenticator.credential_id)
    assert stored.public_key
    assert stored.sign_count == 0

    options = (await client.post("/auth/passkeys/authenticate/options")).json()
    assertion = authenticator.build_assertion(options["challenge"], user_id, _ASSERTION_SIGN_COUNT)

    signed_in = await client.post("/auth/passkeys/authenticate", json={"credential": assertion})
    assert signed_in.status_code == 200
    assert signed_in.json()["user"]["id"] == user_id

    # The counter moving to the value the assertion reported proves the signature was checked
    stored = await _read_passkey(authenticator.credential_id)
    assert stored.sign_count == _ASSERTION_SIGN_COUNT
    assert stored.last_used_at is not None


async def test_a_passkey_registered_under_the_fixed_name_signs_in_after_the_service_name_changes(client):
    """Naming the service later leaves existing passkeys working, since only the relying party id binds them"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    user_id = signup.json()["user"]["id"]
    authenticator = _SoftwareAuthenticator()
    assert (await _register_real_passkey(client, auth, authenticator)).status_code == 201
    assert (await client.post("/auth/passkeys/register/confirm", headers=auth)).status_code == 204

    set_service_name("Example Service")

    options = (await client.post("/auth/passkeys/authenticate/options")).json()
    assertion = authenticator.build_assertion(options["challenge"], user_id, _ASSERTION_SIGN_COUNT)
    signed_in = await client.post("/auth/passkeys/authenticate", json={"credential": assertion})

    assert signed_in.status_code == 200
    assert signed_in.json()["user"]["id"] == user_id


async def test_real_ceremony_rejects_a_damaged_attestation(client):
    """A registration response whose attestation cannot be read is refused as a bad request

    The service turns the library's registration error into a 400, so a library that raised something
    else would surface here as a 500
    """
    auth = _get_auth_header(await _create_user(client))
    authenticator = _SoftwareAuthenticator()

    options = await _request_registration_options(client, auth)
    credential = authenticator.build_registration_response(options["challenge"])
    credential["response"]["attestationObject"] = bytes_to_base64url(b"not-an-attestation-object")

    response = await client.post("/auth/passkeys/register", headers=auth, json={"name": "Damaged", "credential": credential})
    assert response.status_code == 400


async def test_real_ceremony_rejects_a_forged_signature(client):
    """An assertion signed by a different key than the registered passkey is refused as unauthorized

    The service turns the library's authentication error into a 401, so a library that raised
    something else would surface here as a 500
    """
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    user_id = signup.json()["user"]["id"]
    authenticator = _SoftwareAuthenticator()

    assert (await _register_real_passkey(client, auth, authenticator)).status_code == 201
    assert (await client.post("/auth/passkeys/register/confirm", headers=auth)).status_code == 204

    # A second authenticator claims the registered credential id while signing with its own key
    forger = _SoftwareAuthenticator()
    forger.credential_id = authenticator.credential_id

    options = (await client.post("/auth/passkeys/authenticate/options")).json()
    assertion = forger.build_assertion(options["challenge"], user_id, _ASSERTION_SIGN_COUNT)

    response = await client.post("/auth/passkeys/authenticate", json={"credential": assertion})
    assert response.status_code == 401
