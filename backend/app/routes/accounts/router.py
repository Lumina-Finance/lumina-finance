"""Account route handlers"""
import uuid
from datetime import datetime
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user
from app.models.account import Account, AccountBalanceSnapshot, AccountPermission, TaxAdvantagedPlan
from app.models.base import ACCOUNT_KIND_BY_TYPE, AccountKind, AccountType, CategoryKind, PermissionLevel, TaxTreatment
from app.models.category import Category
from app.models.currency import Currency
from app.models.group import Group, GroupMember
from app.models.institution import Institution
from app.models.transaction import Transaction
from app.models.user import User
from app.permissions import check_account_access
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
from app.services.accounts import (
    attach_base_currency_current_balances,
    get_account_cash_flow_history,
    get_account_spending_breakdown,
)
from app.services.cache_state import mark_cache_changed_for_scope
from app.services.snapshots import attach_current_balances, get_current_balances, recompute_snapshots_from

router = APIRouter(prefix="/accounts", tags=["accounts"])
router.include_router(permissions_router)
router.include_router(snapshots_router)

# Valid enum values for request validation
_VALID_ACCOUNT_KINDS = {e.value for e in AccountKind}
_VALID_ACCOUNT_TYPES = {e.value for e in AccountType}

# UpdateAccountRequest fields that map to NOT NULL columns reject explicit null with 422
_UPDATE_ACCOUNT_NOT_NULL_FIELDS = frozenset({"name", "is_archived"})
_BALANCE_ADJUSTMENT_CATEGORY_NAME = "Balance Adjustment"
_STARTING_BALANCE_NOTE = "Starting balance"
_ARCHIVE_BALANCE_ADJUSTMENT_NOTE = "Account archived"


async def _attach_account_balance_fields(db: AsyncSession, accounts: list[Account], user: User) -> None:
    """Attach current and base-currency balance fields to accounts

    Args:
        db: Active database session
        accounts: Accounts receiving derived balance fields
        user: Authenticated user requesting the account data
    """
    await attach_current_balances(db, accounts)
    await attach_base_currency_current_balances(
        db,
        accounts,
        user.base_currency,
        datetime.now(ZoneInfo(user.tz)).date(),
    )


async def _get_system_balance_adjustment_category_id(db: AsyncSession) -> uuid.UUID:
    """Return the system balance adjustment category identifier

    Args:
        db: Active database session

    Returns:
        Balance adjustment category identifier

    Raises:
        HTTPException: Balance adjustment category is not configured
    """
    category_id = await db.scalar(
        select(Category.id).where(
            Category.is_system.is_(True),
            Category.kind == CategoryKind.TRANSFER,
            Category.name == _BALANCE_ADJUSTMENT_CATEGORY_NAME,
        ),
    )
    if category_id is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Balance adjustment category is not configured",
        )
    return category_id


async def _zero_account_balance_for_archive(db: AsyncSession, account: Account, user: User) -> None:
    """Add an archive adjustment when an account has a nonzero balance

    Args:
        db: Active database session
        account: Account being archived
        user: Authenticated user archiving the account
    """
    current_balance = (await get_current_balances(db, [account.id])).get(account.id, 0)
    if current_balance == 0:
        return

    archive_dt = datetime.now(ZoneInfo(user.tz)).date()
    db.add(Transaction(
        created_by_user_id=user.id,
        account_id=account.id,
        dt=archive_dt,
        category_id=await _get_system_balance_adjustment_category_id(db),
        amount=-current_balance,
        currency=account.currency,
        fx_rate=None,
        notes=_ARCHIVE_BALANCE_ADJUSTMENT_NOTE,
    ))
    await db.flush()
    await recompute_snapshots_from(db, account.id, archive_dt)


