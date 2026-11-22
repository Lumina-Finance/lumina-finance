"""Auth JWKS route helpers"""

from typing import Any

from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey
from jwt.algorithms import RSAAlgorithm

from app.config.jwt import JWT_ALGORITHM, JWT_REFRESH_KID, JWT_REFRESH_PUBLIC_KEY
from app.services.auth.tokens import access_public_keys


def build_jwks_response() -> dict[str, list[dict[str, Any]]]:
    """Return the public JWT signing keys in JWKS format

    Returns:
        JWKS document containing each access public key and the refresh public key
    """
    published = [*access_public_keys(), (JWT_REFRESH_KID, JWT_REFRESH_PUBLIC_KEY)]
    jwks_response = {"keys": [_to_jwk(kid, public_key) for kid, public_key in published]}
    return jwks_response


def _to_jwk(kid: str, public_key: RSAPublicKey) -> dict[str, Any]:
    """Return one public key as a JWK tagged with its ID"""
    jwk = RSAAlgorithm.to_jwk(public_key, as_dict=True)
    jwk["use"] = "sig"
    jwk["kid"] = kid
    jwk["alg"] = JWT_ALGORITHM
    return jwk
