"""OIDC sign-in route tests with the provider protocol mocked at the service seam"""

import re
import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse

import jwt as pyjwt
import pytest
from sqlalchemy import select, update

from app import signup_check_hook
from app.config.oidc import OIDC_REAUTH_MAX_AGE_SECONDS
from app.encryption import encrypt
from app.models.auth import AuthIdentity
from app.models.base import AuthProvider
from app.models.oidc import OidcAuthorizationRequest, OidcIdentity, OidcProvider
from app.models.user import User
from app.services.auth import oidc_login, registration
from app.services.auth.saved_copy_key import derive_saved_copy_key
from app.services.auth.token_hashing import hash_token
from tests.conftest import TestSession
from tests.routes.support import (
    SIGNUP_PAYLOAD,
    _assert_bare_cookie,
    _assert_host_bound_cookie,
    _assert_other_sessions_ended,
    _assert_other_sessions_kept,
    _assert_session_works,
    _clears_cookie,
    _get_auth_header,
    _resend_cookie,
    _saved_copy_key,
    _seed_currency,
    _seed_reset_token,
    _sign_in_again,
    sign_up_confirmed,
)
from tests.routes.support.oidc_helpers import CLIENT_ID, ISSUER


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
    signup = await sign_up_confirmed(client, SIGNUP_PAYLOAD)
    user_id = uuid.UUID(signup.json()["user"]["id"])
    provider = await _seed_provider()
    async with TestSession() as session:
        session.add(OidcIdentity(user_id=user_id, provider_id=provider.id, subject="subject-1", email="sso-user@example.com"))
        await session.commit()
    provider_protocol["claims"] = _claims()

    state = await _start_sign_in(client)
    resp = await client.post("/auth/oidc/callback", json={"code": "any", "state": state})

    assert resp.status_code == 200
    body = resp.json()
    assert body["user"]["id"] == str(user_id)
    assert "access_token" in body
    assert _saved_copy_key(resp) == (derive_saved_copy_key(user_id, 0), 0)
    assert _clears_cookie(resp, "oidc_login_binding")

    async with TestSession() as session:
        identity = (await session.execute(select(OidcIdentity))).scalar_one()
    assert identity.last_login_at is not None


async def test_callback_never_auto_links_verified_email(client, provider_protocol):
    """A verified provider email matching a local account is refused, never linked automatically"""
    await _seed_currency()
    await sign_up_confirmed(client, SIGNUP_PAYLOAD)
    await _seed_provider()
    provider_protocol["claims"] = _claims(email=SIGNUP_PAYLOAD["email"], email_verified=True)

    state = await _start_sign_in(client)
    resp = await client.post("/auth/oidc/callback", json={"code": "any", "state": state})

    assert resp.status_code == 409

    # Even a verified email takes the password-then-link path, so no identity is created
    detail = resp.json()["detail"]
    assert detail["code"] == "email_already_registered"
    assert detail["email"] == SIGNUP_PAYLOAD["email"]
    assert _clears_cookie(resp, "oidc_login_binding")

    async with TestSession() as session:
        identities = (await session.execute(select(OidcIdentity))).scalars().all()
        oidc_auth_identities = (
            (await session.execute(select(AuthIdentity).where(AuthIdentity.auth_provider == AuthProvider.OIDC))).scalars().all()
        )
    assert identities == []
    assert oidc_auth_identities == []


# Claim values a provider can send that are not the boolean true, which is the only verified value
UNVERIFIED_EMAIL_CLAIMS = [False, None, "true", "false"]


async def _callback_with_unverified_email(client, provider_protocol, email_verified):
    """Run a provider sign-in whose email is SIGNUP_PAYLOAD's and the provider did not verify"""
    claims = _claims(email=SIGNUP_PAYLOAD["email"], email_verified=email_verified)
    if email_verified is None:
        del claims["email_verified"]
    provider_protocol["claims"] = claims

    state = await _start_sign_in(client)
    return await client.post("/auth/oidc/callback", json={"code": "any", "state": state})


def _cookie_headers(resp) -> list[str]:
    """Return the Set-Cookie headers without the expiry instant, which moves with the clock"""
    return [re.sub(r"expires=[^;]*;\s*", "", header) for header in resp.headers.get_list("set-cookie")]


def _without_onboarding_token(resp) -> dict:
    """Return the response body minus the signed token, which is different on every sign-in"""
    return {key: value for key, value in resp.json().items() if key != "onboarding_token"}


@pytest.mark.parametrize("email_verified", UNVERIFIED_EMAIL_CLAIMS)
async def test_callback_unverified_email_gets_same_refusal_whether_registered_or_not(client, provider_protocol, email_verified):
    """With strict verification, the default, an unverified provider email never reveals an account

    Whoever signs in at the provider can type any address as their email, so the refusal for a
    registered address must match the one for an unregistered address in status, body and cookies
    """
    await _seed_currency()
    await _seed_provider()

    unregistered = await _callback_with_unverified_email(client, provider_protocol, email_verified)
    await sign_up_confirmed(client, SIGNUP_PAYLOAD)
    registered = await _callback_with_unverified_email(client, provider_protocol, email_verified)

    assert unregistered.status_code == 422
    assert unregistered.json() == {"detail": "Identity provider did not verify the email address"}
    assert registered.status_code == unregistered.status_code
    assert registered.json() == unregistered.json()
    assert _cookie_headers(registered) == _cookie_headers(unregistered)
    assert _clears_cookie(registered, "oidc_login_binding")

    async with TestSession() as session:
        users = (await session.execute(select(User))).scalars().all()
        identities = (await session.execute(select(OidcIdentity))).scalars().all()
    assert len(users) == 1
    assert identities == []


@pytest.mark.parametrize("email_verified", [False, None])
async def test_callback_unverified_email_onboards_alike_whether_registered_or_not_when_relaxed(
    client, provider_protocol, monkeypatch, email_verified
):
    """With verification relaxed, an unverified provider email onboards the same whether or not it is registered

    Some self-hosted providers report the claim without verifying the address, so an operator relaxes
    the check and relies on the never-auto-link rule to prevent takeover. A registered address meets
    its refusal when the signup completes
    """
    monkeypatch.setattr(oidc_login, "OIDC_REQUIRE_VERIFIED_EMAIL", False)
    await _seed_currency()
    await _seed_provider()

    unregistered = await _callback_with_unverified_email(client, provider_protocol, email_verified)
    await sign_up_confirmed(client, SIGNUP_PAYLOAD)
    registered = await _callback_with_unverified_email(client, provider_protocol, email_verified)

    assert unregistered.status_code == 200
    assert unregistered.json()["onboarding_required"] is True
    assert registered.status_code == unregistered.status_code
    assert _without_onboarding_token(registered) == _without_onboarding_token(unregistered)
    assert _cookie_headers(registered) == _cookie_headers(unregistered)

    async with TestSession() as session:
        users = (await session.execute(select(User))).scalars().all()
        identities = (await session.execute(select(OidcIdentity))).scalars().all()
    assert len(users) == 1
    assert identities == []


@pytest.mark.parametrize("email_verified", [False, None])
async def test_callback_signs_in_linked_identity_with_unverified_email(client, provider_protocol, email_verified):
    """A linked provider identity signs in whatever its email claims say, strict verification included"""
    await _seed_currency()
    signup = await sign_up_confirmed(client, SIGNUP_PAYLOAD)
    user_id = uuid.UUID(signup.json()["user"]["id"])
    provider = await _seed_provider()
    async with TestSession() as session:
        session.add(OidcIdentity(user_id=user_id, provider_id=provider.id, subject="subject-1", email=SIGNUP_PAYLOAD["email"]))
        await session.commit()

    resp = await _callback_with_unverified_email(client, provider_protocol, email_verified)

    assert resp.status_code == 200
    assert resp.json()["user"]["id"] == str(user_id)


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


async def test_callback_closed_registration_refuses_new_user(client, provider_protocol, closed_registration):
    """A first-time sign-in on a closed instance is refused before any onboarding step is issued"""
    await _seed_provider()
    provider_protocol["claims"] = _claims()

    state = await _start_sign_in(client)
    resp = await client.post("/auth/oidc/callback", json={"code": "any", "state": state})

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Registration is closed on this instance"


