"""OIDC protocol client for discovery, authorization, code exchange, and ID token verification"""

import base64
import hashlib
import logging
import re
import secrets
import time
from typing import Any
from urllib.parse import quote, urlencode, urlparse

import httpx
import jwt
from fastapi import HTTPException, status

from app.config.oidc import OIDC_ENDPOINT_HOSTS_BY_ISSUER, OIDC_ENDPOINT_HOSTS_VARIABLE
from app.http_client import build_http_client

logger = logging.getLogger(__name__)

_DISCOVERY_PATH = "/.well-known/openid-configuration"

# Every discovered endpoint the client calls or sends the browser to. User info is the one a
# provider may leave out
_CHECKED_ENDPOINTS = ("authorization_endpoint", "token_endpoint", "jwks_uri", "userinfo_endpoint")
_OPTIONAL_ENDPOINT = "userinfo_endpoint"

_UNSAFE_URL_CHARACTERS = re.compile(r"[\\\s\x00-\x1f\x7f]")

# A refused endpoint is quoted in the log this far, enough to recognise without a provider filling the log
_LOGGED_VALUE_MAX_CHARS = 200
_HTTP_TIMEOUT_SECONDS = 10.0

# Discovery and key documents change rarely, so they are cached per issuer for this long
_HTTP_CACHE_TTL_SECONDS = 3600.0

# Only asymmetric signatures are accepted, so a symmetric algorithm can never trick the
# verifier into treating a public value as a shared secret
_ALLOWED_ID_TOKEN_ALGORITHMS = ["RS256", "PS256", "ES256"]

# Small tolerance for clock skew between this server and the provider when checking token times
_ID_TOKEN_LEEWAY_SECONDS = 30

_metadata_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_jwks_cache: dict[str, tuple[float, jwt.PyJWKSet]] = {}


def _http_client() -> httpx.AsyncClient:
    """Return a short-lived HTTP client with the shared timeout and response size cap"""
    return build_http_client(timeout=_HTTP_TIMEOUT_SECONDS)


async def _fetch_json(url: str) -> dict[str, Any]:
    """Return the JSON body at a provider URL

    Args:
        url: Provider document URL

    Returns:
        The parsed JSON object

    Raises:
        HTTPException: The provider could not be reached or answered without a JSON object
    """
    try:
        async with _http_client() as client:
            response = await client.get(url)
            response.raise_for_status()
            document = response.json()
    except (httpx.HTTPError, ValueError) as error:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Identity provider unavailable") from error

    # Discovery and key documents are always objects, so any other JSON is a provider fault
    if not isinstance(document, dict):
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Identity provider unavailable")
    return document


async def get_provider_metadata(issuer: str) -> dict[str, Any]:
    """Return the provider's discovery document, cached per issuer

    Args:
        issuer: Issuer URL the provider was configured with

    Returns:
        The discovery document

    Raises:
        HTTPException: The document cannot be fetched, misstates its issuer, or lacks endpoints
    """
    cached = _metadata_cache.get(issuer)
    if cached is not None and cached[0] > time.monotonic():
        return cached[1]

    # The discovery URL strips any trailing slash, but the document must echo the issuer
    # exactly as configured, including one
    metadata = await _fetch_json(f"{issuer.rstrip('/')}{_DISCOVERY_PATH}")

    # A document that names a different issuer than the URL it came from is misconfigured or
    # hostile, and every later issuer check would silently bind to the wrong identity
    if metadata.get("issuer") != issuer:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Identity provider unavailable")

    # The token endpoint receives the client secret, the code and the PKCE verifier, the user info
    # endpoint the access token, and the browser is sent to the authorization endpoint, so each must
    # be where the configured issuer is, or where the configuration says it may be. A refused
    # document is not cached, so a fixed provider is picked up on the next sign-in
    allowed_hosts = OIDC_ENDPOINT_HOSTS_BY_ISSUER.get(issuer, frozenset())
    for endpoint in _CHECKED_ENDPOINTS:
        value = metadata.get(endpoint)
        if not value:
            if endpoint == _OPTIONAL_ENDPOINT:
                continue
            logger.warning("Identity provider %r refused because its %s is missing", issuer, endpoint)
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Identity provider unavailable")
        problem = _find_endpoint_problem(issuer, value, allowed_hosts)
        if problem is not None:
            shown_value = repr(value)[:_LOGGED_VALUE_MAX_CHARS]
            logger.warning("Identity provider %r refused because its %s %s %s", issuer, endpoint, shown_value, problem)
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Identity provider unavailable")

    _metadata_cache[issuer] = (time.monotonic() + _HTTP_CACHE_TTL_SECONDS, metadata)
    return metadata


