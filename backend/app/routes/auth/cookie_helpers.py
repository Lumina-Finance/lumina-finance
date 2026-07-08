"""Auth cookie route helpers"""

from fastapi import Request, Response

from app.config import JWT_REFRESH_TOKEN_EXPIRE_SECONDS, OIDC_AUTHORIZATION_REQUEST_EXPIRE_SECONDS
from app.request_security import request_is_https

_COOKIE_KEY = "refresh_token"
_COOKIE_PATH = "/"
_COOKIE_MAX_AGE = JWT_REFRESH_TOKEN_EXPIRE_SECONDS

# The login binding cookie only has to survive the redirect out to the provider and back, so it
# lives exactly as long as the roundtrip it guards
_OIDC_BINDING_COOKIE_KEY = "oidc_login_binding"
_OIDC_BINDING_COOKIE_PATH = "/"
_OIDC_BINDING_COOKIE_MAX_AGE = OIDC_AUTHORIZATION_REQUEST_EXPIRE_SECONDS


def set_refresh_cookie(request: Request, response: Response, token: str) -> None:
    """Set the refresh token as an httpOnly cookie on the response

    Args:
        request: FastAPI request object
        response: FastAPI response object
        token: Encoded refresh JWT string
    """
    response.set_cookie(
        key=_COOKIE_KEY,
        value=token,
        httponly=True,
        secure=request_is_https(request),
        samesite="lax",
        max_age=_COOKIE_MAX_AGE,
        path=_COOKIE_PATH,
    )


def clear_refresh_cookie(response: Response) -> None:
    """Remove the refresh token cookie from the response

    Args:
        response: FastAPI response object
    """
    response.delete_cookie(key=_COOKIE_KEY, path=_COOKIE_PATH)


OIDC_BINDING_COOKIE_KEY = _OIDC_BINDING_COOKIE_KEY


def set_oidc_login_binding_cookie(request: Request, response: Response, binding_token: str) -> None:
    """Set the login binding secret as an httpOnly cookie on the response

    The callback must present this secret back, so a login roundtrip only completes in the
    browser that started it, which is what the OAuth state parameter guards against

    Args:
        request: FastAPI request object
        response: FastAPI response object
        binding_token: Random secret whose hash is stored on the roundtrip
    """
    response.set_cookie(
        key=_OIDC_BINDING_COOKIE_KEY,
        value=binding_token,
        httponly=True,
        secure=request_is_https(request),
        samesite="lax",
        max_age=_OIDC_BINDING_COOKIE_MAX_AGE,
        path=_OIDC_BINDING_COOKIE_PATH,
    )


def clear_oidc_login_binding_cookie(response: Response) -> None:
    """Remove the login binding cookie from the response

    Args:
        response: FastAPI response object
    """
    response.delete_cookie(key=_OIDC_BINDING_COOKIE_KEY, path=_OIDC_BINDING_COOKIE_PATH)