async def test_callback_closed_registration_signs_in_linked_identity(client, provider_protocol, monkeypatch):
    """Closing registration leaves an already linked provider sign-in working"""
    await _seed_currency()
    signup = await sign_up_confirmed(client, SIGNUP_PAYLOAD)
    user_id = uuid.UUID(signup.json()["user"]["id"])
    provider = await _seed_provider()
    async with TestSession() as session:
        session.add(OidcIdentity(user_id=user_id, provider_id=provider.id, subject="subject-1", email="sso-user@example.com"))
        await session.commit()
    provider_protocol["claims"] = _claims()
    monkeypatch.setattr(registration, "REGISTRATION_ENABLED", False)

    state = await _start_sign_in(client)
    resp = await client.post("/auth/oidc/callback", json={"code": "any", "state": state})

    assert resp.status_code == 200
    assert resp.json()["user"]["id"] == str(user_id)


async def test_callback_conflicts_when_the_provider_reports_the_email_in_other_capitals(client, provider_protocol):
    """A provider spelling the address differently from the account's still gets the email conflict, not onboarding"""
    await _seed_currency()
    await sign_up_confirmed(client, {**SIGNUP_PAYLOAD, "email": "sso-user@example.com"})
    await _seed_provider()
    provider_protocol["claims"] = _claims(email="Sso-User@Example.com", email_verified=True)

    state = await _start_sign_in(client)
    resp = await client.post("/auth/oidc/callback", json={"code": "any", "state": state})

    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "email_already_registered"
    async with TestSession() as session:
        assert (await session.execute(select(OidcIdentity))).scalars().all() == []


@pytest.mark.parametrize("sent", ["sso@MÜNCHEN.de", "  sso@münchen.DE ", "sso@MÜNCHEN.de\t"])
async def test_callback_conflicts_when_the_provider_spells_the_domain_or_padding_differently(client, provider_protocol, sent):
    """A provider's address meets the typed spelling of the same address as one account, not a second one"""
    await _seed_currency()
    await sign_up_confirmed(client, {**SIGNUP_PAYLOAD, "email": "sso@münchen.de"})
    await _seed_provider()
    provider_protocol["claims"] = _claims(email=sent, email_verified=True)

    state = await _start_sign_in(client)
    resp = await client.post("/auth/oidc/callback", json={"code": "any", "state": state})

    assert resp.status_code == 409
    assert resp.json()["detail"] == {"code": "email_already_registered", "email": "sso@münchen.de"}


async def test_callback_matches_an_account_stored_in_the_spelling_the_provider_sends(client, provider_protocol):
    """An account an earlier release made from a provider keeps its raw spelling and still meets that provider's address"""
    await _seed_currency()
    await _seed_provider()
    async with TestSession() as session:
        session.add(User(id=uuid.uuid4(), email="sso@MÜNCHEN.de", first_name="Old", tz="America/Toronto", base_currency="CAD"))
        await session.commit()
    provider_protocol["claims"] = _claims(email="sso@MÜNCHEN.de", email_verified=True)

    state = await _start_sign_in(client)
    resp = await client.post("/auth/oidc/callback", json={"code": "any", "state": state})

    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "email_already_registered"


@pytest.mark.parametrize("email", ["a@corp.local", "admin@localhost", "a@intranet", "a@home.arpa", "first_last@my_co.com"])
async def test_signup_keeps_the_internal_address_a_provider_sends(client, provider_protocol, email):
    """Normalising never refuses an address EmailStr would, so internal domains still sign up"""
    await _seed_currency()
    await _seed_provider()
    provider_protocol["claims"] = _claims(email=email)
    state = await _start_sign_in(client)
    onboarding = (await client.post("/auth/oidc/callback", json={"code": "any", "state": state})).json()

    resp = await client.post(
        "/auth/oidc/signup",
        json={"onboarding_token": onboarding["onboarding_token"], "first_name": "Sso", "tz": "America/Toronto", "base_currency": "CAD"},
    )

    assert resp.status_code == 201
    assert resp.json()["user"]["email"] == email


async def test_signup_stores_the_provider_address_in_the_typed_spelling(client, provider_protocol):
    """The account and its provider link hold the trimmed address with a lower-case domain"""
    await _seed_currency()
    await _seed_provider()
    provider_protocol["claims"] = _claims(email="sso@EXAMPLE.COM ")
    state = await _start_sign_in(client)
    onboarding = (await client.post("/auth/oidc/callback", json={"code": "any", "state": state})).json()

    resp = await client.post(
        "/auth/oidc/signup",
        json={"onboarding_token": onboarding["onboarding_token"], "first_name": "Sso", "tz": "America/Toronto", "base_currency": "CAD"},
    )

    assert resp.status_code == 201
    assert resp.json()["user"]["email"] == "sso@example.com"
    async with TestSession() as session:
        assert (await session.execute(select(OidcIdentity.email))).scalar_one() == "sso@example.com"


@pytest.mark.parametrize("sent", ["", "   "])
async def test_callback_refuses_an_address_of_only_blanks(client, provider_protocol, sent):
    """A provider sending nothing or whitespace as its address supplied none"""
    await _seed_provider()
    provider_protocol["claims"] = _claims(email=sent)

    state = await _start_sign_in(client)
    resp = await client.post("/auth/oidc/callback", json={"code": "any", "state": state})

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Identity provider did not supply an email address"


@pytest.mark.parametrize(
    "sent",
    [42, ["sso-user@example.com"], f"{'a' * 243}@example.com", "sso-user\x00@example.com"],
    ids=["number", "list", "one character longer than an address column", "control character"],
)
async def test_callback_refuses_an_address_it_cannot_store_and_creates_nothing(client, provider_protocol, sent):
    """An email claim that isn't text, can't be stored or is too long is treated as no email, not as a server error"""
    await _seed_provider()
    provider_protocol["claims"] = _claims(email=sent)

    state = await _start_sign_in(client)
    resp = await client.post("/auth/oidc/callback", json={"code": "any", "state": state})

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Identity provider did not supply an email address"
    async with TestSession() as session:
        assert (await session.execute(select(User.id))).first() is None


async def test_callback_onboards_an_address_as_long_as_the_column_holds(client, provider_protocol):
    """A 254-character address, the most an address column stores, still reaches onboarding"""
    await _seed_provider()
    address = f"{'a' * 242}@example.com"
    provider_protocol["claims"] = _claims(email=address)

    state = await _start_sign_in(client)
    resp = await client.post("/auth/oidc/callback", json={"code": "any", "state": state})

    assert resp.status_code == 200
    assert resp.json()["onboarding_required"] is True
    assert resp.json()["email"] == address


async def test_callback_ignores_a_family_name_that_is_not_text(client, provider_protocol):
    """A family name that isn't text is left off the profile form and the sign-in goes ahead"""
    await _seed_provider()
    provider_protocol["claims"] = _claims(family_name=["User"])

    state = await _start_sign_in(client)
    resp = await client.post("/auth/oidc/callback", json={"code": "any", "state": state})

    assert resp.status_code == 200
    assert resp.json()["onboarding_required"] is True
    assert resp.json()["last_name"] is None


async def test_signup_completion_conflicts_when_the_provider_spells_the_domain_differently(client, provider_protocol, monkeypatch):
    """With verification relaxed, an unverified address meets the typed account of the same address when the signup completes"""
    monkeypatch.setattr(oidc_login, "OIDC_REQUIRE_VERIFIED_EMAIL", False)
    await _seed_currency()
    await sign_up_confirmed(client, {**SIGNUP_PAYLOAD, "email": "sso@münchen.de"})
    await _seed_provider()
    provider_protocol["claims"] = _claims(email="sso@MÜNCHEN.de", email_verified=False)
    state = await _start_sign_in(client)
    onboarding = (await client.post("/auth/oidc/callback", json={"code": "any", "state": state})).json()
    assert onboarding["onboarding_required"] is True

    resp = await client.post(
        "/auth/oidc/signup",
        json={"onboarding_token": onboarding["onboarding_token"], "first_name": "Sso", "tz": "America/Toronto", "base_currency": "CAD"},
    )

    assert resp.status_code == 409
    assert resp.json()["detail"] == "Email already registered"
    async with TestSession() as session:
        assert len((await session.execute(select(User))).scalars().all()) == 1
        assert (await session.execute(select(OidcIdentity))).scalars().all() == []