def _find_endpoint_problem(issuer: str, value: Any, allowed_hosts: frozenset[str]) -> str | None:
    """Return why a discovered endpoint can't be used, or None when it can

    Args:
        issuer: Issuer URL the provider was configured with
        value: Endpoint address from the discovery document
        allowed_hosts: Hosts besides the issuer's that the configuration allows

    Returns:
        The reason, worded to follow the endpoint's name and value in a log line
    """
    if not isinstance(value, str):
        return "is not text"

    # Browsers and urlparse read a backslash, whitespace or a control character differently, so
    # the host checked here could differ from the one a request or redirect reaches
    if _UNSAFE_URL_CHARACTERS.search(value):
        return "contains a backslash, whitespace or a control character"

    # Any user info part gives a user name, an empty one when the part holds only a password
    parsed = urlparse(value)
    if parsed.username is not None:
        return "carries a user name or password"

    # Configuration allows an http issuer only on loopback, for a local development provider, so
    # plain http is only accepted on that same host
    parsed_issuer = urlparse(issuer)
    if parsed.scheme == "http":
        if parsed_issuer.scheme != "http" or parsed.hostname != parsed_issuer.hostname:
            return "uses plain http"
    elif parsed.scheme != "https":
        return "is not an https address"

    host = parsed.hostname
    if not host:
        return "names no host"
    if host != parsed_issuer.hostname and host not in allowed_hosts:
        return f"is on a host that is neither the issuer's nor listed in {OIDC_ENDPOINT_HOSTS_VARIABLE}"
    return None


def generate_pkce_pair() -> tuple[str, str]:
    """Return a PKCE code verifier and its S256 challenge

    Returns:
        The verifier kept for the token exchange and the challenge sent with the redirect
    """
    # 64 random bytes encode to 86 characters, inside the 43 to 128 range RFC 7636 allows
    code_verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    code_challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return code_verifier, code_challenge


def build_authorization_url(
    metadata: dict[str, Any],
    client_id: str,
    scopes: str,
    redirect_uri: str,
    state: str,
    nonce: str,
    code_challenge: str,
    prompt: str | None = None,
    max_age: int | None = None,
) -> str:
    """Return the provider URL the browser is sent to for sign-in

    Args:
        metadata: Provider discovery document
        client_id: OAuth client identifier registered with the provider
        scopes: Space-separated scopes to request
        redirect_uri: Callback URL registered with the provider
        state: Random value binding the callback to this roundtrip
        nonce: Random value the ID token must echo
        code_challenge: PKCE challenge derived from the stored verifier
        prompt: Optional OpenID prompt, "login" asks the provider to reauthenticate rather than
            silently reusing an existing session
        max_age: Optional freshness window in seconds, requiring the provider to have authenticated
            the user within it and to return auth_time, which the reauth step-up then verifies

    Returns:
        The authorization endpoint URL with the code flow parameters applied
    """
    authorization_endpoint = metadata["authorization_endpoint"]
    parameters = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": scopes,
        "state": state,
        "nonce": nonce,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    if prompt is not None:
        parameters["prompt"] = prompt
    if max_age is not None:
        parameters["max_age"] = str(max_age)
    query = urlencode(parameters)

    # Some providers publish an authorization endpoint that already carries a query string
    separator = "&" if "?" in authorization_endpoint else "?"
    return f"{authorization_endpoint}{separator}{query}"


