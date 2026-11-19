"""OIDC protocol client tests against a mocked provider"""

import base64
import hashlib
import json
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException

from app.services.auth import oidc_client
from app.services.auth.oidc_client import (
    build_authorization_url,
    exchange_authorization_code,
    fetch_userinfo,
    generate_pkce_pair,
    get_provider_metadata,
    verify_provider_id_token,
)

ISSUER = "https://idp.test"
CLIENT_ID = "client-123"
KEY_ID = "test-key-1"

_PRIVATE_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _jwks_document(key_id: str = KEY_ID) -> dict:
    """Return the provider JWKS document for the test signing key"""
    public_jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(_PRIVATE_KEY.public_key()))
    return {"keys": [{**public_jwk, "kid": key_id, "use": "sig", "alg": "RS256"}]}


def _metadata() -> dict:
    """Return the discovery document the mocked provider publishes"""
    return {
        "issuer": ISSUER,
        "authorization_endpoint": f"{ISSUER}/authorize",
        "token_endpoint": f"{ISSUER}/token",
        "jwks_uri": f"{ISSUER}/jwks",
        "userinfo_endpoint": f"{ISSUER}/userinfo",
    }


def _make_id_token(key_id: str = KEY_ID, algorithm: str = "RS256", **claim_overrides) -> str:
    """Return a signed ID token with valid claims unless overridden"""
    issued_at = datetime.now(UTC)
    claims = {
        "iss": ISSUER,
        "aud": CLIENT_ID,
        "sub": "subject-1",
        "iat": issued_at,
        "exp": issued_at + timedelta(minutes=5),
        "nonce": "nonce-1",
        **claim_overrides,
    }
    return jwt.encode(claims, _PRIVATE_KEY, algorithm=algorithm, headers={"kid": key_id})


class _FakeProvider:
    """Serves discovery, JWKS, token, and userinfo responses while counting requests"""

    def __init__(self):
        self.responses = {
            "/.well-known/openid-configuration": lambda: httpx.Response(200, json=_metadata()),
            "/jwks": lambda: httpx.Response(200, json=_jwks_document()),
        }
        self.request_counts: dict[str, int] = {}

    def handler(self, request: httpx.Request) -> httpx.Response:
        """Answer one mocked provider request by path"""
        path = request.url.path
        self.request_counts[path] = self.request_counts.get(path, 0) + 1
        builder = self.responses.get(path)
        if builder is None:
            return httpx.Response(404)
        return builder()


@pytest.fixture
def fake_provider(monkeypatch):
    """Route the client's HTTP calls to an in-memory provider and clear the caches"""
    provider = _FakeProvider()
    transport = httpx.MockTransport(provider.handler)
    monkeypatch.setattr(oidc_client, "_http_client", lambda: httpx.AsyncClient(transport=transport))
    oidc_client._metadata_cache.clear()
    oidc_client._jwks_cache.clear()
    return provider


# --- PKCE and authorization URL ---


def test_generate_pkce_pair_matches_s256():
    """The challenge is the base64url SHA-256 of the verifier inside the RFC length range"""
    code_verifier, code_challenge = generate_pkce_pair()

    expected = base64.urlsafe_b64encode(hashlib.sha256(code_verifier.encode()).digest()).rstrip(b"=").decode()
    assert code_challenge == expected
    assert 43 <= len(code_verifier) <= 128


def test_build_authorization_url_carries_code_flow_params():
    """The authorization URL carries every code flow and PKCE parameter"""
    url = build_authorization_url(
        _metadata(),
        client_id=CLIENT_ID,
        scopes="openid email profile",
        redirect_uri="https://app.test/auth/oidc/callback",
        state="state-1",
        nonce="nonce-1",
        code_challenge="challenge-1",
    )

    params = parse_qs(urlparse(url).query)
    assert url.startswith(f"{ISSUER}/authorize?")
    assert params["response_type"] == ["code"]
    assert params["client_id"] == [CLIENT_ID]
    assert params["redirect_uri"] == ["https://app.test/auth/oidc/callback"]
    assert params["scope"] == ["openid email profile"]
    assert params["state"] == ["state-1"]
    assert params["nonce"] == ["nonce-1"]
    assert params["code_challenge"] == ["challenge-1"]
    assert params["code_challenge_method"] == ["S256"]
    assert "max_age" not in params