async def test_callback_closed_registration_keeps_email_conflict(client, provider_protocol, monkeypatch):
    """An existing account's owner still gets the sign-in-and-link path, not the closed message"""
    await _seed_currency()
    await sign_up_confirmed(client, SIGNUP_PAYLOAD)
    await _seed_provider()
    provider_protocol["claims"] = _claims(email=SIGNUP_PAYLOAD["email"], email_verified=True)
    monkeypatch.setattr(registration, "REGISTRATION_ENABLED", False)

    state = await _start_sign_in(client)
    resp = await client.post("/auth/oidc/callback", json={"code": "any", "state": state})

    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "email_already_registered"


@pytest.fixture
def refusing_signup_check(monkeypatch):
    """Install a sign-up check refusing every address for this test alone"""

    async def refuse(attempt: signup_check_hook.SignupAttempt) -> bool:
        return False

    monkeypatch.setattr(signup_check_hook, "_check", refuse)


async def test_callback_signup_check_refuses_new_user_as_closed_registration(client, provider_protocol, refusing_signup_check):
    """A first-time sign-in the sign-up check refuses gets the closed-registration answer and starts no onboarding"""
    await _seed_provider()
    provider_protocol["claims"] = _claims()

    state = await _start_sign_in(client)
    resp = await client.post("/auth/oidc/callback", json={"code": "any", "state": state})

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Registration is closed on this instance"
    async with TestSession() as session:
        assert (await session.execute(select(User))).scalars().all() == []


async def test_callback_signup_check_keeps_email_conflict(client, provider_protocol, refusing_signup_check):
    """An existing account's owner still gets the sign-in-and-link path while the sign-up check refuses everyone"""
    await _seed_currency()
    await sign_up_confirmed(client, SIGNUP_PAYLOAD)
    await _seed_provider()
    provider_protocol["claims"] = _claims(email=SIGNUP_PAYLOAD["email"], email_verified=True)

    state = await _start_sign_in(client)
    resp = await client.post("/auth/oidc/callback", json={"code": "any", "state": state})

    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "email_already_registered"


async def test_callback_signup_check_keeps_unverified_email_refusal(client, provider_protocol, refusing_signup_check):
    """An address the provider did not verify keeps its own refusal while the sign-up check refuses everyone"""
    await _seed_provider()

    resp = await _callback_with_unverified_email(client, provider_protocol, False)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Identity provider did not verify the email address"


async def test_callback_signup_check_signs_in_linked_identity(client, provider_protocol, refusing_signup_check):
    """An already linked provider sign-in keeps working while the sign-up check refuses everyone"""
    await _seed_currency()
    signup = await sign_up_confirmed(client, SIGNUP_PAYLOAD)
    user_id = uuid.UUID(signup.json()["user"]["id"])
    provider = await _seed_provider()
    async with TestSession() as session:
        session.add(OidcIdentity(user_id=user_id, provider_id=provider.id, subject="subject-1", email="sso-user@example.com"))
        await session.commit()
    provider_protocol["claims"] = _claims()

    state = await _start_sign_in(client)
    resp = await client.post("/auth/oidc/callback", json={"code": "any", "state": state})

    assert resp.status_code == 200
    assert resp.json()["user"]["id"] == str(user_id)


async def test_callback_signup_check_allowing_the_provider_email_onboards(client, provider_protocol, monkeypatch):
    """The check is asked about the provider's address, and allowing it lets onboarding start"""
    asked = []

    async def allow_sso_user(attempt: signup_check_hook.SignupAttempt) -> bool:
        asked.append(attempt.email)
        return attempt.email == "sso-user@example.com"

    monkeypatch.setattr(signup_check_hook, "_check", allow_sso_user)
    await _seed_provider()
    provider_protocol["claims"] = _claims()

    state = await _start_sign_in(client)
    resp = await client.post("/auth/oidc/callback", json={"code": "any", "state": state})

    assert resp.status_code == 200
    assert resp.json()["onboarding_required"] is True
    assert asked == ["sso-user@example.com"]


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
    """A roundtrip past its expiry no longer completes, even while starting another sign-in leaves its row"""
    provider = await _seed_provider()
    stale = OidcAuthorizationRequest(
        state_hash=hash_token("stale-state"),
        nonce="n",
        code_verifier="v",
        provider_id=provider.id,
        expires_at=datetime.now(UTC) - timedelta(minutes=1),
    )
    async with TestSession() as session:
        session.add(stale)
        await session.commit()

    await _start_sign_in(client)
    async with TestSession() as session:
        assert await session.get(OidcAuthorizationRequest, stale.id) is not None, "the row is left to the scheduled cleanup"

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
    assert _saved_copy_key(resp) == (derive_saved_copy_key(uuid.UUID(body["user"]["id"]), 0), 0)

    async with TestSession() as session:
        identity = (await session.execute(select(OidcIdentity))).scalar_one()
        auth_identity = (await session.execute(select(AuthIdentity).where(AuthIdentity.auth_provider == AuthProvider.OIDC))).scalar_one()
    assert identity.subject == "subject-1"
    assert str(auth_identity.user_id) == body["user"]["id"]


async def test_signup_conflicts_with_an_account_registered_in_other_capitals_meanwhile(client, provider_protocol):
    """Completing onboarding refuses an address that gained an account since, however it was capitalised"""
    await _seed_currency()
    await _seed_provider()
    onboarding = await _onboard(client, provider_protocol)
    await sign_up_confirmed(client, {**SIGNUP_PAYLOAD, "email": "Sso-User@example.com"})

    resp = await client.post(
        "/auth/oidc/signup",
        json={
            "onboarding_token": onboarding["onboarding_token"],
            "first_name": "Sso",
            "tz": "America/Toronto",
            "base_currency": "CAD",
        },
    )

    assert resp.status_code == 409
    assert resp.json()["detail"] == "Email already registered"
    async with TestSession() as session:
        assert len((await session.execute(select(User))).scalars().all()) == 1


async def test_a_subject_unlinked_by_a_password_reset_cannot_reach_the_account_again(client, provider_protocol, monkeypatch):
    """Once the address owner resets the password, a squatter's provider subject meets signup's refusal

    With verification relaxed, someone can create an account through a provider on an address they
    don't own. The owner reclaims it through the reset link, and that removes the squatter's link,
    so their next sign-in lands on onboarding and the signup is refused as already registered
    """
    monkeypatch.setattr(oidc_login, "OIDC_REQUIRE_VERIFIED_EMAIL", False)
    await _seed_currency()
    await _seed_provider()
    provider_protocol["claims"] = _claims(email_verified=False)
    signup_body = {"first_name": "Sso", "tz": "America/Toronto", "base_currency": "CAD"}
    state = await _start_sign_in(client)
    onboarding = (await client.post("/auth/oidc/callback", json={"code": "any", "state": state})).json()
    squatted = await client.post("/auth/oidc/signup", json={"onboarding_token": onboarding["onboarding_token"], **signup_body})
    assert squatted.status_code == 201
    raw_token = await _seed_reset_token(uuid.UUID(squatted.json()["user"]["id"]))

    reset = await client.post("/auth/password/reset", json={"token": raw_token, "new_password": "NewSecurePass123!"})
    assert reset.status_code == 200
    state = await _start_sign_in(client)
    again = await client.post("/auth/oidc/callback", json={"code": "any", "state": state})
    assert again.status_code == 200
    assert again.json()["onboarding_required"] is True
    resp = await client.post("/auth/oidc/signup", json={"onboarding_token": again.json()["onboarding_token"], **signup_body})

    assert resp.status_code == 409
    assert resp.json()["detail"] == "Email already registered"
    async with TestSession() as session:
        assert (await session.execute(select(OidcIdentity))).scalars().all() == []


async def test_signup_races_to_conflict_not_crash(client, provider_protocol, monkeypatch):
    """An email registered between onboarding and signup is a conflict, not an unhandled error"""
    await _seed_currency()
    await _seed_provider()
    onboarding = await _onboard(client, provider_protocol)

    # Register the onboarding email after the token was minted, then hide it from the pre-check so the
    # user insert is what trips the unique constraint, standing in for a parallel signup that commits first
    await sign_up_confirmed(client, {**SIGNUP_PAYLOAD, "email": "sso-user@example.com"})

    async def blind_reject(db, email):
        """Let onboarding proceed as if the email were still free"""
        return None

    monkeypatch.setattr(oidc_login, "reject_registered_email", blind_reject)

    resp = await client.post(
        "/auth/oidc/signup",
        json={
            "onboarding_token": onboarding["onboarding_token"],
            "first_name": "Sso",
            "tz": "America/Toronto",
            "base_currency": "CAD",
        },
    )

    assert resp.status_code == 409


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


