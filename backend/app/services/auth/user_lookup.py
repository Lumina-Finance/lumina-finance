"""Pre-identity user lookup"""

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User


async def find_user_by_email(db: AsyncSession, email: str) -> User | None:
    """Return the user with the given email, or None

    Args:
        db: Active database session
        email: Email address to look up

    Returns:
        The matching user when one exists
    """
    # Login and signup run before a request identity exists, so the lookup goes
    # through the SECURITY DEFINER helper that bypasses the self-only users policy
    query = select(User).from_statement(text("SELECT * FROM public.find_login_user(:email)"))
    result = await db.execute(query, {"email": email})
    return result.scalar_one_or_none()
