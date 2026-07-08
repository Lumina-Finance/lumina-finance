"""OIDC protocol client for discovery, authorization, code exchange, and ID token verification"""

import base64
import hashlib
import secrets
import time
from typing import Any
from urllib.parse import quote, urlencode

import httpx
import jwt
from fastapi import HTTPException, status

_DISCOVERY_PATH = "/.well-known/openid-configuration"
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
    """Return a short-lived HTTP client with the shared timeout"""
    return httpx.AsyncClient(timeout=_HTTP_TIMEOUT_SECONDS)


async def _fetch_json(url: str) -> dict[str, Any]:
    """Return the JSON body at a provider URL

    Args:
        url: Provider document URL

    Returns:
        The parsed JSON document

    Raises:
        HTTPException: The provider could not be reached or answered without valid JSON
    """
    try:
        async with _http_client() as client:
            response = await client.get(url)
            response.raise_for_status()
            return response.json()
    except (httpx.HTTPError, ValueError) as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="Identity provider unavailable"
        ) from error


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

    for endpoint in ("authorization_endpoint", "token_endpoint", "jwks_uri"):
        if not metadata.get(endpoint):
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Identity provider unavailable")

    _metadata_cache[issuer] = (time.monotonic() + _HTTP_CACHE_TTL_SECONDS, metadata)
    return metadata


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

    Returns:
        The authorization endpoint URL with the code flow parameters applied
    """
    authorization_endpoint = metadata["authorization_endpoint"]
    query = urlencode(
        {
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "scope": scopes,
            "state": state,
            "nonce": nonce,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
    )

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
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="Identity provider unavailable"
        ) from error

    # A rejected exchange means the code was invalid, expired, or replayed, so the sign-in
    # fails as unauthorized rather than as a provider outage
    if response.status_code != status.HTTP_200_OK:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Single sign-on failed")

    token_response = response.json()
    if not token_response.get("id_token"):
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

    jwk_set = jwt.PyJWKSet.from_dict(await _fetch_json(jwks_uri))
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


async def verify_provider_id_token(
    id_token: str,
    metadata: dict[str, Any],
    client_id: str,
    expected_nonce: str,
) -> dict[str, Any]:
    """Verify an ID token's signature and claims and return its payload

    Args:
        id_token: Raw ID token from the token response
        metadata: Provider discovery document
        client_id: OAuth client identifier the token must be addressed to
        expected_nonce: Nonce stored when the roundtrip began

    Returns:
        The verified claims

    Raises:
        HTTPException: The signature, issuer, audience, expiry, or nonce does not verify
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

    try:
        claims = jwt.decode(
            id_token,
            key=signing_key.key,
            algorithms=_ALLOWED_ID_TOKEN_ALGORITHMS,
            audience=client_id,
            issuer=metadata["issuer"],
            leeway=_ID_TOKEN_LEEWAY_SECONDS,
            options={"require": ["exp", "iat", "iss", "aud", "sub"]},
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
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="Identity provider unavailable"
        ) from error

    # A userinfo answer for a different subject than the verified token is a token
    # substitution, so it must not enrich this sign-in
    if claims.get("sub") != expected_subject:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Single sign-on failed")
    return claims