async def test_signup_closed_after_onboarding_creates_no_user(client, provider_protocol, monkeypatch):
    """An onboarding token issued while registration was open can't finish once it closes"""
    await _seed_currency()
    await _seed_provider()
    onboarding = await _onboard(client, provider_protocol)
    monkeypatch.setattr(registration, "REGISTRATION_ENABLED", False)

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

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Registration is closed on this instance"

    async with TestSession() as session:
        users = (await session.execute(select(User))).scalars().all()
        identities = (await session.execute(select(OidcIdentity))).scalars().all()
    assert users == []
    assert identities == []


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


async def _create_password_user(client, email: str | None = None):
    """Sign up a password account and return its auth header and user id

    The email defaults to the one `_claims` asserts, so a link matches unless a test says otherwise
    """
    await _seed_currency()
    signup = await sign_up_confirmed(client, {**SIGNUP_PAYLOAD, "email": email or _claims()["email"]})
    assert signup.status_code == 201
    from tests.routes.support import _get_auth_header

    return _get_auth_header(signup), signup.json()["user"]["id"]


async def _start_link(client, auth, slug: str = "test-idp") -> str:
    """Begin a link roundtrip with the account password and return the state"""
    resp = await client.post(f"/auth/oidc/{slug}/link", headers=auth, json={"password": SIGNUP_PAYLOAD["password"]})
    assert resp.status_code == 200
    params = parse_qs(urlparse(resp.json()["authorization_url"]).query)
    return params["state"][0]


async def test_link_attaches_provider_to_account(client, provider_protocol):
    """A step-up authorized link roundtrip attaches the provider subject to the account and signs nobody out"""
    auth, user_id = await _create_password_user(client)
    caller = (auth, client.cookies["refresh_token"])
    other = await _sign_in_again(client, email=_claims()["email"])
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
        auth_identity = (await session.execute(select(AuthIdentity).where(AuthIdentity.auth_provider == AuthProvider.OIDC))).scalar_one()
    assert str(identity.user_id) == user_id
    assert identity.subject == "subject-1"
    assert str(auth_identity.user_id) == user_id
    await _assert_other_sessions_kept(client, caller, other)


async def test_link_closed_registration_attaches_provider(client, provider_protocol, monkeypatch):
    """Closing registration leaves an existing account free to link a provider from settings"""
    auth, user_id = await _create_password_user(client)
    await _seed_provider()
    provider_protocol["claims"] = _claims()
    monkeypatch.setattr(registration, "REGISTRATION_ENABLED", False)

    state = await _start_link(client, auth)
    resp = await client.post("/auth/oidc/link/callback", headers=auth, json={"code": "any", "state": state})

    assert resp.status_code == 200
    async with TestSession() as session:
        identity = (await session.execute(select(OidcIdentity))).scalar_one()
    assert str(identity.user_id) == user_id


async def test_link_requires_an_email(client, provider_protocol):
    """A provider that supplies no email cannot be linked, matching the sign-in requirement"""
    auth, _ = await _create_password_user(client)
    await _seed_provider()
    provider_protocol["claims"] = _claims(email=None)

    state = await _start_link(client, auth)
    resp = await client.post("/auth/oidc/link/callback", headers=auth, json={"code": "any", "state": state})

    assert resp.status_code == 422
    async with TestSession() as session:
        identities = (await session.execute(select(OidcIdentity))).scalars().all()
    assert identities == []


async def test_link_refuses_a_different_provider_email(client, provider_protocol):
    """A provider asserting another address than the account's is refused and attaches nothing"""
    auth, _ = await _create_password_user(client)
    await _seed_provider()
    provider_protocol["claims"] = _claims(email="someone-else@example.com")

    state = await _start_link(client, auth)
    resp = await client.post("/auth/oidc/link/callback", headers=auth, json={"code": "any", "state": state})

    assert resp.status_code == 422
    assert resp.json()["detail"] == "The identity provider's email address must match your account's email address"
    async with TestSession() as session:
        identities = (await session.execute(select(OidcIdentity))).scalars().all()
        auth_identities = (await session.execute(select(AuthIdentity).where(AuthIdentity.auth_provider == AuthProvider.OIDC))).scalars().all()
    assert identities == []
    assert auth_identities == []


@pytest.mark.parametrize("sent", ["sso@MÜNCHEN.de", " sso@münchen.DE"])
async def test_link_attaches_when_the_provider_spells_the_domain_differently(client, provider_protocol, sent):
    """The typed account and the provider's spelling of the same address link as one"""
    auth, user_id = await _create_password_user(client, email="sso@münchen.de")
    await _seed_provider()
    provider_protocol["claims"] = _claims(email=sent)

    state = await _start_link(client, auth)
    resp = await client.post("/auth/oidc/link/callback", headers=auth, json={"code": "any", "state": state})

    assert resp.status_code == 200
    async with TestSession() as session:
        assert str((await session.execute(select(OidcIdentity.user_id))).scalar_one()) == user_id
        assert (await session.execute(select(OidcIdentity.email))).scalar_one() == "sso@münchen.de"


async def test_link_attaches_to_an_account_stored_in_the_spelling_the_provider_sends(client, provider_protocol):
    """An account holding the provider's raw spelling still links the provider that sends it"""
    auth, user_id = await _create_password_user(client, email="sso@münchen.de")
    await _seed_provider()
    async with TestSession() as session:
        await session.execute(update(User).where(User.id == uuid.UUID(user_id)).values(email="sso@MÜNCHEN.de"))
        await session.commit()
    provider_protocol["claims"] = _claims(email="sso@MÜNCHEN.de")

    state = await _start_link(client, auth)
    resp = await client.post("/auth/oidc/link/callback", headers=auth, json={"code": "any", "state": state})

    assert resp.status_code == 200
    async with TestSession() as session:
        assert str((await session.execute(select(OidcIdentity.user_id))).scalar_one()) == user_id
        assert (await session.execute(select(OidcIdentity.email))).scalar_one() == "sso@münchen.de"


async def test_link_refuses_an_email_that_only_casefolds_equal(client, provider_protocol):
    """An address that matches only under Unicode case folding is another address and is refused"""
    auth, _ = await _create_password_user(client, email="strasse@example.com")
    await _seed_provider()
    provider_protocol["claims"] = _claims(email="straße@example.com")

    state = await _start_link(client, auth)
    resp = await client.post("/auth/oidc/link/callback", headers=auth, json={"code": "any", "state": state})

    assert resp.status_code == 422


async def test_link_refuses_an_address_differing_in_capitals_beyond_a_to_z(client, provider_protocol):
    """Émile@ and émile@ can be two accounts, so a provider asserting one must not link to the other"""
    auth, _ = await _create_password_user(client, email="Émile@example.com")
    await _seed_provider()
    provider_protocol["claims"] = _claims(email="émile@example.com")

    state = await _start_link(client, auth)
    resp = await client.post("/auth/oidc/link/callback", headers=auth, json={"code": "any", "state": state})

    assert resp.status_code == 422


async def test_link_mismatch_is_refused_before_the_subject_lookup(client, provider_protocol):
    """A mismatched email gets the email refusal even for a subject another account owns, revealing nothing about it"""
    auth, _ = await _create_password_user(client)
    provider = await _seed_provider()
    provider_protocol["claims"] = _claims(email="someone-else@example.com")
    async with TestSession() as session:
        other_user = User(id=uuid.uuid4(), email="other@example.com", first_name="Other", tz="America/Toronto", base_currency="CAD")
        session.add(other_user)
        await session.flush()
        session.add(OidcIdentity(user_id=other_user.id, provider_id=provider.id, subject="subject-1", email="other@example.com"))
        await session.commit()

    state = await _start_link(client, auth)
    resp = await client.post("/auth/oidc/link/callback", headers=auth, json={"code": "any", "state": state})

    assert resp.status_code == 422


