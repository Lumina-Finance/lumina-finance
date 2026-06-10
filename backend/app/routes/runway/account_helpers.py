"""Runway account route helpers"""
import uuid

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.user import User, UserRunwayAccount
from app.schemas.user import RunwayThresholds
from app.services.accounts.access import get_accessible_accounts


def get_runway_thresholds_from_user(user: User) -> RunwayThresholds:
    """Return runway status thresholds from a user profile

    Args:
        user: Authenticated user

    Returns:
        Runway status threshold response
    """
    thresholds = RunwayThresholds(
        risky_below_months=user.runway_risky_below_months,
        healthy_at_months=user.runway_healthy_at_months,
    )
    return thresholds


async def get_readable_non_archived_accounts_for_runway(
    db: AsyncSession,
    user: User,
) -> list[Account]:
    """Return readable non-archived accounts for runway calculations

    Args:
        db: Active database session
        user: Authenticated user

    Returns:
        Readable non-archived accounts
    """
    readable_accounts = await get_accessible_accounts(db, user, include_archived=True)
    non_archived_accounts = [account for account in readable_accounts if not account.is_archived]
    return non_archived_accounts


async def get_runway_account_ids_by_archive_state(
    db: AsyncSession,
    user: User,
) -> tuple[list[uuid.UUID], list[uuid.UUID]]:
    """Return selected runway account IDs split by archive state

    Args:
        db: Active database session
        user: Authenticated user

    Returns:
        Active and archived runway account IDs
    """
    readable_accounts = await get_accessible_accounts(db, user, include_archived=True)
    active_ids = {account.id for account in readable_accounts if not account.is_archived}
    archived_ids = {account.id for account in readable_accounts if account.is_archived}

    # Fetch the user's saved runway account selections before filtering by current account state
    selected_account_result = await db.execute(
        select(UserRunwayAccount.account_id).where(UserRunwayAccount.user_id == user.id),
    )

    active: list[uuid.UUID] = []
    archived: list[uuid.UUID] = []
    for account_id in selected_account_result.scalars().all():
        if account_id in active_ids:
            active.append(account_id)
        elif account_id in archived_ids:
            archived.append(account_id)

    return active, archived


async def get_active_runway_account_ids(
    db: AsyncSession,
    user: User,
) -> list[uuid.UUID]:
    """Return active selected runway account IDs

    Args:
        db: Active database session
        user: Authenticated user

    Returns:
        Active runway account IDs
    """
    active_ids, _archived_ids = await get_runway_account_ids_by_archive_state(db, user)
    return active_ids


async def replace_runway_account_ids(
    db: AsyncSession,
    user: User,
    account_ids: list[uuid.UUID],
) -> list[uuid.UUID]:
    """Replace active selected runway account IDs for a user

    Args:
        db: Active database session
        user: Authenticated user
        account_ids: Requested active runway account IDs

    Returns:
        Saved active runway account IDs in sorted order

    Raises:
        HTTPException: Requested account IDs include unreadable or archived accounts
    """
    requested_ids = set(account_ids)
    readable_accounts = await get_accessible_accounts(db, user, include_archived=True)
    active_ids = {account.id for account in readable_accounts if not account.is_archived}
    archived_ids = {account.id for account in readable_accounts if account.is_archived}

    invalid_ids = requested_ids - active_ids
    if invalid_ids:
        invalid_id_list = sorted(str(account_id) for account_id in invalid_ids)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Inaccessible accounts: {invalid_id_list}",
        )

    delete_query = delete(UserRunwayAccount).where(UserRunwayAccount.user_id == user.id)
    if archived_ids:
        delete_query = delete_query.where(UserRunwayAccount.account_id.not_in(archived_ids))

    # Delete active selections while preserving archived selections that may become active again later
    await db.execute(delete_query)

    for account_id in requested_ids:
        db.add(UserRunwayAccount(user_id=user.id, account_id=account_id))

    sorted_account_ids = sorted(requested_ids)
    return sorted_account_ids
