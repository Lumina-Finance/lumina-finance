"""Auth JWKS route helpers"""
from typing import Any

from jwt.algorithms import RSAAlgorithm

from app.config import JWT_ACCESS_KID, JWT_ALGORITHM, JWT_REFRESH_KID
from app.routes.auth.token_helpers import get_access_public_key, get_refresh_public_key


def build_jwks_response() -> dict[str, list[dict[str, Any]]]:
    """Return the public JWT signing keys in JWKS format

    Returns:
        JWKS document containing access and refresh public keys
    """
    access_jwk = RSAAlgorithm.to_jwk(get_access_public_key(), as_dict=True)
    access_jwk["use"] = "sig"
    access_jwk["kid"] = JWT_ACCESS_KID
    access_jwk["alg"] = JWT_ALGORITHM

    refresh_jwk = RSAAlgorithm.to_jwk(get_refresh_public_key(), as_dict=True)
    refresh_jwk["use"] = "sig"
    refresh_jwk["kid"] = JWT_REFRESH_KID
    refresh_jwk["alg"] = JWT_ALGORITHM

    jwks_response = {"keys": [access_jwk, refresh_jwk]}
    return jwks_response