@pytest.mark.parametrize(
    ("account_email", "provider_email"),
    [("sso-user@example.com", "Sso-User@Example.com"), ("Sso-User@Example.com", "sso-user@example.com")],
)
async def test_link_accepts_an_email_differing_only_in_case(client, provider_protocol, account_email, provider_email):
    """Addresses that differ only in letter case are the same address, whichever side is cased differently"""
    auth, user_id = await _create_password_user(client, email=account_email)
    await _seed_provider()
    provider_protocol["claims"] = _claims(email=provider_email)

    state = await _start_link(client, auth)
    resp = await client.post("/auth/oidc/link/callback", headers=auth, json={"code": "any", "state": state})

    assert resp.status_code == 200
    async with TestSession() as session:
        identity = (await session.execute(select(OidcIdentity))).scalar_one()
    assert str(identity.user_id) == user_id


async def test_link_requires_correct_password(client, provider_protocol):
    """A wrong password fails the step-up before any roundtrip is stored"""
    auth, _ = await _create_password_user(client)
    await _seed_provider()

    resp = await client.post("/auth/oidc/test-idp/link", headers=auth, json={"password": "WrongPassword123!"})

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

    resp = await client.post("/auth/oidc/test-idp/link", headers=auth, json={"password": SIGNUP_PAYLOAD["password"]})

    assert resp.status_code == 400


async def test_link_callback_rejects_another_account(client, provider_protocol):
    """A link roundtrip only completes for the account whose step-up authorized it"""
    auth, _ = await _create_password_user(client)
    await _seed_provider()
    provider_protocol["claims"] = _claims()
    state = await _start_link(client, auth)

    other_signup = await sign_up_confirmed(client, {**SIGNUP_PAYLOAD, "email": "other@example.com"})
    from tests.routes.support import _get_auth_header

    other_auth = _get_auth_header(other_signup)
    resp = await client.post("/auth/oidc/link/callback", headers=other_auth, json={"code": "any", "state": state})

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
        session.add(OidcIdentity(user_id=other_user.id, provider_id=provider.id, subject="subject-1", email="other@example.com"))
        await session.commit()

    state = await _start_link(client, auth)
    resp = await client.post("/auth/oidc/link/callback", headers=auth, json={"code": "any", "state": state})

    assert resp.status_code == 409


async def test_link_races_to_conflict_not_crash(client, provider_protocol, monkeypatch):
    """A subject inserted between the pre-check and the commit is a conflict, not an unhandled error"""
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
        session.add(OidcIdentity(user_id=other_user.id, provider_id=provider.id, subject="subject-1", email="other@example.com"))
        await session.commit()

    # Hide the conflicting row from the pre-check so the insert is what trips the unique constraint,
    # standing in for a parallel link that commits between the check and this commit
    async def blind_find_identity(db, provider_id, subject):
        """Let the link proceed as if the subject were still unlinked"""
        return None

    monkeypatch.setattr(oidc_login, "_find_identity", blind_find_identity)

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
    linked = await client.post("/auth/oidc/link/callback", headers=auth, json={"code": "any", "state": state})
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
            (await session.execute(select(AuthIdentity).where(AuthIdentity.auth_provider == AuthProvider.OIDC))).scalars().all()
        )
    assert identities == []
    assert oidc_auth_identities == []


async def test_unlink_with_password_signs_out_other_sessions(client, provider_protocol):
    """Unlinking with the password signs out every other device and keeps the one that unlinked"""
    auth, _ = await _create_password_user(client)
    caller = (auth, client.cookies["refresh_token"])
    other = await _sign_in_again(client, email=_claims()["email"])
    await _seed_provider()
    provider_protocol["claims"] = _claims()
    state = await _start_link(client, auth)
    linked = await client.post("/auth/oidc/link/callback", headers=auth, json={"code": "any", "state": state})
    await _assert_session_works(client, caller)
    await _assert_session_works(client, other)

    resp = await client.post(
        f"/auth/oidc/identities/{linked.json()['id']}/remove",
        headers=auth,
        json={"password": SIGNUP_PAYLOAD["password"]},
    )
    assert resp.status_code == 204

    await _assert_other_sessions_ended(client, caller, other)


async def test_unlink_refused_keeps_other_sessions(client, provider_protocol):
    """A wrong password, or an identity that is not the user's, is refused and signs nobody out"""
    auth, _ = await _create_password_user(client)
    caller = (auth, client.cookies["refresh_token"])
    other = await _sign_in_again(client, email=_claims()["email"])
    await _seed_provider()
    provider_protocol["claims"] = _claims()
    state = await _start_link(client, auth)
    linked = await client.post("/auth/oidc/link/callback", headers=auth, json={"code": "any", "state": state})

    wrong_password = await client.post(
        f"/auth/oidc/identities/{linked.json()['id']}/remove", headers=auth, json={"password": "WrongPassword123!"}
    )
    assert wrong_password.status_code == 401
    unknown = await client.post(f"/auth/oidc/identities/{uuid.uuid4()}/remove", headers=auth, json={"password": SIGNUP_PAYLOAD["password"]})
    assert unknown.status_code == 404

    await _assert_other_sessions_kept(client, caller, other)


async def test_unlink_rejects_wrong_password(client, provider_protocol):
    """A wrong password fails the unlink step-up and keeps the identity"""
    auth, _ = await _create_password_user(client)
    await _seed_provider()
    provider_protocol["claims"] = _claims()
    state = await _start_link(client, auth)
    linked = await client.post("/auth/oidc/link/callback", headers=auth, json={"code": "any", "state": state})
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


# --- Reauth and set-password ---

_NEW_PASSWORD = "NewSecurePass123!"


async def _create_passwordless_user(client, provider_protocol):
    """Onboard an account through the provider and return its auth header and user id"""
    from tests.routes.support import _get_auth_header

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
    return _get_auth_header(completed), completed.json()["user"]["id"]


async def _start_reauth(client, auth, slug: str = "test-idp") -> str:
    """Begin a reauth roundtrip and return the state, asserting the provider is forced to reprompt"""
    resp = await client.post("/auth/oidc/reauth", headers=auth, json={"slug": slug})
    assert resp.status_code == 200
    params = parse_qs(urlparse(resp.json()["authorization_url"]).query)
    assert params["prompt"] == ["login"]
    assert params["max_age"] == [str(OIDC_REAUTH_MAX_AGE_SECONDS)]
    return params["state"][0]


async def _arm_reauth_proof(client, auth, provider_protocol):
    """Reauth through the linked provider so the client holds a fresh step-up proof cookie"""
    state = await _start_reauth(client, auth)
    provider_protocol["claims"] = _claims()
    resp = await client.post("/auth/oidc/reauth/callback", headers=auth, json={"code": "any", "state": state})
    assert resp.status_code == 204


async def test_reauth_forces_reprompt_for_passwordless_account(client, provider_protocol):
    """A passwordless account can start a reauth against its linked provider with prompt=login"""
    await _seed_currency()
    await _seed_provider()
    auth, _ = await _create_passwordless_user(client, provider_protocol)

    await _start_reauth(client, auth)


async def test_reauth_rejected_when_account_has_password(client, provider_protocol):
    """An account with a password steps up with it, so reauth-to-set-password is refused"""
    auth, _ = await _create_password_user(client)
    await _seed_provider()

    resp = await client.post("/auth/oidc/reauth", headers=auth, json={"slug": "test-idp"})

    assert resp.status_code == 409


async def test_reauth_rejects_unlinked_provider(client, provider_protocol):
    """Reauth is refused against a provider the account has not linked"""
    await _seed_currency()
    await _seed_provider()
    auth, _ = await _create_passwordless_user(client, provider_protocol)
    await _seed_provider(slug="other-idp")

    resp = await client.post("/auth/oidc/reauth", headers=auth, json={"slug": "other-idp"})

    assert resp.status_code == 404


async def test_reauth_callback_rejects_a_different_subject(client, provider_protocol):
    """Re-authenticating as an identity the account does not own fails the step-up"""
    await _seed_currency()
    await _seed_provider()
    auth, _ = await _create_passwordless_user(client, provider_protocol)
    state = await _start_reauth(client, auth)

    # The provider returns a subject that is not linked to this account
    provider_protocol["claims"] = _claims(sub="someone-else")
    resp = await client.post("/auth/oidc/reauth/callback", headers=auth, json={"code": "any", "state": state})

    assert resp.status_code == 401