# --- Discovery ---


async def test_discovery_returns_and_caches_document(fake_provider):
    """The discovery document is fetched once and served from cache afterwards"""
    first = await get_provider_metadata(ISSUER)
    second = await get_provider_metadata(ISSUER)

    assert first["token_endpoint"] == f"{ISSUER}/token"
    assert second is first
    assert fake_provider.request_counts["/.well-known/openid-configuration"] == 1


async def test_discovery_accepts_trailing_slash_issuer(fake_provider):
    """An issuer published with a trailing slash, as Authentik does, discovers and matches"""
    slash_issuer = f"{ISSUER}/"
    fake_provider.responses["/.well-known/openid-configuration"] = lambda: httpx.Response(200, json={**_metadata(), "issuer": slash_issuer})

    metadata = await get_provider_metadata(slash_issuer)

    assert metadata["issuer"] == slash_issuer
    assert fake_provider.request_counts["/.well-known/openid-configuration"] == 1


async def test_discovery_rejects_issuer_mismatch(fake_provider):
    """A discovery document naming a different issuer is refused"""
    fake_provider.responses["/.well-known/openid-configuration"] = lambda: httpx.Response(
        200, json={**_metadata(), "issuer": "https://evil.test"}
    )

    with pytest.raises(HTTPException) as excinfo:
        await get_provider_metadata(ISSUER)
    assert excinfo.value.status_code == 502


def _serve_discovery(fake_provider, issuer: str = ISSUER, omit: tuple[str, ...] = (), **endpoint_overrides):
    """Publish a discovery document with every endpoint on the issuer, apart from those replaced or left out"""
    endpoints = {key: value.replace(ISSUER, issuer.rstrip("/")) for key, value in _metadata().items() if key != "issuer"}
    document = {"issuer": issuer, **endpoints, **endpoint_overrides}
    for key in omit:
        del document[key]
    fake_provider.responses["/.well-known/openid-configuration"] = lambda: httpx.Response(200, json=document)


async def test_discovery_refuses_a_plain_http_token_endpoint_and_logs_why(fake_provider, caplog):
    """A token endpoint on plain http would receive the client secret in the clear, so the provider is refused"""
    _serve_discovery(fake_provider, token_endpoint="http://10.0.0.5/token")

    with pytest.raises(HTTPException) as excinfo:
        await get_provider_metadata(ISSUER)

    assert excinfo.value.status_code == 502
    assert excinfo.value.detail == "Identity provider unavailable"
    assert "token_endpoint 'http://10.0.0.5/token' uses plain http" in caplog.text


@pytest.mark.parametrize(
    ("allowed_hosts", "is_accepted"),
    [(frozenset(), False), (frozenset({"cdn.other.example"}), True)],
)
async def test_discovery_accepts_a_keys_endpoint_on_another_host_only_when_allowed(
    fake_provider, monkeypatch, caplog, allowed_hosts, is_accepted
):
    """Keys published on another host are used only when the configuration lists that host"""
    monkeypatch.setattr(oidc_client, "OIDC_ENDPOINT_HOSTS_BY_ISSUER", {ISSUER: allowed_hosts})
    _serve_discovery(fake_provider, jwks_uri="https://cdn.other.example/jwks")

    if is_accepted:
        metadata = await get_provider_metadata(ISSUER)
        assert metadata["jwks_uri"] == "https://cdn.other.example/jwks"
    else:
        with pytest.raises(HTTPException):
            await get_provider_metadata(ISSUER)
        assert (
            "jwks_uri 'https://cdn.other.example/jwks' is on a host that is neither the issuer's nor listed in OIDC_GENERIC_ENDPOINT_HOSTS"
            in caplog.text
        )


