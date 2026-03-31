from typing import Annotated

import jwt
from cryptography.hazmat.primitives.serialization import load_pem_private_key
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import JWT_ACCESS_PRIVATE_KEY, JWT_ALGORITHM, JWT_ISSUER
from app.database import get_db
from app.models.user import User

# Derive the access public key from the private key for token verification
_private_key = load_pem_private_key(JWT_ACCESS_PRIVATE_KEY.encode(), password=None)
ACCESS_PUBLIC_KEY = _private_key.public_key()

_security = HTTPBearer()


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(_security)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """Extract and validate the access JWT, then return the authenticated user."""
    try:
        payload = jwt.decode(
            credentials.credentials,
            ACCESS_PUBLIC_KEY,
            algorithms=[JWT_ALGORITHM],
            issuer=JWT_ISSUER,
        )
    except jwt.PyJWTError:
        # from None suppresses exception chaining to keep logs clean and avoid leaking JWT internals
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token") from None

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    return user