async def test_login_state_cannot_complete_reauth(client, provider_protocol):
    """A login roundtrip can never complete the reauth callback"""
    await _seed_currency()
    await _seed_provider()
    auth, _ = await _create_passwordless_user(client, provider_protocol)
    login_state = await _start_sign_in(client)

    resp = await client.post("/auth/oidc/reauth/callback", headers=auth, json={"code": "any", "state": login_state})

    assert resp.status_code == 401


async def test_passwordless_account_links_provider_after_reauth(client, provider_protocol):
    """A passwordless account links a new provider by stepping up with a linked one"""
    await _seed_currency()
    await _seed_provider()
    await _seed_provider(slug="other-idp")
    auth, _ = await _create_passwordless_user(client, provider_protocol)

    await _arm_reauth_proof(client, auth, provider_protocol)
    begun = await client.post("/auth/oidc/other-idp/link", headers=auth)
    assert begun.status_code == 200
    assert _clears_cookie(begun, "oidc_reauth_stepup")

    # The reauth proof authorized the link, so the roundtrip to the new provider completes it
    state = parse_qs(urlparse(begun.json()["authorization_url"]).query)["state"][0]
    provider_protocol["claims"] = _claims(sub="subject-2")
    linked = await client.post("/auth/oidc/link/callback", headers=auth, json={"code": "any", "state": state})
    assert linked.status_code == 200
    assert linked.json()["provider_slug"] == "other-idp"


async def test_passwordless_link_without_reauth_is_rejected(client, provider_protocol):
    """A passwordless account cannot link a provider without a fresh reauth proof"""
    await _seed_currency()
    await _seed_provider()
    await _seed_provider(slug="other-idp")
    auth, _ = await _create_passwordless_user(client, provider_protocol)

    resp = await client.post("/auth/oidc/other-idp/link", headers=auth)

    assert resp.status_code == 401


async def test_passwordless_link_with_a_bad_proof_spends_it(client, provider_protocol):
    """A link refused over its reauth proof still tells the browser to drop the single-use proof"""
    await _seed_currency()
    await _seed_provider()
    await _seed_provider(slug="other-idp")
    auth, _ = await _create_passwordless_user(client, provider_protocol)

    client.cookies.set("oidc_reauth_stepup", "not-a-proof")
    resp = await client.post("/auth/oidc/other-idp/link", headers=auth)

    assert resp.status_code == 401
    assert resp.json()["detail"] == "Reauthentication required"
    assert _clears_cookie(resp, "oidc_reauth_stepup")


async def test_passwordless_account_unlinks_provider_after_reauth(client, provider_protocol):
    """A passwordless account removes a linked provider by stepping up with another"""
    await _seed_currency()
    await _seed_provider()
    other = await _seed_provider(slug="other-idp")
    auth, user_id = await _create_passwordless_user(client, provider_protocol)

    # A second linked provider means removing one does not strand the account
    other_identity_id = uuid.uuid4()
    async with TestSession() as session:
        session.add(
            OidcIdentity(
                id=other_identity_id,
                user_id=uuid.UUID(user_id),
                provider_id=other.id,
                subject="subject-2",
                email="sso-user@example.com",
            )
        )
        await session.commit()

    await _arm_reauth_proof(client, auth, provider_protocol)
    resp = await client.post(f"/auth/oidc/identities/{other_identity_id}/remove", headers=auth)

    assert resp.status_code == 204
    assert _clears_cookie(resp, "oidc_reauth_stepup")
    async with TestSession() as session:
        remaining = (await session.execute(select(OidcIdentity).where(OidcIdentity.user_id == uuid.UUID(user_id)))).scalars().all()
    assert len(remaining) == 1


async def _sign_in_through_provider(client, provider_protocol) -> tuple[dict, str]:
    """Sign the passwordless account in again through its provider, returning that session's auth header and refresh cookie"""
    state = await _start_sign_in(client)
    provider_protocol["claims"] = _claims()
    resp = await client.post("/auth/oidc/callback", json={"code": "any", "state": state})
    assert resp.status_code == 200, resp.text
    return _get_auth_header(resp), resp.cookies["refresh_token"]


async def test_passwordless_unlink_signs_out_other_sessions(client, provider_protocol):
    """A passwordless account unlinking with a fresh reauth signs out every other device and keeps its own"""
    await _seed_currency()
    await _seed_provider()
    other_provider = await _seed_provider(slug="other-idp")
    auth, user_id = await _create_passwordless_user(client, provider_protocol)
    caller = (auth, client.cookies["refresh_token"])
    other = await _sign_in_through_provider(client, provider_protocol)

    other_identity_id = uuid.uuid4()
    async with TestSession() as session:
        session.add(
            OidcIdentity(
                id=other_identity_id,
                user_id=uuid.UUID(user_id),
                provider_id=other_provider.id,
                subject="subject-2",
                email="sso-user@example.com",
            )
        )
        await session.commit()
    await _assert_session_works(client, caller)
    await _assert_session_works(client, other)

    await _arm_reauth_proof(client, auth, provider_protocol)
    resp = await client.post(f"/auth/oidc/identities/{other_identity_id}/remove", headers=auth)
    assert resp.status_code == 204

    await _assert_other_sessions_ended(client, caller, other)


async def test_passwordless_end_others_after_reauth_signs_out_other_sessions(client, provider_protocol):
    """A passwordless account signs out its other devices with a fresh reauth, and without one is refused"""
    await _seed_currency()
    await _seed_provider()
    auth, _ = await _create_passwordless_user(client, provider_protocol)
    caller = (auth, client.cookies["refresh_token"])
    other = await _sign_in_through_provider(client, provider_protocol)

    refused = await client.post("/auth/sessions/end-others", headers=auth)
    assert refused.status_code == 401
    await _assert_session_works(client, other)

    await _arm_reauth_proof(client, auth, provider_protocol)
    resp = await client.post("/auth/sessions/end-others", headers=auth)
    assert resp.status_code == 204
    assert _clears_cookie(resp, "oidc_reauth_stepup")

    await _assert_other_sessions_ended(client, caller, other)


async def test_passwordless_unlink_refused_keeps_other_sessions(client, provider_protocol):
    """Removing the only provider is refused, and the reauth that authorized it signs nobody out"""
    await _seed_currency()
    await _seed_provider()
    auth, user_id = await _create_passwordless_user(client, provider_protocol)
    caller = (auth, client.cookies["refresh_token"])
    other = await _sign_in_through_provider(client, provider_protocol)
    async with TestSession() as session:
        identity_id = (await session.execute(select(OidcIdentity).where(OidcIdentity.user_id == uuid.UUID(user_id)))).scalar_one().id

    await _arm_reauth_proof(client, auth, provider_protocol)
    resp = await client.post(f"/auth/oidc/identities/{identity_id}/remove", headers=auth)
    assert resp.status_code == 409

    await _assert_other_sessions_kept(client, caller, other)


async def test_passwordless_unlink_last_provider_is_refused(client, provider_protocol):
    """Removing the only provider from a passwordless account is refused to avoid a lockout"""
    await _seed_currency()
    await _seed_provider()
    auth, user_id = await _create_passwordless_user(client, provider_protocol)

    async with TestSession() as session:
        identity = (await session.execute(select(OidcIdentity).where(OidcIdentity.user_id == uuid.UUID(user_id)))).scalar_one()
        identity_id = identity.id

    await _arm_reauth_proof(client, auth, provider_protocol)
    resp = await client.post(f"/auth/oidc/identities/{identity_id}/remove", headers=auth)

    assert resp.status_code == 409
    assert _clears_cookie(resp, "oidc_reauth_stepup")


async def test_passwordless_unlink_without_reauth_is_rejected(client, provider_protocol):
    """A passwordless account cannot remove a provider without a fresh reauth proof"""
    await _seed_currency()
    await _seed_provider()
    auth, user_id = await _create_passwordless_user(client, provider_protocol)

    async with TestSession() as session:
        identity = (await session.execute(select(OidcIdentity).where(OidcIdentity.user_id == uuid.UUID(user_id)))).scalar_one()
        identity_id = identity.id

    resp = await client.post(f"/auth/oidc/identities/{identity_id}/remove", headers=auth)

    assert resp.status_code == 401


