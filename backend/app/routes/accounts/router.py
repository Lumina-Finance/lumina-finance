"""Account route handlers"""
import uuid
from datetime import datetime
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.base import AccountKind, PermissionLevel
from app.models.user import User
from app.permissions import check_account_access
from app.routes.accounts.account_balance_adjustments import zero_account_balance_for_archive
from app.routes.accounts.account_balance_fields import attach_account_balance_fields
from app.routes.accounts.account_creation import create_account_with_initial_balance_history
from app.routes.accounts.account_creation_scope import resolve_account_creation_scope
from app.routes.accounts.account_listing import get_accounts_visible_to_user
from app.routes.accounts.account_request_validation import (
    validate_create_account_request,
    validate_update_account_request,
)
from app.routes.accounts.account_response_loading import get_account_for_response
from app.routes.accounts.account_tax_advantaged_plan_links import validate_tax_advantaged_plan_link
from app.routes.accounts.permissions import router as permissions_router
from app.routes.accounts.snapshots import router as snapshots_router
from app.schemas.account import (
    AccountResponse,
    AccountsOverview,
    AccountSpendingBreakdown,
    CreateAccountRequest,
    UpdateAccountRequest,
)
from app.schemas.dashboard import MonthlyIncomeExpense, RangeKind
from app.services.accounts import get_account_cash_flow_history, get_account_spending_breakdown
from app.services.cache_state import mark_cache_changed_for_scope

router = APIRouter(prefix="/accounts", tags=["accounts"])
router.include_router(permissions_router)
router.include_router(snapshots_router)

@router.get("", response_model=list[AccountsOverview])
async def list_accounts(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return accounts accessible through ownership, group admin, or permission

    Args:
        user: Authenticated user requesting accounts
        db: Active database session

    Returns:
        Accounts the user can access
    """
    accounts = await get_accounts_visible_to_user(db, user.id)
    await attach_account_balance_fields(db, accounts, user, datetime.now(ZoneInfo(user.tz)).date())
    return accounts


@router.get("/{account_id}", response_model=AccountResponse)
async def get_account(
    account_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return a single account by ID

    Args:
        account_id: Account identifier from the route path
        user: Authenticated user requesting the account
        db: Active database session

    Returns:
        Account with derived balance fields

    Raises:
        HTTPException: User does not have read access
    """
    account = await check_account_access(db, account_id, user.id, PermissionLevel.READ)
    await attach_account_balance_fields(db, [account], user, datetime.now(ZoneInfo(user.tz)).date())
    return account


@router.get("/{account_id}/spending-breakdown", response_model=AccountSpendingBreakdown)
async def get_account_spending_breakdown_route(
    account_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    range_: Annotated[RangeKind, Query(alias="range")] = "MTD",
):
    """Return top spending categories and merchants for an account range

    Backs the spending-by-category and top-merchants cards on the account
    detail page. ``range`` picks the calendar period, and the backend derives
    the start date so the frontend only sends the range key

    Args:
        account_id: Account identifier from the route path
        user: Authenticated user requesting the breakdown
        db: Active database session
        range_: Calendar period used for spending totals

    Returns:
        Spending breakdown for the account and range

    Raises:
        HTTPException: User does not have read access
    """
    await check_account_access(db, account_id, user.id, PermissionLevel.READ)
    return await get_account_spending_breakdown(db, account_id, range_, datetime.now(ZoneInfo(user.tz)))


@router.get("/{account_id}/cash-flow", response_model=list[MonthlyIncomeExpense])
async def get_account_cash_flow_route(
    account_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    months: Annotated[int, Query(ge=1, le=24)] = 6,
):
    """Return monthly income and expense totals for an account

    Backs the monthly cash flow widget on the account detail page. Series
    covers ``months`` calendar months ending with the current (in-progress)
    month. Income, expense, and transfer movement are included except Balance
    Adjustment reconciliation rows

    Args:
        account_id: Account identifier from the route path
        user: Authenticated user requesting cash flow
        db: Active database session
        months: Number of months to include, ending in the current month

    Returns:
        Oldest-first monthly income and expense totals

    Raises:
        HTTPException: User does not have read access
    """
    await check_account_access(db, account_id, user.id, PermissionLevel.READ)
    return await get_account_cash_flow_history(db, account_id, months, datetime.now(ZoneInfo(user.tz)))


@router.post("", response_model=AccountResponse, status_code=status.HTTP_201_CREATED)
async def create_account(
    data: CreateAccountRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create a new personal or group-scoped account

    Args:
        data: Account details
        user: Authenticated user creating the account
        db: Active database session

    Returns:
        Created account with derived balance fields

    Raises:
        HTTPException: Account details, ownership, or linked plan are invalid
    """
    await validate_create_account_request(db, data)

    creation_scope = await resolve_account_creation_scope(db, user, data.group_id)

    await validate_tax_advantaged_plan_link(
        db,
        data.tax_advantaged_plan_id,
        account_kind=AccountKind(data.account_kind),
        currency=data.currency,
        owner_id=creation_scope.owner_id,
        group_id=creation_scope.group_id,
        acting_user_id=user.id,
    )

    account = await create_account_with_initial_balance_history(db, data, creation_scope, user)
    await mark_cache_changed_for_scope(db, user_id=account.owner_id, group_id=account.group_id)
    await db.commit()
    return await get_account_for_response(db, user, account.id, datetime.now(ZoneInfo(user.tz)).date())


@router.patch("/{account_id}", response_model=AccountResponse)
async def update_account(
    account_id: uuid.UUID,
    data: UpdateAccountRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update an account

    Args:
        account_id: Account identifier from the route path
        data: Account fields to update
        user: Authenticated user updating the account
        db: Active database session

    Returns:
        Updated account with derived balance fields

    Raises:
        HTTPException: User lacks admin access or update fields are invalid
    """
    account = await check_account_access(db, account_id, user.id, PermissionLevel.ADMIN)

    updates = data.model_dump(exclude_unset=True)
    if not updates:
        await attach_account_balance_fields(db, [account], user, datetime.now(ZoneInfo(user.tz)).date())
        return account

    await validate_update_account_request(db, account, updates)

    if "tax_advantaged_plan_id" in updates:
        await validate_tax_advantaged_plan_link(
            db,
            updates["tax_advantaged_plan_id"],
            account_kind=account.account_kind,
            currency=account.currency,
            owner_id=account.owner_id,
            group_id=account.group_id,
            acting_user_id=user.id,
        )

    should_archive = updates.get("is_archived") is True and not account.is_archived

    for field, value in updates.items():
        setattr(account, field, value)

    if should_archive:
        await zero_account_balance_for_archive(
            db,
            account,
            user,
            datetime.now(ZoneInfo(user.tz)).date(),
        )

    await mark_cache_changed_for_scope(db, user_id=account.owner_id, group_id=account.group_id)
    await db.commit()
    return await get_account_for_response(
        db,
        user,
        account_id,
        datetime.now(ZoneInfo(user.tz)).date(),
        refresh_cached_account=True,
    )


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    account_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete an account

    Args:
        account_id: Account identifier from the route path
        user: Authenticated user deleting the account
        db: Active database session

    Raises:
        HTTPException: User does not have admin access
    """
    account = await check_account_access(db, account_id, user.id, PermissionLevel.ADMIN)
    await mark_cache_changed_for_scope(db, user_id=account.owner_id, group_id=account.group_id)
    await db.delete(account)
    await db.commit()
