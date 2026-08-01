"""Transaction related-entity validation services"""
import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import PermissionLevel, TransferOtherAccountScope
from app.models.category import Category
from app.models.currency import Currency
from app.models.merchant import Merchant
from app.models.tag import Tag
from app.permissions import check_account_access
from app.services.categories.transfer_rules import does_category_record_other_account

_FX_RATE_REQUIRED_DETAIL = "fx_rate is required when transaction currency differs from account currency"

OTHER_ACCOUNT_NOT_ALLOWED_DETAIL = "This category does not record another account"


async def validate_transaction_currency_exists(db: AsyncSession, currency: str) -> None:
    """Ensure a transaction currency code is configured

    The transaction amount may be stored in a receipt currency that differs
    from the account currency, but the submitted currency code still needs to
    exist before the transaction row can be persisted

    Args:
        db: Active database session
        currency: Currency code submitted on the transaction

    Raises:
        HTTPException: Currency code is not configured
    """
    # Confirm the transaction currency exists before storing the transaction
    result = await db.execute(select(Currency).where(Currency.id == currency))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid currency code")


def validate_transaction_fx_rate_for_account_currency(
    transaction_currency: str,
    account_currency: str,
    fx_rate: float | None,
    *,
    fx_rate_change_requested: bool = False,
) -> None:
    """Ensure cross-currency transactions include an FX rate

    Transactions can use a currency different from their account currency only
    when the request supplies an FX rate. Update requests may ask to change the
    FX rate in the same patch, so callers can mark that field as requested

    Args:
        transaction_currency: Currency stored on the transaction
        account_currency: Currency configured on the account
        fx_rate: Existing or submitted FX rate
        fx_rate_change_requested: Whether the current request includes the FX rate field

    Raises:
        HTTPException: Cross-currency transaction is missing an FX rate
    """
    if transaction_currency == account_currency:
        return
    if fx_rate is not None or fx_rate_change_requested:
        return

    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        detail=_FX_RATE_REQUIRED_DETAIL,
    )


async def validate_transaction_category_access(
    db: AsyncSession,
    category_id: uuid.UUID,
    user_id: uuid.UUID,
    group_id: uuid.UUID | None = None,
) -> Category:
    """Ensure a transaction can use the requested category

    Personal-account transactions may use system categories and the user's own
    personal categories. Group-account transactions may also use categories
    owned by the account's group. Categories from another user's personal scope
    or an unrelated group are rejected

    Args:
        db: Active database session
        category_id: Category identifier submitted on the transaction
        user_id: User identifier creating or updating the transaction
        group_id: Optional group identifier from the transaction account

    Returns:
        Category row the transaction may use, so callers can read its kind without a second lookup

    Raises:
        HTTPException: Category is missing or outside the transaction account scope
    """
    # Build a category lookup that accepts only categories valid for the transaction account scope
    query = select(Category).where(Category.id == category_id)
    if group_id is not None:
        query = query.where(
            Category.is_system.is_(True)
            | ((Category.owner_id == user_id) & (Category.group_id.is_(None)))
            | (Category.group_id == group_id),
        )
    else:
        query = query.where(
            Category.is_system.is_(True)
            | ((Category.owner_id == user_id) & (Category.group_id.is_(None))),
        )

    # Confirm the category exists inside the transaction account scope
    category = (await db.execute(query)).scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Category not found")
    return category


