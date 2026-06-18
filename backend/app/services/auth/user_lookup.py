"""Pre-identity user lookup"""

import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.rls.functions import FIND_LOGIN_USER


async def find_user_id_by_email(db: AsyncSession, email: str) -> uuid.UUID | None:
    """Return the id of the user with the given email, or None

    Args:
        db: Active database session
        email: Email address to look up

    Returns:
        The matching user id when one exists
    """
    # Login and signup run before a request identity exists, so the lookup goes through
    # the SECURITY DEFINER helper that bypasses the self-only users policy, returning
    # only the id so nothing else about the user can leak through it
    return await db.scalar(text(f"SELECT {FIND_LOGIN_USER}(:email)"), {"email": email})
