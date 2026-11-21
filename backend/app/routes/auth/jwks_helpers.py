"""Auth JWKS route helpers"""

from typing import Any

from jwt.algorithms import RSAAlgorithm

from app.config.jwt import JWT_ACCESS_KID, JWT_ACCESS_PUBLIC_KEY, JWT_ALGORITHM, JWT_REFRESH_KID, JWT_REFRESH_PUBLIC_KEY


def build_jwks_response() -> dict[str, list[dict[str, Any]]]:
    """Return the public JWT signing keys in JWKS format

    Returns:
        JWKS document containing access and refresh public keys
    """
    access_jwk = RSAAlgorithm.to_jwk(JWT_ACCESS_PUBLIC_KEY, as_dict=True)
    access_jwk["use"] = "sig"
    access_jwk["kid"] = JWT_ACCESS_KID
    access_jwk["alg"] = JWT_ALGORITHM

    refresh_jwk = RSAAlgorithm.to_jwk(JWT_REFRESH_PUBLIC_KEY, as_dict=True)
    refresh_jwk["use"] = "sig"
    refresh_jwk["kid"] = JWT_REFRESH_KID
    refresh_jwk["alg"] = JWT_ALGORITHM

    jwks_response = {"keys": [access_jwk, refresh_jwk]}
    return jwks_response