async def validate_transaction_merchant_access(
    db: AsyncSession,
    merchant_id: uuid.UUID,
    user_id: uuid.UUID,
    group_id: uuid.UUID | None = None,
) -> None:
    """Ensure a transaction can use the requested merchant

    Every transaction may use a system merchant, since those ship with the app.
    Personal-account transactions may otherwise use only the user's personal
    merchants. Group-account transactions may also use merchants owned by the
    account's group. Merchants from another user's personal scope or an
    unrelated group are rejected

    Args:
        db: Active database session
        merchant_id: Merchant identifier submitted on the transaction
        user_id: User identifier creating or updating the transaction
        group_id: Optional group identifier from the transaction account

    Raises:
        HTTPException: Merchant is missing or outside the transaction account scope
    """
    # Build a merchant lookup that accepts only merchants valid for the transaction account scope
    query = select(Merchant).where(Merchant.id == merchant_id)
    if group_id is not None:
        query = query.where(
            Merchant.is_system.is_(True)
            | ((Merchant.owner_id == user_id) & (Merchant.group_id.is_(None)))
            | (Merchant.group_id == group_id),
        )
    else:
        query = query.where(
            Merchant.is_system.is_(True)
            | ((Merchant.owner_id == user_id) & (Merchant.group_id.is_(None))),
        )

    # Confirm the merchant exists inside the transaction account scope
    if not (await db.execute(query)).scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Merchant not found")


async def get_valid_transaction_tag_ids(
    db: AsyncSession,
    user_id: uuid.UUID,
    tag_ids: list[uuid.UUID],
    group_id: uuid.UUID | None = None,
) -> list[uuid.UUID]:
    """Return tag identifiers a transaction can safely attach

    The submitted tag list is deduplicated while preserving order. Personal
    accounts may attach the user's personal tags, while group accounts may also
    attach tags owned by the account's group. Any missing or out-of-scope tag
    rejects the whole request

    Args:
        db: Active database session
        user_id: User identifier creating or updating the transaction
        tag_ids: Tag identifiers submitted on the transaction
        group_id: Optional group identifier from the transaction account

    Returns:
        Deduplicated tag identifiers that preserve the submitted order

    Raises:
        HTTPException: At least one tag is missing or outside the transaction account scope
    """
    # Deduplicate to avoid attaching the same tag more than once
    unique_tag_ids = list(dict.fromkeys(tag_ids))
    tag_filter = (Tag.owner_id == user_id) & (Tag.group_id.is_(None))
    if group_id is not None:
        tag_filter = tag_filter | (Tag.group_id == group_id)

    # Fetch tags visible in the transaction account's personal or group scope
    result = await db.execute(
        select(Tag.id).where(Tag.id.in_(unique_tag_ids), tag_filter),
    )
    found_tag_ids = set(result.scalars().all())
    if found_tag_ids != set(unique_tag_ids):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Tag not found")
    return unique_tag_ids


async def validate_transaction_other_account(
    db: AsyncSession,
    user_id: uuid.UUID,
    category: Category,
    account_id: uuid.UUID,
    other_account_id: uuid.UUID | None,
    other_account_scope: TransferOtherAccountScope | None,
) -> None:
    """Ensure the recorded other side of a transfer agrees with its category

    Args:
        db: Active database session
        user_id: User identifier creating or updating the transaction
        category: Category the transaction ends up using
        account_id: Account the transaction is recorded in
        other_account_id: Account recorded as the other side, set only when the scope is tracked
        other_account_scope: Where the other side sits, or None when nothing is recorded

    Raises:
        HTTPException: The answer is missing, contradicts itself, or points at an unusable account
    """
    if not does_category_record_other_account(category):
        if other_account_scope is not None or other_account_id is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=OTHER_ACCOUNT_NOT_ALLOWED_DETAIL,
            )
        return

    # Editing answers the question as much as creating does, so a transfer recorded before the field
    # existed has to say where the money went before any other change to it is accepted
    if other_account_scope is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A transfer must record where the money went",
        )

    if other_account_scope == TransferOtherAccountScope.OUTSIDE:
        if other_account_id is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="other_account_id is not allowed when the money left the tracked accounts",
            )
        return

    if other_account_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="other_account_id is required when the other side is a tracked account",
        )
    if other_account_id == account_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A transfer cannot record its own account as the other side",
        )

    # Read access is enough, since recording an account writes nothing to it. Archived and closed
    # accounts stay recordable, because archiving happens after the money moved
    await check_account_access(db, other_account_id, user_id, PermissionLevel.READ)