def _client_secret_basic_auth(client_id: str, client_secret: str) -> httpx.BasicAuth:
    """Return HTTP Basic credentials in the form encoding RFC 6749 requires

    The client id and secret must be form-urlencoded before they are base64 packed, which
    matters when a secret contains reserved characters
    """
    return httpx.BasicAuth(quote(client_id, safe=""), quote(client_secret, safe=""))


async def exchange_authorization_code(
    metadata: dict[str, Any],
    client_id: str,
    client_secret: str,
    code: str,
    code_verifier: str,
    redirect_uri: str,
) -> dict[str, Any]:
    """Exchange an authorization code for the provider's token response

    Args:
        metadata: Provider discovery document
        client_id: OAuth client identifier registered with the provider
        client_secret: Decrypted client secret authenticating this client
        code: Authorization code returned to the callback
        code_verifier: PKCE verifier stored when the roundtrip began
        redirect_uri: Callback URL the code was issued to

    Returns:
        The token response containing at least the ID token

    Raises:
        HTTPException: The provider rejected the code or could not be reached
    """
    try:
        async with _http_client() as client:
            response = await client.post(
                metadata["token_endpoint"],
                auth=_client_secret_basic_auth(client_id, client_secret),
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": redirect_uri,
                    "code_verifier": code_verifier,
                },
            )
    except httpx.HTTPError as error:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Identity provider unavailable") from error

    # A rejected exchange means the code was invalid, expired, or replayed, so the sign-in
    # fails as unauthorized rather than as a provider outage
    if response.status_code != status.HTTP_200_OK:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Single sign-on failed")

    # The code was spent on this answer, so one that isn't a JSON object fails the sign-in like a rejected code
    try:
        token_response = response.json()
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Single sign-on failed") from None
    if not isinstance(token_response, dict) or not token_response.get("id_token"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Single sign-on failed")
    return token_response


async def _get_jwk_set(jwks_uri: str, *, force_refresh: bool) -> jwt.PyJWKSet:
    """Return the provider's key set, cached per URI

    Args:
        jwks_uri: Provider JWKS document URL
        force_refresh: Whether to bypass the cache after a key id miss

    Returns:
        The provider's current key set
    """
    cached = _jwks_cache.get(jwks_uri)
    if not force_refresh and cached is not None and cached[0] > time.monotonic():
        return cached[1]

    # PyJWT looks a key's alg up as a dictionary key, so an alg that is a list or an object raises
    # TypeError rather than its own error
    try:
        jwk_set = jwt.PyJWKSet.from_dict(await _fetch_json(jwks_uri))
    except jwt.PyJWTError, TypeError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Identity provider unavailable") from None
    _jwks_cache[jwks_uri] = (time.monotonic() + _HTTP_CACHE_TTL_SECONDS, jwk_set)
    return jwk_set


def _select_signing_key(jwk_set: jwt.PyJWKSet, key_id: str | None) -> jwt.PyJWK | None:
    """Return the key an ID token names, or the only signing key when it names none

    Args:
        jwk_set: Provider key set
        key_id: Key id from the unverified token header

    Returns:
        The matching key when one can be chosen unambiguously
    """
    signing_keys = [key for key in jwk_set.keys if key.public_key_use in (None, "sig")]
    if key_id is not None:
        return next((key for key in signing_keys if key.key_id == key_id), None)

    # Without a kid the choice is only safe when exactly one signing key exists
    return signing_keys[0] if len(signing_keys) == 1 else None


def _is_authentication_fresh(auth_time: Any, max_age: int) -> bool:
    """Return whether the provider authenticated the user within the freshness window

    Args:
        auth_time: The auth_time claim from the verified token
        max_age: Freshness window in seconds the roundtrip requested

    Returns:
        Whether auth_time is a timestamp no older than the window plus the clock-skew leeway
    """
    if not isinstance(auth_time, (int, float)):
        return False
    return time.time() - auth_time <= max_age + _ID_TOKEN_LEEWAY_SECONDS


async def verify_provider_id_token(
    id_token: str,
    metadata: dict[str, Any],
    client_id: str,
    expected_nonce: str,
    max_age: int | None = None,
) -> dict[str, Any]:
    """Verify an ID token's signature and claims and return its payload

    Args:
        id_token: Raw ID token from the token response
        metadata: Provider discovery document
        client_id: OAuth client identifier the token must be addressed to
        expected_nonce: Nonce stored when the roundtrip began
        max_age: Optional freshness window in seconds, requiring the provider to have authenticated
            the user within it, proving a reauth is fresh rather than a reused session

    Returns:
        The verified claims

    Raises:
        HTTPException: The signature, issuer, audience, expiry, or nonce does not verify, or a
            requested freshness window is not met
    """
    try:
        key_id = jwt.get_unverified_header(id_token).get("kid")
    except jwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Single sign-on failed") from None

    jwk_set = await _get_jwk_set(metadata["jwks_uri"], force_refresh=False)
    signing_key = _select_signing_key(jwk_set, key_id)

    # An unknown kid usually means the provider rotated keys since the cache was filled,
    # so refetch once before treating the token as unverifiable
    if signing_key is None:
        jwk_set = await _get_jwk_set(metadata["jwks_uri"], force_refresh=True)
        signing_key = _select_signing_key(jwk_set, key_id)
    if signing_key is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Single sign-on failed")

    # A freshness window obliges a conformant provider to return auth_time, so require the claim
    # only when the caller asked for one
    required_claims = ["exp", "iat", "iss", "aud", "sub"]
    if max_age is not None:
        required_claims.append("auth_time")

    try:
        claims = jwt.decode(
            id_token,
            key=signing_key.key,
            algorithms=_ALLOWED_ID_TOKEN_ALGORITHMS,
            audience=client_id,
            issuer=metadata["issuer"],
            leeway=_ID_TOKEN_LEEWAY_SECONDS,
            options={"require": required_claims},
        )
    except jwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Single sign-on failed") from None

    # The nonce proves the token was minted for the roundtrip this server started, so a
    # token captured from another flow cannot complete this sign-in
    token_nonce = claims.get("nonce")
    if not isinstance(token_nonce, str) or not secrets.compare_digest(token_nonce, expected_nonce):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Single sign-on failed")

    # With multiple audiences the spec requires the authorized party to name this client,
    # so a token addressed to several clients cannot be replayed here by another of them
    audience = claims.get("aud")
    if isinstance(audience, list) and len(audience) > 1 and claims.get("azp") != client_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Single sign-on failed")

    # A reauth passes a freshness window, so the provider must have authenticated the user within it
    # rather than replaying an older session, which prompt=login alone cannot guarantee
    if max_age is not None and not _is_authentication_fresh(claims.get("auth_time"), max_age):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Single sign-on failed")

    return claims


async def fetch_userinfo(metadata: dict[str, Any], access_token: str, expected_subject: str) -> dict[str, Any]:
    """Return userinfo claims for providers that omit profile claims from the ID token

    Args:
        metadata: Provider discovery document
        access_token: Access token from the token response
        expected_subject: Subject the verified ID token named

    Returns:
        The userinfo claims, or nothing when the provider offers no userinfo endpoint

    Raises:
        HTTPException: The endpoint failed or answered for a different subject
    """
    userinfo_endpoint = metadata.get("userinfo_endpoint")
    if not userinfo_endpoint:
        return {}

    try:
        async with _http_client() as client:
            response = await client.get(userinfo_endpoint, headers={"Authorization": f"Bearer {access_token}"})
            response.raise_for_status()
            claims = response.json()
    except (httpx.HTTPError, ValueError) as error:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Identity provider unavailable") from error
    if not isinstance(claims, dict):
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Identity provider unavailable")

    # A userinfo answer for a different subject than the verified token is a token
    # substitution, so it must not enrich this sign-in
    if claims.get("sub") != expected_subject:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Single sign-on failed")
    return claims