@pytest.mark.parametrize(
    ("endpoint", "value", "reason"),
    [
        ("authorization_endpoint", "https://evil.test/authorize", "is on a host"),
        ("userinfo_endpoint", "https://evil.test/userinfo", "is on a host"),
        ("token_endpoint", "https://idp.test@evil.test/token", "carries a user name or password"),
        ("token_endpoint", "https://user@idp.test/token", "carries a user name or password"),
        ("token_endpoint", "https://:secret@idp.test/token", "carries a user name or password"),
        ("token_endpoint", "https://evil.test\\@idp.test/token", "contains a backslash"),
        ("token_endpoint", "https://idp.test/to ken", "contains a backslash, whitespace"),
        ("token_endpoint", "https://idp.test/to\x00ken", "or a control character"),
        ("token_endpoint", "https://idp.test/to\x7fken", "or a control character"),
        ("token_endpoint", "http://idp.test/token", "uses plain http"),
        ("authorization_endpoint", "javascript:alert(1)//idp.test", "is not an https address"),
        ("token_endpoint", "https:///token", "names no host"),
        ("token_endpoint", "https://idp.test./token", "is on a host"),
        ("jwks_uri", ["https://idp.test/jwks"], "is not text"),
    ],
)
async def test_discovery_refuses_an_endpoint_it_cannot_trust(fake_provider, caplog, endpoint, value, reason):
    """Each endpoint the client calls or sends the browser to is checked, and the log says which and why"""
    _serve_discovery(fake_provider, **{endpoint: value})

    with pytest.raises(HTTPException):
        await get_provider_metadata(ISSUER)

    assert f"its {endpoint} " in caplog.text
    assert reason in caplog.text


@pytest.mark.parametrize(
    ("issuer", "token_endpoint"),
    [
        (ISSUER, "https://IDP.test:8443/token"),
        ("http://localhost:9000", "http://localhost:9000/token"),
    ],
)
async def test_discovery_accepts_endpoints_on_the_issuer_host(fake_provider, issuer, token_endpoint):
    """The issuer's host matches in any letter case and on any port, and a loopback http issuer keeps plain http"""
    _serve_discovery(fake_provider, issuer=issuer, token_endpoint=token_endpoint)

    metadata = await get_provider_metadata(issuer)

    assert metadata["token_endpoint"] == token_endpoint


async def test_discovery_refuses_plain_http_off_a_loopback_issuer_host(fake_provider, monkeypatch, caplog):
    """A loopback http issuer allows plain http only on its own host, even one the configuration lists"""
    monkeypatch.setattr(oidc_client, "OIDC_ENDPOINT_HOSTS_BY_ISSUER", {"http://localhost:9000": frozenset({"127.0.0.1"})})
    _serve_discovery(fake_provider, issuer="http://localhost:9000", token_endpoint="http://127.0.0.1:9000/token")

    with pytest.raises(HTTPException):
        await get_provider_metadata("http://localhost:9000")

    assert "token_endpoint 'http://127.0.0.1:9000/token' uses plain http" in caplog.text


async def test_discovery_accepts_a_provider_that_publishes_no_user_info_endpoint(fake_provider):
    """User info is optional, so a document without it is accepted"""
    _serve_discovery(fake_provider, omit=("userinfo_endpoint",))

    metadata = await get_provider_metadata(ISSUER)

    assert "userinfo_endpoint" not in metadata


async def test_discovery_refuses_a_document_missing_its_token_endpoint(fake_provider, caplog):
    """Sign-in can't finish without the token endpoint, so a document without one is refused"""
    _serve_discovery(fake_provider, omit=("token_endpoint",))

    with pytest.raises(HTTPException) as excinfo:
        await get_provider_metadata(ISSUER)

    assert excinfo.value.status_code == 502
    assert "its token_endpoint is missing" in caplog.text


async def test_discovery_does_not_cache_a_refused_document(fake_provider):
    """A provider that fixes its document is accepted on the next sign-in without a restart"""
    _serve_discovery(fake_provider, token_endpoint="http://10.0.0.5/token")
    with pytest.raises(HTTPException):
        await get_provider_metadata(ISSUER)

    _serve_discovery(fake_provider)
    metadata = await get_provider_metadata(ISSUER)

    assert metadata["token_endpoint"] == f"{ISSUER}/token"
    assert fake_provider.request_counts["/.well-known/openid-configuration"] == 2


# --- Code exchange ---