async def _validate_tax_advantaged_plan_link(
    db: AsyncSession,
    plan_id: uuid.UUID | None,
    *,
    account_kind: AccountKind,
    currency: str,
    owner_id: uuid.UUID | None,
    group_id: uuid.UUID | None,
    acting_user_id: uuid.UUID,
) -> None:
    """Validate that an account can link to a tax-advantaged plan

    Args:
        db: Active database session
        plan_id: Plan identifier to link, or None to leave the account unlinked
        account_kind: Account kind for the account being created or updated
        currency: Account currency code
        owner_id: Personal account owner, if the account is personal
        group_id: Group account owner, if the account is group-scoped
        acting_user_id: Authenticated user making the change

    Raises:
        HTTPException: Plan is missing, inaccessible, or incompatible with the account
    """
    if plan_id is None:
        return

    if account_kind != AccountKind.ASSET:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Tax-advantaged plans can only be linked to asset accounts",
        )

    plan = await db.get(TaxAdvantagedPlan, plan_id)
    if not plan or plan.tax_treatment == TaxTreatment.TAXABLE:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid tax-advantaged plan")

    if plan.currency != currency:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Tax-advantaged plan currency must match account currency",
        )

    if group_id is None:
        if plan.group_id is not None or plan.plan_owner_user_id != owner_id:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid tax-advantaged plan")
        return

    if plan.group_id != group_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid tax-advantaged plan")
    if plan.plan_owner_user_id != acting_user_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Only the plan owner can link this plan to a group account",
        )

    owner_membership = await db.get(GroupMember, (group_id, plan.plan_owner_user_id))
    if not owner_membership:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid tax-advantaged plan")


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
    # Personal accounts OR group accounts where user is admin OR has explicit permission
    query = (
        select(Account)
        .options(selectinload(Account.institution))
        .outerjoin(GroupMember, Account.group_id == GroupMember.group_id)
        .outerjoin(
            AccountPermission,
            (AccountPermission.account_id == Account.id) & (AccountPermission.user_id == user.id),
        )
        .where(
            (Account.owner_id == user.id)
            | ((GroupMember.user_id == user.id) & (GroupMember.is_admin.is_(True)))
            | (AccountPermission.user_id == user.id),
        )
        .order_by(Account.created_at)
    )
    result = await db.execute(query)
    accounts = result.scalars().unique().all()
    await _attach_account_balance_fields(db, accounts, user)
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
    await _attach_account_balance_fields(db, [account], user)
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
    if data.account_kind not in _VALID_ACCOUNT_KINDS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid account kind")
    if data.account_type not in _VALID_ACCOUNT_TYPES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid account type")
    if ACCOUNT_KIND_BY_TYPE[AccountType(data.account_type)] != AccountKind(data.account_kind):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Account kind does not match account type",
        )
    if data.credit_limit is not None and AccountKind(data.account_kind) != AccountKind.REVOLVING:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="credit_limit is only valid on revolving-credit accounts",
        )
    # Validate currency exists
    result = await db.execute(select(Currency).where(Currency.id == data.currency))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid currency code")

    # Validate institution exists if provided
    if data.institution_id:
        result = await db.execute(select(Institution).where(Institution.id == data.institution_id))
        if not result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Institution not found")

    # Determine ownership
    owner_id = user.id
    group_id = data.group_id
    anchor_tz = user.tz
    if group_id:
        membership_result = await db.execute(
            select(GroupMember).where(
                GroupMember.group_id == group_id,
                GroupMember.user_id == user.id,
            ),
        )
        membership = membership_result.scalar_one_or_none()
        if not membership:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
        if not membership.is_admin:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can create group accounts")
        owner_id = None
        group_owner_tz = await db.scalar(
            select(User.tz)
            .join(Group, Group.owner_id == User.id)
            .where(Group.id == group_id),
        )
        if group_owner_tz is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
        anchor_tz = group_owner_tz

    await _validate_tax_advantaged_plan_link(
        db,
        data.tax_advantaged_plan_id,
        account_kind=AccountKind(data.account_kind),
        currency=data.currency,
        owner_id=owner_id,
        group_id=group_id,
        acting_user_id=user.id,
    )

    account = Account(
        owner_id=owner_id,
        group_id=group_id,
        account_kind=data.account_kind,
        account_type=data.account_type,
        tax_advantaged_plan_id=data.tax_advantaged_plan_id,
        name=data.name,
        institution_id=data.institution_id,
        currency=data.currency,
        credit_limit=data.credit_limit,
        is_archived=data.is_archived,
    )
    db.add(account)
    await db.flush()

    # Anchor balance history with a zero-balance snapshot for stable account charts
    # Recompute restores this anchor when transaction history is emptied
    anchor_dt = account.created_at.astimezone(ZoneInfo(anchor_tz)).date()
    db.add(AccountBalanceSnapshot(
        account_id=account.id,
        dt=anchor_dt,
        balance=0,
    ))

    if data.starting_balance:
        db.add(Transaction(
            created_by_user_id=user.id,
            account_id=account.id,
            dt=anchor_dt,
            category_id=await _get_system_balance_adjustment_category_id(db),
            amount=data.starting_balance,
            currency=account.currency,
            fx_rate=None,
            notes=_STARTING_BALANCE_NOTE,
        ))
        await db.flush()
        await recompute_snapshots_from(db, account.id, anchor_dt)

    await mark_cache_changed_for_scope(db, user_id=account.owner_id, group_id=account.group_id)
    await db.commit()
    # Re-fetch with eager loading so the institution relationship is populated for the response
    result = await db.execute(
        select(Account).where(Account.id == account.id).options(selectinload(Account.institution)),
    )
    fresh = result.scalar_one()
    await _attach_account_balance_fields(db, [fresh], user)
    return fresh


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
        await _attach_account_balance_fields(db, [account], user)
        return account

    # Reject explicit null on fields that map to NOT NULL columns before they reach the DB
    for field in _UPDATE_ACCOUNT_NOT_NULL_FIELDS:
        if field in updates and updates[field] is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"{field} cannot be null",
            )

    # Validate institution if being changed
    if "institution_id" in updates and updates["institution_id"] is not None:
        result = await db.execute(select(Institution).where(Institution.id == updates["institution_id"]))
        if not result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Institution not found")

    # credit_limit is only meaningful on revolving-credit accounts
    # Amortizing debt has a principal schedule, and account_kind is fixed at creation
    if updates.get("credit_limit") is not None and account.account_kind != AccountKind.REVOLVING:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="credit_limit is only valid on revolving-credit accounts",
        )

    if "tax_advantaged_plan_id" in updates:
        await _validate_tax_advantaged_plan_link(
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
        await _zero_account_balance_for_archive(db, account, user)

    await mark_cache_changed_for_scope(db, user_id=account.owner_id, group_id=account.group_id)
    await db.commit()
    # Re-fetch with eager loading so the institution relationship is fresh after a possible institution_id change
    # populate_existing overwrites the cached instance so stale institution data is not reused
    result = await db.execute(
        select(Account)
        .where(Account.id == account_id)
        .options(selectinload(Account.institution))
        .execution_options(populate_existing=True),
    )
    fresh = result.scalar_one()
    await _attach_account_balance_fields(db, [fresh], user)
    return fresh


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