async def test_set_password_requires_reauth_cookie(client, provider_protocol):
    """Setting a password with only a live session, no reauth authorization, is refused"""
    await _seed_currency()
    await _seed_provider()
    auth, _ = await _create_passwordless_user(client, provider_protocol)

    resp = await client.post("/auth/password/set", headers=auth, json={"new_password": _NEW_PASSWORD})

    assert resp.status_code == 401


async def test_set_password_races_to_conflict_not_crash(client, provider_protocol, monkeypatch):
    """A credential inserted between the pre-check and the commit is a conflict, not an unhandled error"""
    from app.models.auth import PasswordCredential
    from app.services.auth import set_password as set_password_service
    from app.services.auth.password_helpers import hash_password

    await _seed_currency()
    await _seed_provider()
    auth, user_id = await _create_passwordless_user(client, provider_protocol)

    state = await _start_reauth(client, auth)
    provider_protocol["claims"] = _claims()
    reauth = await client.post("/auth/oidc/reauth/callback", headers=auth, json={"code": "any", "state": state})
    assert reauth.status_code == 204

    # Give the account a credential after the reauth, then hide it from the pre-check so the insert is
    # what trips the primary key, standing in for a parallel set-password that commits first
    async with TestSession() as session:
        session.add(
            PasswordCredential(
                user_id=uuid.UUID(user_id),
                password_hash=hash_password("Existing-Pass-1!"),
                password_algo="argon2id",
            )
        )
        await session.commit()

    async def blind_credential(db, target_user_id):
        """Let the set-password proceed as if the account still had none"""
        return None

    monkeypatch.setattr(set_password_service, "get_password_credential", blind_credential)

    resp = await client.post("/auth/password/set", headers=auth, json={"new_password": _NEW_PASSWORD})

    assert resp.status_code == 409
    assert _clears_cookie(resp, "oidc_reauth_stepup")


async def test_set_password_after_reauth(client, provider_protocol):
    """A reauth authorizes setting the first password, after which the account can sign in with it"""
    from app.models.auth import PasswordCredential

    await _seed_currency()
    await _seed_provider()
    auth, user_id = await _create_passwordless_user(client, provider_protocol)

    state = await _start_reauth(client, auth)
    provider_protocol["claims"] = _claims()
    reauth = await client.post("/auth/oidc/reauth/callback", headers=auth, json={"code": "any", "state": state})
    assert reauth.status_code == 204

    resp = await client.post("/auth/password/set", headers=auth, json={"new_password": _NEW_PASSWORD})
    assert resp.status_code == 204
    assert _clears_cookie(resp, "oidc_reauth_stepup")

    async with TestSession() as session:
        credential = (await session.execute(select(PasswordCredential).where(PasswordCredential.user_id == uuid.UUID(user_id)))).scalar_one()
        password_identity = (
            await session.execute(
                select(AuthIdentity).where(
                    AuthIdentity.user_id == uuid.UUID(user_id),
                    AuthIdentity.auth_provider == AuthProvider.PASSWORD,
                )
            )
        ).scalar_one()
    assert credential.password_hash != _NEW_PASSWORD
    assert password_identity is not None

    # The account can now sign in with the password, and reauth-to-set is no longer offered
    login = await client.post("/auth/login", json={"email": "sso-user@example.com", "password": _NEW_PASSWORD})
    assert login.status_code == 200
    again = await client.post("/auth/oidc/reauth", headers=auth, json={"slug": "test-idp"})
    assert again.status_code == 409


async def _spend_proof_setting_a_password(client, auth, provider_protocol) -> str:
    """Reauth, set the first password with the proof, and return the proof's value, which the browser has dropped"""
    await _arm_reauth_proof(client, auth, provider_protocol)
    proof = client.cookies.get("oidc_reauth_stepup")
    assert (await client.post("/auth/password/set", headers=auth, json={"new_password": _NEW_PASSWORD})).status_code == 204
    return proof


async def test_reauth_proof_cannot_be_replayed_to_set_a_password(client, provider_protocol):
    """A copy of a spent proof is refused, so the one reauth authorized one action"""
    await _seed_currency()
    await _seed_provider()
    auth, _ = await _create_passwordless_user(client, provider_protocol)
    proof = await _spend_proof_setting_a_password(client, auth, provider_protocol)

    client.cookies.set("oidc_reauth_stepup", proof)
    replay = await client.post("/auth/password/set", headers=auth, json={"new_password": _NEW_PASSWORD})

    assert (replay.status_code, replay.json()["detail"]) == (401, "Reauthentication required")
    assert _clears_cookie(replay, "oidc_reauth_stepup")


async def test_reauth_proof_cannot_be_replayed_to_link_a_provider(client, provider_protocol):
    """A copy of a proof already spent on linking a provider can't link another"""
    await _seed_currency()
    await _seed_provider()
    await _seed_provider(slug="other-idp")
    auth, _ = await _create_passwordless_user(client, provider_protocol)
    await _arm_reauth_proof(client, auth, provider_protocol)
    proof = client.cookies.get("oidc_reauth_stepup")
    assert (await client.post("/auth/oidc/other-idp/link", headers=auth)).status_code == 200

    client.cookies.set("oidc_reauth_stepup", proof)
    replay = await client.post("/auth/oidc/other-idp/link", headers=auth)

    assert (replay.status_code, replay.json()["detail"]) == (401, "Reauthentication required")


async def test_reauth_proof_row_expires_with_the_proof(client, provider_protocol):
    """The server's record of a proof ends at the instant the proof itself does"""
    from app.models.auth import MfaChallenge

    await _seed_currency()
    await _seed_provider()
    auth, _ = await _create_passwordless_user(client, provider_protocol)
    await _arm_reauth_proof(client, auth, provider_protocol)
    proof = client.cookies.get("oidc_reauth_stepup")

    async with TestSession() as session:
        row = (await session.execute(select(MfaChallenge).where(MfaChallenge.purpose == "reauth_step_up"))).scalar_one()
    claims = pyjwt.decode(proof, options={"verify_signature": False})
    assert (int(row.expires_at.timestamp()), str(row.jti)) == (claims["exp"], claims["jti"])


async def test_reauth_proof_past_its_lifetime_is_refused(client, provider_protocol):
    """A proof whose record has expired authorizes nothing"""
    from app.models.auth import MfaChallenge

    await _seed_currency()
    await _seed_provider()
    auth, _ = await _create_passwordless_user(client, provider_protocol)
    await _arm_reauth_proof(client, auth, provider_protocol)
    async with TestSession() as session:
        await session.execute(update(MfaChallenge).values(expires_at=datetime.now(UTC) - timedelta(seconds=1)))
        await session.commit()

    resp = await client.post("/auth/password/set", headers=auth, json={"new_password": _NEW_PASSWORD})

    assert (resp.status_code, resp.json()["detail"]) == (401, "Reauthentication required")


async def test_reauth_proof_stays_spent_after_the_action_it_authorized_is_refused(client, provider_protocol):
    """A proof used on an unlink the account can't take is gone, so a copy can't be tried on another action"""
    await _seed_currency()
    await _seed_provider()
    auth, user_id = await _create_passwordless_user(client, provider_protocol)
    async with TestSession() as session:
        identity_id = (await session.execute(select(OidcIdentity.id).where(OidcIdentity.user_id == uuid.UUID(user_id)))).scalar_one()
    await _arm_reauth_proof(client, auth, provider_protocol)
    proof = client.cookies.get("oidc_reauth_stepup")
    refused = await client.post(f"/auth/oidc/identities/{identity_id}/remove", headers=auth)
    assert refused.status_code == 409

    client.cookies.set("oidc_reauth_stepup", proof)
    replay = await client.post(f"/auth/oidc/identities/{identity_id}/remove", headers=auth)

    assert (replay.status_code, replay.json()["detail"]) == (401, "Reauthentication required")