async def test_exchange_rejection_is_unauthorized(fake_provider):
    """A provider that rejects the code fails the sign-in as unauthorized"""
    fake_provider.responses["/token"] = lambda: httpx.Response(400, json={"error": "invalid_grant"})

    with pytest.raises(HTTPException) as excinfo:
        await exchange_authorization_code(_metadata(), CLIENT_ID, "secret", code="bad", code_verifier="v", redirect_uri="https://app.test/cb")
    assert excinfo.value.status_code == 401


async def test_exchange_requires_id_token(fake_provider):
    """A token response without an ID token fails the sign-in"""
    fake_provider.responses["/token"] = lambda: httpx.Response(200, json={"access_token": "at"})

    with pytest.raises(HTTPException) as excinfo:
        await exchange_authorization_code(_metadata(), CLIENT_ID, "secret", code="c", code_verifier="v", redirect_uri="https://app.test/cb")
    assert excinfo.value.status_code == 401


# --- ID token verification ---


async def test_verify_id_token_accepts_valid_token(fake_provider):
    """A correctly signed token with matching claims returns its payload"""
    id_token = _make_id_token(email="user@example.com")

    claims = await verify_provider_id_token(id_token, _metadata(), CLIENT_ID, "nonce-1")

    assert claims["sub"] == "subject-1"
    assert claims["email"] == "user@example.com"


@pytest.mark.parametrize(
    "claim_overrides",
    [
        {"nonce": "other-nonce"},
        {"aud": "other-client"},
        {"iss": "https://evil.test"},
        {"exp": datetime.now(UTC) - timedelta(minutes=10)},
    ],
)
async def test_verify_id_token_rejects_bad_claims(fake_provider, claim_overrides):
    """A wrong nonce, audience, issuer, or expiry fails verification"""
    id_token = _make_id_token(**claim_overrides)

    with pytest.raises(HTTPException) as excinfo:
        await verify_provider_id_token(id_token, _metadata(), CLIENT_ID, "nonce-1")
    assert excinfo.value.status_code == 401


async def test_verify_id_token_rejects_symmetric_algorithm(fake_provider):
    """A token signed with a shared-secret algorithm is refused outright"""
    issued_at = datetime.now(UTC)
    claims = {
        "iss": ISSUER,
        "aud": CLIENT_ID,
        "sub": "subject-1",
        "iat": issued_at,
        "exp": issued_at + timedelta(minutes=5),
        "nonce": "nonce-1",
    }
    forged = jwt.encode(claims, "shared-secret", algorithm="HS256", headers={"kid": KEY_ID})

    with pytest.raises(HTTPException) as excinfo:
        await verify_provider_id_token(forged, _metadata(), CLIENT_ID, "nonce-1")
    assert excinfo.value.status_code == 401


async def test_verify_id_token_refetches_keys_on_unknown_kid(fake_provider):
    """A token naming a kid missing from the cached key set triggers one refetch"""
    # Prime the cache with a key set that does not contain the signing kid yet
    fake_provider.responses["/jwks"] = lambda: httpx.Response(200, json=_jwks_document(key_id="stale-key"))
    await oidc_client._get_jwk_set(f"{ISSUER}/jwks", force_refresh=False)

    # The provider then rotates to the real key, as the refetch should discover
    fake_provider.responses["/jwks"] = lambda: httpx.Response(200, json=_jwks_document())
    claims = await verify_provider_id_token(_make_id_token(), _metadata(), CLIENT_ID, "nonce-1")

    assert claims["sub"] == "subject-1"
    assert fake_provider.request_counts["/jwks"] == 2


async def test_verify_id_token_accepts_fresh_auth_time(fake_provider):
    """A reauth passes when the provider authenticated the user inside the freshness window"""
    auth_time = int(datetime.now(UTC).timestamp())
    id_token = _make_id_token(auth_time=auth_time)

    claims = await verify_provider_id_token(id_token, _metadata(), CLIENT_ID, "nonce-1", max_age=300)

    assert claims["auth_time"] == auth_time


async def test_verify_id_token_rejects_stale_auth_time(fake_provider):
    """A reauth fails when the provider reused a session older than the freshness window"""
    stale_auth_time = int((datetime.now(UTC) - timedelta(seconds=1000)).timestamp())
    id_token = _make_id_token(auth_time=stale_auth_time)

    with pytest.raises(HTTPException) as excinfo:
        await verify_provider_id_token(id_token, _metadata(), CLIENT_ID, "nonce-1", max_age=300)
    assert excinfo.value.status_code == 401


