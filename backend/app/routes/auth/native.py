"""Native app sign-in handoff routes

Passkeys and identity providers can't sign in natively on a self-hosted server, since the app can't
declare that server's domain in advance. The app instead opens the server's own sign-in page in a
private system browser sheet, and once that sign-in finishes the page hands its session to the app
"""

import re
import uuid
from typing import Annotated, NoReturn
from urllib.parse import parse_qs, urlencode

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import current_user_id_ctx, get_db
from app.dependencies import get_authenticated_user, get_current_session_id
from app.routes.auth.token_helpers import decode_native_handoff_token, issue_and_store_tokens
from app.schemas.auth import AuthResponse, NativeExchangeRequest
from app.services.auth.native_handoff import issue_native_handoff_code, redeem_native_handoff_code

# Where the system sheet hands control back to the app
_APP_CALLBACK_URL = "luminafinance://auth/callback"

# A base64url SHA-256 digest without padding, the only PKCE method the app uses
_CODE_CHALLENGE_PATTERN = re.compile(r"^[A-Za-z0-9_-]{43}$")

router = APIRouter(prefix="/native", tags=["auth"])


@router.post("/handoff", status_code=status.HTTP_303_SEE_OTHER, include_in_schema=False)
async def native_handoff_route(request: Request, db: Annotated[AsyncSession, Depends(get_db)]):
    """Hand the web page's fresh session to the app that opened it, as a redirect into the app

    The page submits a top-level form here rather than calling it with fetch, and the code only ever
    travels in the redirect's Location header, which page script can't read. So script running in
    the page, injected script included, can never obtain a code for a session of its own

    Args:
        request: The form submission, carrying the page's access token and the app's challenge
        db: Active database session

    Returns:
        A redirect into the app, carrying the code or an error the app shows
    """
    fields = _read_form_fields(await request.body())
    access_token = fields.get("access_token")
    code_challenge = fields.get("code_challenge")
    if not access_token or not code_challenge or not _CODE_CHALLENGE_PATTERN.fullmatch(code_challenge):
        return _redirect_to_app(error="handoff_failed")

    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=access_token)
    try:
        user = await get_authenticated_user(credentials, db)
    except HTTPException:
        return _redirect_to_app(error="handoff_failed")
    session_id = get_current_session_id()
    if session_id is None:
        return _redirect_to_app(error="handoff_failed")

    code = await issue_native_handoff_code(db, user.id, session_id, code_challenge)
    if code is None:
        return _redirect_to_app(error="handoff_failed")
    return _redirect_to_app(code=code)


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
    except (jwt.PyJWTError, KeyError, ValueError):
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