async def test_account_with_a_password_ignores_a_reauth_proof_it_sends(client, provider_protocol):
    """A proof left from before the account had a password can't authorize a link, which needs the password step-up"""
    from app.models.auth import PasswordCredential
    from app.services.auth.password_helpers import hash_password

    await _seed_currency()
    await _seed_provider()
    await _seed_provider(slug="other-idp")
    auth, user_id = await _create_passwordless_user(client, provider_protocol)
    await _arm_reauth_proof(client, auth, provider_protocol)
    proof = client.cookies.get("oidc_reauth_stepup")

    # The password is stored directly, so the proof is still unspent and only the password can refuse it
    async with TestSession() as session:
        session.add(PasswordCredential(user_id=uuid.UUID(user_id), password_hash=hash_password(_NEW_PASSWORD), password_algo="argon2id"))
        await session.commit()

    client.cookies.set("oidc_reauth_stepup", proof)
    without_step_up = await client.post("/auth/oidc/other-idp/link", headers=auth)
    assert (without_step_up.status_code, without_step_up.json()["detail"]) == (401, "Reauthentication required")
    assert _clears_cookie(without_step_up, "oidc_reauth_stepup")

    client.cookies.set("oidc_reauth_stepup", proof)
    with_step_up = await client.post("/auth/oidc/other-idp/link", headers=auth, json={"password": _NEW_PASSWORD})
    assert with_step_up.status_code == 200
    assert _clears_cookie(with_step_up, "oidc_reauth_stepup")


async def test_setting_a_first_password_gives_the_account_a_new_saved_copy_key(client, provider_protocol):
    """Setting a password signs out the other sessions, so the next sign-in carries a key their copies can't open"""
    await _seed_currency()
    await _seed_provider()
    auth, user_id = await _create_passwordless_user(client, provider_protocol)

    state = await _start_reauth(client, auth)
    provider_protocol["claims"] = _claims()
    await client.post("/auth/oidc/reauth/callback", headers=auth, json={"code": "any", "state": state})
    assert (await client.post("/auth/password/set", headers=auth, json={"new_password": _NEW_PASSWORD})).status_code == 204

    login = await client.post("/auth/login", json={"email": "sso-user@example.com", "password": _NEW_PASSWORD})
    assert _saved_copy_key(login) == (derive_saved_copy_key(uuid.UUID(user_id), 1), 1)


async def _start_sign_in_over_https(client) -> str:
    """Begin a sign-in on an HTTPS connection, asserting the binding cookie is host-bound, and return the state"""
    client.headers["x-forwarded-proto"] = "https"
    resp = await client.post("/auth/oidc/test-idp/authorize")
    assert resp.status_code == 200
    _assert_host_bound_cookie(resp, "oidc_login_binding")
    return parse_qs(urlparse(resp.json()["authorization_url"]).query)["state"][0]


async def test_callback_over_https_reads_the_host_bound_binding_cookie(client, provider_protocol):
    """A sign-in started over HTTPS completes with the host-bound cookie, and the callback then removes it"""
    await _seed_provider()
    provider_protocol["claims"] = _claims()
    state = await _start_sign_in_over_https(client)
    _resend_cookie(client, "__Host-oidc_login_binding")

    resp = await client.post("/auth/oidc/callback", json={"code": "any", "state": state})

    assert resp.status_code == 200
    assert "max-age=0" in _assert_host_bound_cookie(resp, "oidc_login_binding")


async def test_callback_over_https_refuses_the_binding_secret_under_the_bare_name(client, provider_protocol):
    """A sibling hostname can only plant the bare name, so even the right secret under it binds nothing"""
    await _seed_provider()
    provider_protocol["claims"] = _claims()
    state = await _start_sign_in_over_https(client)
    _resend_cookie(client, "__Host-oidc_login_binding", send_as="oidc_login_binding")

    resp = await client.post("/auth/oidc/callback", json={"code": "any", "state": state})

    assert "oidc_login_binding=" in resp.request.headers["cookie"], "the bare-name cookie reached the app"
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Single sign-on failed"
    assert "max-age=0" in _assert_host_bound_cookie(resp, "oidc_login_binding"), "the refusal removes the host-bound cookie"


async def test_sign_in_over_plain_http_keeps_the_bare_binding_cookie_a_browser_there_accepts(client, provider_protocol):
    """A plain HTTP install sets and removes the binding cookie without Secure, or its browser would drop it"""
    await _seed_provider()
    provider_protocol["claims"] = _claims()
    started = await client.post("/auth/oidc/test-idp/authorize")
    state = parse_qs(urlparse(started.json()["authorization_url"]).query)["state"][0]

    resp = await client.post("/auth/oidc/callback", json={"code": "any", "state": state})

    assert resp.status_code == 200
    assert "max-age" in _assert_bare_cookie(started, "oidc_login_binding")
    assert "max-age=0" in _assert_bare_cookie(resp, "oidc_login_binding")


async def _arm_reauth_proof_over_https(client, provider_protocol) -> dict:
    """Make a passwordless account reauthenticate over HTTPS, asserting the proof cookie is host-bound

    Returns:
        The account's auth header
    """
    await _seed_currency()
    await _seed_provider()
    auth, _ = await _create_passwordless_user(client, provider_protocol)
    client.headers["x-forwarded-proto"] = "https"
    state = await _start_reauth(client, auth)
    provider_protocol["claims"] = _claims()
    resp = await client.post("/auth/oidc/reauth/callback", headers=auth, json={"code": "any", "state": state})
    assert resp.status_code == 204
    _assert_host_bound_cookie(resp, "oidc_reauth_stepup")
    return auth


async def test_reauth_proof_over_https_is_read_from_its_host_bound_cookie(client, provider_protocol):
    """A proof armed over HTTPS authorizes the password it was for, and the spent cookie is removed host-bound"""
    auth = await _arm_reauth_proof_over_https(client, provider_protocol)
    _resend_cookie(client, "__Host-oidc_reauth_stepup")

    resp = await client.post("/auth/password/set", headers=auth, json={"new_password": _NEW_PASSWORD})

    assert resp.status_code == 204
    assert "max-age=0" in _assert_host_bound_cookie(resp, "oidc_reauth_stepup")


async def test_reauth_proof_over_https_is_refused_under_the_bare_name(client, provider_protocol):
    """A copy of a real proof under the bare name authorizes nothing, since a sibling hostname could send one"""
    auth = await _arm_reauth_proof_over_https(client, provider_protocol)
    _resend_cookie(client, "__Host-oidc_reauth_stepup", send_as="oidc_reauth_stepup")

    resp = await client.post("/auth/password/set", headers=auth, json={"new_password": _NEW_PASSWORD})

    assert "oidc_reauth_stepup=" in resp.request.headers["cookie"], "the bare-name copy reached the app"
    assert (resp.status_code, resp.json()["detail"]) == (401, "Reauthentication required")
    assert "max-age=0" in _assert_host_bound_cookie(resp, "oidc_reauth_stepup")


@pytest.mark.parametrize(
    ("request_path", "success_status"),
    [("/auth/sessions/end-others", 204), ("/auth/oidc/other-idp/link", 200)],
    ids=["end-other-sessions", "link-provider"],
)
async def test_other_routes_taking_the_reauth_proof_read_its_host_bound_cookie(client, provider_protocol, request_path, success_status):
    """Every route that accepts the proof reads it under the host-bound name over HTTPS, not only setting a password"""
    await _seed_provider(slug="other-idp")
    auth = await _arm_reauth_proof_over_https(client, provider_protocol)
    _resend_cookie(client, "__Host-oidc_reauth_stepup")

    resp = await client.post(request_path, headers=auth)

    assert resp.status_code == success_status
    assert "max-age=0" in _assert_host_bound_cookie(resp, "oidc_reauth_stepup")


async def test_reauth_proof_over_plain_http_keeps_the_bare_cookie_a_browser_there_accepts(client, provider_protocol):
    """A plain HTTP install sets and removes the proof cookie without Secure, or its browser would drop it"""
    await _seed_currency()
    await _seed_provider()
    auth, _ = await _create_passwordless_user(client, provider_protocol)
    state = await _start_reauth(client, auth)
    provider_protocol["claims"] = _claims()
    armed = await client.post("/auth/oidc/reauth/callback", headers=auth, json={"code": "any", "state": state})

    spent = await client.post("/auth/password/set", headers=auth, json={"new_password": _NEW_PASSWORD})

    assert (armed.status_code, spent.status_code) == (204, 204)
    assert "max-age" in _assert_bare_cookie(armed, "oidc_reauth_stepup")
    assert "max-age=0" in _assert_bare_cookie(spent, "oidc_reauth_stepup")