async def test_verify_id_token_requires_auth_time_when_max_age_set(fake_provider):
    """A reauth fails when the provider omits the auth_time a freshness window requires"""
    id_token = _make_id_token()

    with pytest.raises(HTTPException) as excinfo:
        await verify_provider_id_token(id_token, _metadata(), CLIENT_ID, "nonce-1", max_age=300)
    assert excinfo.value.status_code == 401


# --- Userinfo ---


async def test_userinfo_rejects_subject_mismatch(fake_provider):
    """A userinfo answer for a different subject is treated as a substitution and refused"""
    fake_provider.responses["/userinfo"] = lambda: httpx.Response(200, json={"sub": "someone-else", "email": "user@example.com"})

    with pytest.raises(HTTPException) as excinfo:
        await fetch_userinfo(_metadata(), "access-token", expected_subject="subject-1")
    assert excinfo.value.status_code == 401


async def test_userinfo_returns_claims_for_matching_subject(fake_provider):
    """A userinfo answer for the verified subject supplies its claims"""
    fake_provider.responses["/userinfo"] = lambda: httpx.Response(
        200, json={"sub": "subject-1", "email": "user@example.com", "email_verified": True}
    )

    claims = await fetch_userinfo(_metadata(), "access-token", expected_subject="subject-1")

    assert claims["email"] == "user@example.com"


# --- Replies of the wrong shape ---


@pytest.mark.parametrize(
    "answer",
    [
        lambda: httpx.Response(200, text="<html>Sign in</html>", headers={"content-type": "text/html"}),
        lambda: httpx.Response(200, json=["id_token"]),
    ],
    ids=["html page", "json list"],
)
async def test_exchange_refuses_a_token_reply_that_is_not_an_object(fake_provider, answer):
    """A token reply that isn't a JSON object fails the sign-in, not the server"""
    fake_provider.responses["/token"] = answer

    with pytest.raises(HTTPException) as excinfo:
        await exchange_authorization_code(_metadata(), CLIENT_ID, "secret", code="c", code_verifier="v", redirect_uri="https://app.test/cb")

    assert excinfo.value.status_code == 401
    assert excinfo.value.detail == "Single sign-on failed"


async def test_discovery_refuses_a_document_that_is_not_an_object(fake_provider):
    """A discovery document that is a JSON list leaves the provider unavailable"""
    fake_provider.responses["/.well-known/openid-configuration"] = lambda: httpx.Response(200, json=[_metadata()])

    with pytest.raises(HTTPException) as excinfo:
        await get_provider_metadata(ISSUER)

    assert excinfo.value.status_code == 502
    assert excinfo.value.detail == "Identity provider unavailable"


@pytest.mark.parametrize(
    "document",
    [
        {"keys": "none"},
        {"keys": ["x"]},
        [_jwks_document()],
        {"keys": [{**_jwks_document()["keys"][0], "alg": ["RS256"]}]},
        {"keys": [{**_jwks_document()["keys"][0], "alg": {"name": "RS256"}}]},
    ],
    ids=["keys not a list", "key not an object", "json list", "algorithm a list", "algorithm an object"],
)
async def test_verify_id_token_refuses_a_key_set_it_cannot_read(fake_provider, document):
    """A key set that isn't one leaves the provider unavailable rather than failing the server"""
    fake_provider.responses["/jwks"] = lambda: httpx.Response(200, json=document)

    with pytest.raises(HTTPException) as excinfo:
        await verify_provider_id_token(_make_id_token(), _metadata(), CLIENT_ID, "nonce-1")

    assert excinfo.value.status_code == 502
    assert excinfo.value.detail == "Identity provider unavailable"


async def test_userinfo_refuses_an_answer_that_is_not_an_object(fake_provider):
    """User info answered as a JSON list leaves the provider unavailable"""
    fake_provider.responses["/userinfo"] = lambda: httpx.Response(200, json=[{"sub": "subject-1"}])

    with pytest.raises(HTTPException) as excinfo:
        await fetch_userinfo(_metadata(), "access-token", expected_subject="subject-1")

    assert excinfo.value.status_code == 502
    assert excinfo.value.detail == "Identity provider unavailable"
