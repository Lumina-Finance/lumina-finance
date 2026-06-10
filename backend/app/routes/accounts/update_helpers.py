"""Account update helpers"""
import uuid
from collections.abc import Mapping
from datetime import date
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import PermissionLevel
from app.models.user import User
from app.permissions import check_account_access
from app.routes.accounts.balance_adjustment_helpers import zero_account_balance_for_archive
from app.routes.accounts.balance_field_helpers import attach_account_balance_fields
from app.routes.accounts.request_validation_helpers import validate_update_account_request
from app.routes.accounts.response_loading_helpers import get_account_for_response
from app.routes.accounts.tax_advantaged_category_link_helpers import validate_update_account_tax_advantaged_category_link
from app.schemas.account import UpdateAccountRequest
from app.services.cache_state import mark_cache_changed_for_scope


async def update_account_for_user(
    db: AsyncSession,
    account_id: uuid.UUID,
    data: UpdateAccountRequest,
    user: User,
    response_date: date,
) -> Account:
    """Update an account for a user

    Args:
        db: Active database session
        account_id: Account identifier from the route path
        data: Account fields to update
        user: Authenticated user updating the account
        response_date: Date used for balance fields and archive adjustment rows

    Returns:
        Updated account with derived balance fields

    Raises:
        HTTPException: User lacks admin access or update fields are invalid
    """
    account = await check_account_access(db, account_id, user.id, PermissionLevel.ADMIN)

    updates = data.model_dump(exclude_unset=True)
    if not updates:
        await attach_account_balance_fields(db, [account], user, response_date)
        return account

    await validate_update_account_request(db, account, updates)
    await validate_update_account_tax_advantaged_category_link(db, account, updates, user.id)
    await apply_account_updates(db, account, updates, user, response_date)

    # Mark the account scope stale before returning the account with derived fields
    await mark_cache_changed_for_scope(db, user_id=account.owner_id, group_id=account.group_id)
    await db.commit()

    response_account = await get_account_for_response(
        db,
        user,
        account_id,
        response_date,
        refresh_cached_account=True,
    )
    return response_account


async def apply_account_updates(
    db: AsyncSession,
    account: Account,
    updates: Mapping[str, Any],
    user: User,
    archive_date: date,
) -> None:
    """Apply account update fields and archive balance adjustment

    Args:
        db: Active database session
        account: Account being updated
        updates: Explicit fields from the account update request
        user: Authenticated user updating the account
        archive_date: Date used for archive balance adjustment rows
    """
    should_archive = updates.get("is_archived") is True and not account.is_archived

    # Apply requested fields before adding any archive balance adjustment
    for field, value in updates.items():
        setattr(account, field, value)

    if should_archive:
        await zero_account_balance_for_archive(db, account, user, archive_date)
