"""Building the profile the app serves for a user"""

from app.models.user import User
from app.schemas.user import UserProfile
from app.services.allowance.currency import find_foreign_currencies_reason


async def build_user_profile(user: User) -> UserProfile:
    """Return a user's profile, with the sentence the installed allowance check gave when it refuses records in another currency

    Args:
        user: The signed-in user
    """
    profile = UserProfile.model_validate(user)
    profile.foreign_currencies_refusal = await find_foreign_currencies_reason(user.id)
    return profile
