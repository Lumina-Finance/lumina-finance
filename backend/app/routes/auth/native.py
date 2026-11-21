"""Native app sign-in handoff routes

Passkeys and identity providers can't sign in natively, since the app can't declare the server's
domain in advance. The app instead opens the server's own sign-in page in a
private system browser sheet, and once that sign-in finishes the page hands its session to the app
"""

import re
import uuid
from typing import Annotated, NoReturn
from urllib.parse import parse_qs, urlencode

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from fastapi.routing import APIRoute
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.database import current_session_id_ctx, current_user_id_ctx, get_db
from app.dependencies import get_authenticated_user
from app.models.user import User
from app.routes.auth.cookie_helpers import read_refresh_cookie
from app.routes.auth.token_helpers import (
    decode_native_handoff_token,
    get_refresh_token_session_id,
    issue_and_store_tokens,
)
from app.schemas.auth import AuthResponse, NativeExchangeRequest
from app.services.auth.native_handoff import issue_native_handoff_code, redeem_native_handoff_code

# Where the system sheet hands control back to the app
_APP_CALLBACK_URL = "luminafinance://auth/callback"

# A base64url SHA-256 digest without padding, the only PKCE method the app uses
_CODE_CHALLENGE_PATTERN = re.compile(r"^[A-Za-z0-9_-]{43}$")

router = APIRouter(prefix="/native", tags=["auth"])


class _HandoffRoute(APIRoute):
    """A route whose sign-in check runs through the app's signed-in-user dependency, as any other route's does

    The page's access token arrives in a form field, since a top-level form post can't set a header.
    This presents it to the dependency as the bearer header it reads, so a replacement installed
    through dependency_overrides sees this route's sign-in check too. A refused check ends the
    system sheet in the app, as every other refusal on this route does
    """

    def get_route_handler(self):
        """Wrap the route's handler to present the form's token as a header and to turn a refusal into the redirect"""
        handle = super().get_route_handler()

        async def handle_form_post(request: Request):
            """Run the handler with the token as the bearer header, then put the request's own headers back"""
            access_token = _read_form_fields(await request.body()).get("access_token")
            own_headers = request.scope["headers"]
            # Any header the post carries is dropped, since the form's token is the only one this route reads.
            # ASGI gives header names in lowercase
            headers = [(name, value) for name, value in own_headers if name != b"authorization"]
            if access_token:
                headers.append((b"authorization", f"Bearer {access_token}".encode()))
            request.scope["headers"] = headers
            try:
                return await handle(request)
            except StarletteHTTPException:
                return _redirect_to_app(error="handoff_failed")
            finally:
                # The scope is the one request observers read once the request ends, and it never held a token
                request.scope["headers"] = own_headers

        return handle_form_post


async def native_handoff_route(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_authenticated_user)],
):
    """Hand the web page's fresh session to the app that opened it, as a redirect into the app

    The page submits a top-level form here rather than calling it with fetch, and the code only ever
    travels in the redirect's Location header, which page script can't read. So script running in
    the page, injected script included, can never obtain a code for a session of its own

    Args:
        request: The form submission, carrying the page's access token and the app's challenge
        db: Active database session
        user: The user the access token belongs to, from the signed-in-user dependency

    Returns:
        A redirect into the app, carrying the code or an error the app shows
    """
    code_challenge = _read_form_fields(await request.body()).get("code_challenge")
    if not code_challenge or not _CODE_CHALLENGE_PATTERN.fullmatch(code_challenge):
        return _redirect_to_app(error="handoff_failed")

    session_id = current_session_id_ctx.get()
    if session_id is None or not await _holds_session_cookie(request, db, session_id):
        return _redirect_to_app(error="handoff_failed")

    code = await issue_native_handoff_code(db, user.id, session_id, code_challenge)
    if code is None:
        return _redirect_to_app(error="handoff_failed")
    return _redirect_to_app(code=code)


router.add_api_route(
    "/handoff",
    native_handoff_route,
    methods=["POST"],
    status_code=status.HTTP_303_SEE_OTHER,
    include_in_schema=False,
    route_class_override=_HandoffRoute,
)


@router.post("/exchange", response_model=AuthResponse)
async def native_exchange_route(
    payload: NativeExchangeRequest,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Swap a handed-off code for a native session, ending the web session it came from

    Args:
        payload: The code and the PKCE verifier only the app that asked for it holds
        request: FastAPI request object
        response: FastAPI response object
        db: Active database session

    Returns:
        Auth response with both tokens in the body

    Raises:
        HTTPException 401: The code is invalid, expired, spent, or its web session has ended
    """
    try:
        claims = decode_native_handoff_token(payload.code)
        user_id = uuid.UUID(str(claims["sub"]))
        session_id = uuid.UUID(str(claims["sid"]))
        jti = uuid.UUID(str(claims["jti"]))
        code_challenge = str(claims["code_challenge"])
    except jwt.PyJWTError, KeyError, ValueError:
        _raise_invalid_handoff()

    current_user_id_ctx.set(user_id)
    user = await redeem_native_handoff_code(
        db,
        user_id=user_id,
        session_id=session_id,
        jti=jti,
        code_challenge=code_challenge,
        code_verifier=payload.code_verifier,
    )
    if user is None:
        _raise_invalid_handoff()

    auth_response = await issue_and_store_tokens(db, request, response, user, refresh_in_body=True)
    return auth_response


async def _holds_session_cookie(request: Request, db: AsyncSession, session_id: uuid.UUID) -> bool:
    """Return whether the browser sent the active refresh cookie of the very session the access token belongs to

    The page's access token sits where page script can read it, but the httpOnly refresh cookie never
    does, and the browser sends it with this same-site form post. Asking for both means a token taken
    from the page cannot be handed off from anywhere else

    Args:
        request: The form submission
        db: Active database session
        session_id: The session the access token belongs to

    Returns:
        Whether the cookie is an active refresh token of that session
    """
    cookie = read_refresh_cookie(request)
    return bool(cookie) and await get_refresh_token_session_id(db, cookie) == session_id


def _read_form_fields(body: bytes) -> dict[str, str]:
    """Return the single-valued fields of a urlencoded form, or none when it isn't one"""
    try:
        parsed = parse_qs(body.decode("utf-8"), max_num_fields=4, strict_parsing=True)
    except ValueError:
        return {}
    return {name: values[0] for name, values in parsed.items() if len(values) == 1}


def _redirect_to_app(**query: str) -> RedirectResponse:
    """Return the redirect that closes the system sheet and hands its query to the app"""
    return RedirectResponse(f"{_APP_CALLBACK_URL}?{urlencode(query)}", status_code=status.HTTP_303_SEE_OTHER)


def _raise_invalid_handoff() -> NoReturn:
    """Refuse an exchange the same way whatever went wrong, so a failure reveals nothing"""
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired handoff") from None
