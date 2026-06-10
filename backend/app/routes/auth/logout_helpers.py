"""Auth logout route helpers"""

import uuid

import jwt
from fastapi import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.routes.auth.cookie_helpers import clear_refresh_cookie
from app.routes.auth.token_helpers import decode_access_token, delete_session_tokens


async def logout_auth_session(
    db: AsyncSession,
    response: Response,
    access_token: str,
) -> dict[str, str]:
    """Revoke every active token for an auth session

    Invalid bearer tokens are ignored because logout is best-effort and still
    clears the refresh cookie

    Args:
        db: Active database session
        response: FastAPI response object
        access_token: Bearer token from the Authorization header

    Returns:
        Logout confirmation
    """
    try:
        access_payload = decode_access_token(access_token)
        session_id = access_payload.get("sid")
        if session_id:
            await delete_session_tokens(db, uuid.UUID(session_id))
    except jwt.PyJWTError:
        pass

    await db.commit()
    clear_refresh_cookie(response)
    logout_response = {"detail": "Logged out"}
    return logout_response
