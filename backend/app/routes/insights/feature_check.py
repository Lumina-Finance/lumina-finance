"""The router-wide check that a user may use insights"""

from typing import Annotated

from fastapi import Depends

from app.allowance_hook import AllowanceKind
from app.dependencies import get_current_user
from app.models.user import User
from app.services.allowance.require import require_feature


async def require_insights(user: Annotated[User, Depends(get_current_user)]) -> None:
    """Refuse a user the allowance check does not let use insights, after authentication, so a missing sign-in is still 401

    Raises:
        HTTPException 403: The installed check refused, with its reason as the detail
    """
    await require_feature(user.id, AllowanceKind.INSIGHTS)
