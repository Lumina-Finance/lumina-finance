"""Updating the signed-in user's profile"""

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.allowance_hook import AllowanceKind
from app.models.currency import Currency
from app.models.user import User
from app.schemas.user import UpdateProfileRequest, UserProfile
from app.services.allowance.require import require_feature
from app.services.cache_state import mark_user_cache_changed
from app.services.users.profile import build_user_profile

# Fields a request may leave out but never set to null
NON_NULLABLE_FIELDS = {"first_name", "tz", "base_currency", "date_format"}


async def update_user_profile(db: AsyncSession, user: User, data: UpdateProfileRequest) -> UserProfile:
    """Change the fields a request sets on a user's profile and return the profile

    Args:
        db: Active database session
        user: The signed-in user
        data: The fields to change

    Raises:
        HTTPException: 422 when a field that cannot be empty is set to null or the main currency
            does not exist, or 403 when the installed allowance check refuses a change of main
            currency, with its reason as the detail. Nothing is changed then
    """
    updates = data.model_dump(exclude_unset=True)
    if not updates:
        return await build_user_profile(user)

    null_fields = [field for field in NON_NULLABLE_FIELDS if field in updates and updates[field] is None]
    if null_fields:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Cannot set to null: {', '.join(sorted(null_fields))}",
        )

    if "base_currency" in updates:
        # Fetch the target currency so users cannot save an unsupported base currency
        result = await db.execute(select(Currency).where(Currency.id == updates["base_currency"]))
        if not result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid currency code")

        # Asked once the change is valid and before anything is saved, and only for a different currency
        if updates["base_currency"] != user.base_currency:
            await require_feature(user.id, AllowanceKind.MAIN_CURRENCY_CHANGE)

    for field, value in updates.items():
        setattr(user, field, value)

    await mark_user_cache_changed(db, user.id)
    await db.commit()
    return await build_user_profile(user)
