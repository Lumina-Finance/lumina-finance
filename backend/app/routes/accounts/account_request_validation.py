"""Account request validation helpers"""
from collections.abc import Mapping
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import ACCOUNT_KIND_BY_TYPE, AccountKind, AccountType
from app.models.currency import Currency
from app.models.institution import Institution
from app.schemas.account import CreateAccountRequest

_VALID_ACCOUNT_KINDS = {account_kind.value for account_kind in AccountKind}
_VALID_ACCOUNT_TYPES = {account_type.value for account_type in AccountType}
_UPDATE_ACCOUNT_NOT_NULL_FIELDS = frozenset({"name", "is_archived"})


async def validate_create_account_request(db: AsyncSession, data: CreateAccountRequest) -> None:
    """Validate account creation request fields

    Args:
        db: Active database session
        data: Account creation request body

    Raises:
        HTTPException: Account kind, type, currency, institution, or credit limit is invalid
    """
    account_kind = _get_valid_account_kind(data.account_kind)
    account_type = _get_valid_account_type(data.account_type)
    _raise_for_mismatched_account_kind_and_type(account_kind, account_type)
    _raise_for_invalid_credit_limit(account_kind, data.credit_limit)
    await _raise_for_missing_currency(db, data.currency)

    if data.institution_id is not None:
        await _raise_for_missing_institution(db, data.institution_id)


async def validate_update_account_request(
    db: AsyncSession,
    account: Account,
    updates: Mapping[str, Any],
) -> None:
    """Validate account update request fields

    Args:
        db: Active database session
        account: Account being updated
        updates: Explicit fields from the account update request

    Raises:
        HTTPException: Update fields, institution, or credit limit is invalid
    """
    _raise_for_null_protected_update_fields(updates)

    institution_id = updates.get("institution_id")
    if "institution_id" in updates and institution_id is not None:
        await _raise_for_missing_institution(db, institution_id)

    _raise_for_invalid_credit_limit(account.account_kind, updates.get("credit_limit"))


def _get_valid_account_kind(value: str) -> AccountKind:
    """Return a valid account kind from a request value

    Args:
        value: Account kind request value

    Returns:
        Account kind enum value

    Raises:
        HTTPException: Account kind value is invalid
    """
    if value not in _VALID_ACCOUNT_KINDS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid account kind")
    return AccountKind(value)


def _get_valid_account_type(value: str) -> AccountType:
    """Return a valid account type from a request value

    Args:
        value: Account type request value

    Returns:
        Account type enum value

    Raises:
        HTTPException: Account type value is invalid
    """
    if value not in _VALID_ACCOUNT_TYPES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid account type")
    return AccountType(value)


def _raise_for_mismatched_account_kind_and_type(account_kind: AccountKind, account_type: AccountType) -> None:
    """Raise when account kind does not match account type

    Args:
        account_kind: Account kind enum value
        account_type: Account type enum value

    Raises:
        HTTPException: Account type does not belong to the account kind
    """
    if ACCOUNT_KIND_BY_TYPE[account_type] != account_kind:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Account kind does not match account type",
        )


def _raise_for_invalid_credit_limit(account_kind: AccountKind, credit_limit: object | None) -> None:
    """Raise when credit limit is present for a non-revolving account

    Args:
        account_kind: Account kind enum value
        credit_limit: Requested credit limit value

    Raises:
        HTTPException: Credit limit is present for a non-revolving account
    """
    if credit_limit is not None and account_kind != AccountKind.REVOLVING:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="credit_limit is only valid on revolving-credit accounts",
        )


async def _raise_for_missing_currency(db: AsyncSession, currency: str) -> None:
    """Raise when a currency code is not configured

    Args:
        db: Active database session
        currency: Currency code from the request

    Raises:
        HTTPException: Currency code is not configured
    """
    result = await db.execute(select(Currency).where(Currency.id == currency))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid currency code")


async def _raise_for_missing_institution(db: AsyncSession, institution_id: object) -> None:
    """Raise when an institution identifier is not configured

    Args:
        db: Active database session
        institution_id: Institution identifier from the request

    Raises:
        HTTPException: Institution identifier is not configured
    """
    result = await db.execute(select(Institution).where(Institution.id == institution_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Institution not found")


def _raise_for_null_protected_update_fields(updates: Mapping[str, Any]) -> None:
    """Raise when explicit null targets a protected update field

    Args:
        updates: Explicit fields from the account update request

    Raises:
        HTTPException: Protected update field was explicitly set to null
    """
    for field in _UPDATE_ACCOUNT_NOT_NULL_FIELDS:
        if field in updates and updates[field] is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"{field} cannot be null",
            )
