"""OpenID discovery document for the access-token issuer"""

from urllib.parse import urlsplit

from fastapi import HTTPException, status

from app.config.jwt import JWT_ALGORITHM, JWT_ISSUER

# The key set is served under /auth. An issuer ending there puts the document and the keys under the issuer's
# path, where a verifier looks once it drops a trailing slash and adds the well-known path, as the OpenID
# Connect Discovery standard says. A verifier that adds the path without dropping the slash asks for a
# doubled slash and finds nothing there, so only an issuer without one reaches the document either way
ISSUER_PATH_SUFFIXES = ("/auth", "/auth/")

JWKS_PATH = "/.well-known/jwks.json"

# A query, a fragment or user info would put a wrong key set address, or credentials, in a document anyone can read
REFUSED_ISSUER_CHARACTERS = frozenset("?#@")


def build_discovery_document(issuer: str) -> dict[str, str | list[str]] | None:
    """Return the discovery document a token verifier reads, or None when the issuer cannot carry one

    A verifier requests the issuer followed by /.well-known/openid-configuration and requires a token's iss
    claim to equal the document's issuer character for character, so the issuer is returned exactly as
    configured, trailing slash included

    The app is no OpenID provider and issues no ID tokens, so this is not a full provider document. A verifier
    reads only the issuer and the key set address. RS256 is named under the field the standard gives the
    signing algorithm. The fields the standard requires of a provider, such as the authorization endpoint,
    are left out, since the app serves none and naming routes would map the API

    Args:
        issuer: The configured token issuer

    Returns:
        The document, or None when the issuer is not an https URL whose path ends in /auth, where no
        verifier would look for one
    """
    parts = urlsplit(issuer)
    is_discoverable = (
        parts.scheme == "https"
        and parts.hostname is not None
        and parts.path.endswith(ISSUER_PATH_SUFFIXES)
        and REFUSED_ISSUER_CHARACTERS.isdisjoint(issuer)
    )
    if not is_discoverable:
        return None
    return {
        "issuer": issuer,
        "jwks_uri": issuer.removesuffix("/") + JWKS_PATH,
        "id_token_signing_alg_values_supported": [JWT_ALGORITHM],
    }


def read_discovery_document() -> dict[str, str | list[str]]:
    """Return the discovery document for the configured issuer

    Returns:
        The document

    Raises:
        HTTPException 404: The configured issuer is not an address a verifier would look up, so the app
            publishes nothing for it
    """
    document = build_discovery_document(JWT_ISSUER)
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Discovery document not found")
    return document
