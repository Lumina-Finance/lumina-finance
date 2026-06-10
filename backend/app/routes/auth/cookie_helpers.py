"""Auth cookie route helpers"""

from fastapi import Request, Response

from app.config import JWT_REFRESH_TOKEN_EXPIRE_SECONDS
from app.request_security import request_is_https

_COOKIE_KEY = "refresh_token"
_COOKIE_PATH = "/"
_COOKIE_MAX_AGE = JWT_REFRESH_TOKEN_EXPIRE_SECONDS


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
