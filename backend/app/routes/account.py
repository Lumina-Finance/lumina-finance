import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.account import Account
from app.models.base import AccountType, TaxTreatment
from app.models.currency import Currency
from app.models.household import HouseholdMember
from app.models.institution import Institution
from app.models.user import User
from app.schemas.account import AccountResponse, CreateAccountRequest, UpdateAccountRequest

router = APIRouter(prefix="/accounts", tags=["accounts"])

# Valid enum values for request validation
_VALID_ACCOUNT_TYPES = {e.value for e in AccountType}
_VALID_TAX_TREATMENTS = {e.value for e in TaxTreatment}


@router.get("", response_model=list[AccountResponse])
async def list_accounts(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return all accounts owned by the authenticated user.

    Args:
        user: The authenticated user.
        db: Async database session.

    Returns:
        List of accounts sorted by creation date.
    """
    result = await db.execute(
        select(Account).where(Account.owner_id == user.id).order_by(Account.created_at),
    )
    return result.scalars().all()


@router.get("/{account_id}", response_model=AccountResponse)
async def get_account(
    account_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return a single account by ID. Must belong to the authenticated user.

    Args:
        account_id: UUID of the account.
        user: The authenticated user.
        db: Async database session.

    Returns:
        The matching account.

    Raises:
        HTTPException 404: Account not found or not owned by the user.
    """
    result = await db.execute(
        select(Account).where(Account.id == account_id, Account.owner_id == user.id),
    )
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    return account


@router.post("", response_model=AccountResponse, status_code=status.HTTP_201_CREATED)
async def create_account(
    data: CreateAccountRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create a new account. Personal by default, or household-scoped if household_id is provided.

    Args:
        data: Account details.
        user: The authenticated user.
        db: Async database session.

    Returns:
        The created account.

    Raises:
        HTTPException 422: Invalid account_type, tax_treatment, currency, or institution.
        HTTPException 403: User is not an admin of the household.
        HTTPException 404: User is not a member of the household.
    """
    if data.account_type not in _VALID_ACCOUNT_TYPES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid account type")
    if data.tax_treatment not in _VALID_TAX_TREATMENTS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid tax treatment")

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
    household_id = data.household_id
    if household_id:
        membership_result = await db.execute(
            select(HouseholdMember).where(
                HouseholdMember.household_id == household_id,
                HouseholdMember.user_id == user.id,
            ),
        )
        membership = membership_result.scalar_one_or_none()
        if not membership:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Household not found")
        if not membership.is_admin:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can create household accounts")
        owner_id = None

    account = Account(
        owner_id=owner_id,
        household_id=household_id,
        account_type=data.account_type,
        tax_treatment=data.tax_treatment,
        name=data.name,
        institution_id=data.institution_id,
        currency=data.currency,
        lifetime_contribution_limit=data.lifetime_contribution_limit,
        is_hidden=data.is_hidden,
    )
    db.add(account)
    await db.commit()
    await db.refresh(account)
    return account


@router.patch("/{account_id}", response_model=AccountResponse)
async def update_account(
    account_id: uuid.UUID,
    data: UpdateAccountRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update an account. Only provided fields are changed. Must belong to the authenticated user.

    Args:
        account_id: UUID of the account.
        data: Partial update payload.
        user: The authenticated user.
        db: Async database session.

    Returns:
        The updated account.

    Raises:
        HTTPException 404: Account not found or not owned by the user.
        HTTPException 422: Invalid tax_treatment or institution.
    """
    result = await db.execute(
        select(Account).where(Account.id == account_id, Account.owner_id == user.id),
    )
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")

    updates = data.model_dump(exclude_unset=True)
    if not updates:
        return account

    # Validate tax_treatment if being changed
    if "tax_treatment" in updates and updates["tax_treatment"] not in _VALID_TAX_TREATMENTS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid tax treatment")

    # Validate institution if being changed
    if "institution_id" in updates and updates["institution_id"] is not None:
        result = await db.execute(select(Institution).where(Institution.id == updates["institution_id"]))
        if not result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Institution not found")

    for field, value in updates.items():
        setattr(account, field, value)

    await db.commit()
    await db.refresh(account)
    return account


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    account_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete an account. Must belong to the authenticated user.

    Args:
        account_id: UUID of the account.
        user: The authenticated user.
        db: Async database session.

    Raises:
        HTTPException 404: Account not found or not owned by the user.
    """
    result = await db.execute(
        select(Account).where(Account.id == account_id, Account.owner_id == user.id),
    )
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")

    await db.delete(account)
    await db.commit()
