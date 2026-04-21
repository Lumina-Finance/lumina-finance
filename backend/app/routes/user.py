import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.currency import Currency
from app.models.user import User, UserRunwayAccount
from app.schemas.user import RunwayAccountsRequest, UpdateProfileRequest, UserProfile
from app.services.dashboard import get_accessible_accounts

router = APIRouter(prefix="/me", tags=["me"])


@router.get("", response_model=UserProfile)
async def get_me(
    user: Annotated[User, Depends(get_current_user)],
):
    """Return the authenticated user's full profile."""
    return UserProfile.model_validate(user)


@router.patch("", response_model=UserProfile)
async def update_me(
    data: UpdateProfileRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update the authenticated user's profile. Only provided fields are changed."""
    updates = data.model_dump(exclude_unset=True)
    if not updates:
        return UserProfile.model_validate(user)

    # Non-nullable fields cannot be explicitly set to null
    _non_nullable = {"first_name", "tz", "base_currency"}
    null_fields = [f for f in _non_nullable if f in updates and updates[f] is None]
    if null_fields:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Cannot set to null: {', '.join(sorted(null_fields))}",
        )

    # Validate currency exists if being changed
    if "base_currency" in updates:
        result = await db.execute(select(Currency).where(Currency.id == updates["base_currency"]))
        if not result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid currency code")

    for field, value in updates.items():
        setattr(user, field, value)

    await db.commit()
    return UserProfile.model_validate(user)


@router.get("/runway-accounts", response_model=list[uuid.UUID])
async def list_runway_accounts(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return the account IDs the user has picked to feed the runway calculation.

    Filters out any stored selections the user can no longer read (e.g., a
    household account they've lost permission to) so the response only
    surfaces currently valid IDs.
    """
    accessible_ids = {a.id for a in await get_accessible_accounts(db, user)}
    stored = await db.execute(
        select(UserRunwayAccount.account_id).where(UserRunwayAccount.user_id == user.id),
    )
    return [aid for aid in stored.scalars().all() if aid in accessible_ids]


@router.put("/runway-accounts", response_model=list[uuid.UUID])
async def replace_runway_accounts(
    data: RunwayAccountsRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Replace the user's runway account selection with the submitted set.

    Dedupes silently. Rejects the whole request with 422 if any submitted
    account isn't readable by the user (personal, household admin, or explicit
    permission).
    """
    requested_ids = set(data.account_ids)

    if requested_ids:
        accessible_ids = {a.id for a in await get_accessible_accounts(db, user)}
        invalid = requested_ids - accessible_ids
        if invalid:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Inaccessible accounts: {sorted(str(x) for x in invalid)}",
            )

    # Replace the full set in a single transaction — simpler than diffing and
    # the runway selection is expected to be small (a handful of accounts).
    await db.execute(delete(UserRunwayAccount).where(UserRunwayAccount.user_id == user.id))
    for account_id in requested_ids:
        db.add(UserRunwayAccount(user_id=user.id, account_id=account_id))
    await db.commit()

    return sorted(requested_ids)
