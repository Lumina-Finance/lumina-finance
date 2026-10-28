"""Auth cookie route helpers"""

from collections.abc import Callable, Iterator
from contextlib import contextmanager

from fastapi import HTTPException, Request, Response

from app.config.jwt import JWT_REFRESH_TOKEN_EXPIRE_SECONDS
from app.config.oidc import (
    OIDC_AUTHORIZATION_REQUEST_EXPIRE_SECONDS,
    OIDC_REAUTH_STEPUP_TOKEN_EXPIRE_SECONDS,
)

_COOKIE_KEY = "refresh_token"
_COOKIE_PATH = "/"
_COOKIE_MAX_AGE = JWT_REFRESH_TOKEN_EXPIRE_SECONDS

# The header the Apple apps send so their refresh token comes back in the body
NATIVE_CLIENT_HEADER = "x-lumina-client"
NATIVE_CLIENT_MARKER = "native"

# The login binding cookie only has to survive the redirect out to the provider and back, so it
# lives exactly as long as the roundtrip it guards
OIDC_BINDING_COOKIE_KEY = "oidc_login_binding"
_OIDC_BINDING_COOKIE_PATH = "/"
_OIDC_BINDING_COOKIE_MAX_AGE = OIDC_AUTHORIZATION_REQUEST_EXPIRE_SECONDS

# The reauth step-up proof is held in an httpOnly cookie so script cannot read it, and it lives
# exactly as long as the token it carries
OIDC_REAUTH_STEPUP_COOKIE_KEY = "oidc_reauth_stepup"
_OIDC_REAUTH_STEPUP_COOKIE_PATH = "/"
_OIDC_REAUTH_STEPUP_COOKIE_MAX_AGE = OIDC_REAUTH_STEPUP_TOKEN_EXPIRE_SECONDS


def request_is_https(request: Request) -> bool:
    """Return whether the original client request used HTTPS

    The proxy header is what the deployed app sees, since it terminates TLS in front of
    the application and forwards over plain HTTP
    """
    forwarded_proto = request.headers.get("x-forwarded-proto")
    if forwarded_proto:
        return forwarded_proto.split(",", 1)[0].strip().lower() == "https"
    return request.url.scheme == "https"


def request_is_native_client(request: Request) -> bool:
    """Return whether the request comes from a native app, which takes its refresh token in the body

    A browser adds an Origin header to every fetch POST and page script cannot remove it, so a
    request that carries one is answered with the httpOnly cookie whatever else it claims. That keeps
    the refresh token out of reach of any script running in a web page
    """
    is_marked_native = request.headers.get(NATIVE_CLIENT_HEADER) == NATIVE_CLIENT_MARKER
    return is_marked_native and "origin" not in request.headers


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
        key=OIDC_BINDING_COOKIE_KEY,
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
    response.delete_cookie(key=OIDC_BINDING_COOKIE_KEY, path=_OIDC_BINDING_COOKIE_PATH)


def set_oidc_reauth_stepup_cookie(request: Request, response: Response, stepup_token: str) -> None:
    """Set the reauth step-up proof as an httpOnly cookie on the response

    A sensitive request must present this proof back, so a passwordless account can only set a
    password or manage providers right after a fresh provider reauth rather than from a live session
    alone

    Args:
        request: FastAPI request object
        response: FastAPI response object
        stepup_token: Signed step-up token minted after the reauth
    """
    response.set_cookie(
        key=OIDC_REAUTH_STEPUP_COOKIE_KEY,
        value=stepup_token,
        httponly=True,
        secure=request_is_https(request),
        samesite="lax",
        max_age=_OIDC_REAUTH_STEPUP_COOKIE_MAX_AGE,
        path=_OIDC_REAUTH_STEPUP_COOKIE_PATH,
    )


def clear_oidc_reauth_stepup_cookie(response: Response) -> None:
    """Remove the set-password authorization cookie from the response

    Args:
        response: FastAPI response object
    """
    response.delete_cookie(key=OIDC_REAUTH_STEPUP_COOKIE_KEY, path=_OIDC_REAUTH_STEPUP_COOKIE_PATH)


def build_cookie_removal_header(clear_cookie: Callable[[Response], None]) -> str:
    """Return the Set-Cookie header value a clear helper writes, for a response built elsewhere

    An error raised from a route is answered with a response of its own, so a cookie cleared on the
    route's response never reaches the browser. The header has to travel on the exception instead

    Args:
        clear_cookie: One of the clear helpers in this module

    Returns:
        The Set-Cookie value that removes that cookie
    """
    scratch = Response()
    clear_cookie(scratch)
    return scratch.headers["set-cookie"]


@contextmanager
def removing_cookie_on_failure(clear_cookie: Callable[[Response], None]) -> Iterator[None]:
    """Make any HTTP error raised inside the block also remove a cookie

    The error keeps its status, detail and other headers, so callers see the same refusal as before

    Args:
        clear_cookie: One of the clear helpers in this module

    Raises:
        HTTPException: Whatever the block raised, now carrying the cookie's removal
    """
    try:
        yield
    except HTTPException as exc:
        exc.headers = {**(exc.headers or {}), "set-cookie": build_cookie_removal_header(clear_cookie)}
        raise
