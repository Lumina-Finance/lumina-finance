"""Asking the installed allowance check before a user adds a record or uses a feature, and refusing on its no"""

import hashlib
import uuid
from collections.abc import Callable

from fastapi import HTTPException, status
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.allowance_hook import AllowanceKind, AllowanceRequest, Refusal, find_refusal, is_allowance_check_installed
from app.models.account import Account, TaxAdvantagedCategory, TaxAdvantagedCategoryLimit
from app.models.bank_connection import BankConnection
from app.models.budget import BaseBudget
from app.models.category import Category
from app.models.merchant import Merchant
from app.models.saved_insights_range import SavedInsightsRange
from app.models.tag import Tag

# The namespace separates this protocol's lock inputs from other advisory lock protocols
_ALLOWANCE_LOCK_NAMESPACE = b"lumina:allowance:"

# What each record kind counts as held: the rows the user owns alone, never one owned through a group
HELD_QUERIES: dict[AllowanceKind, Callable[[uuid.UUID], Select]] = {
    AllowanceKind.ACCOUNT: lambda user_id: select(func.count()).select_from(Account).where(Account.owner_id == user_id),
    AllowanceKind.BUDGET: lambda user_id: select(func.count()).select_from(BaseBudget).where(BaseBudget.owner_id == user_id),
    AllowanceKind.CATEGORY: lambda user_id: (
        select(func.count()).select_from(Category).where(Category.owner_id == user_id, Category.group_id.is_(None))
    ),
    AllowanceKind.TAG: lambda user_id: select(func.count()).select_from(Tag).where(Tag.owner_id == user_id, Tag.group_id.is_(None)),
    AllowanceKind.MERCHANT: lambda user_id: (
        select(func.count()).select_from(Merchant).where(Merchant.owner_id == user_id, Merchant.group_id.is_(None))
    ),
    AllowanceKind.TAX_ADVANTAGED_CATEGORY: lambda user_id: (
        select(func.count())
        .select_from(TaxAdvantagedCategory)
        .where(TaxAdvantagedCategory.category_owner_user_id == user_id, TaxAdvantagedCategory.group_id.is_(None))
    ),
    # A category holds one limit a year, so the total stays small and is counted across the user's categories
    AllowanceKind.TAX_ADVANTAGED_CATEGORY_LIMIT: lambda user_id: (
        select(func.count())
        .select_from(TaxAdvantagedCategoryLimit)
        .join(TaxAdvantagedCategory, TaxAdvantagedCategory.id == TaxAdvantagedCategoryLimit.tax_advantaged_category_id)
        .where(TaxAdvantagedCategory.category_owner_user_id == user_id, TaxAdvantagedCategory.group_id.is_(None))
    ),
    AllowanceKind.SAVED_INSIGHTS_RANGE: lambda user_id: (
        select(func.count()).select_from(SavedInsightsRange).where(SavedInsightsRange.user_id == user_id)
    ),
    AllowanceKind.BANK_CONNECTION: lambda user_id: select(func.count()).select_from(BankConnection).where(BankConnection.owner_id == user_id),
}


# The feature kinds, each asked about before the feature is used rather than before a record is added
FEATURES: tuple[AllowanceKind, ...] = (AllowanceKind.BANK_SYNC, AllowanceKind.INSIGHTS)


def _refuse(refusal: Refusal) -> HTTPException:
    """Return the 403 that shows the user the check's own sentence"""
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=refusal.reason)


async def find_feature_refusal(user_id: uuid.UUID, kind: AllowanceKind) -> Refusal | None:
    """Ask whether a user may use a feature, and return the refusal or None when they may

    Args:
        user_id: The user using the feature
        kind: The feature
    """
    return await find_refusal(AllowanceRequest(user_id=user_id, kind=kind, held=None, adding=0))


async def list_granted_features(user_id: uuid.UUID) -> list[AllowanceKind]:
    """Return the features the installed check lets a user use, in the order FEATURES lists them, or all of them when no check is installed

    Args:
        user_id: The signed-in user
    """
    return [kind for kind in FEATURES if await find_feature_refusal(user_id, kind) is None]


async def require_feature(user_id: uuid.UUID, kind: AllowanceKind) -> None:
    """Refuse a user who may not use a feature

    Raises:
        HTTPException 403: The installed check refused, with its reason as the detail
    """
    refusal = await find_feature_refusal(user_id, kind)
    if refusal is not None:
        raise _refuse(refusal)


async def require_allowance(
    db: AsyncSession,
    user_id: uuid.UUID,
    kind: AllowanceKind,
    *,
    adding: int = 1,
    group_id: uuid.UUID | None = None,
) -> None:
    """Refuse a user who may not add more records of a kind, counting what they hold in the request's own session

    The user's holdings of the kind are locked until the transaction ends, so two requests adding at
    the limit cannot both pass. Nothing is counted or locked when no check is installed

    Args:
        db: The request's session, under the user's row-level security
        user_id: The user adding
        kind: A record kind, not a feature
        adding: How many records are about to be added at once
        group_id: The group the record would belong to, which exempts it, since a record owned
            through a group is never asked about

    Raises:
        HTTPException 403: The installed check refused, with its reason as the detail
    """
    # The one place a group-owned record is left out of every ask
    if group_id is not None or not is_allowance_check_installed():
        return

    digest = hashlib.blake2b(_ALLOWANCE_LOCK_NAMESPACE + user_id.bytes + kind.value.encode(), digest_size=8).digest()
    await db.execute(select(func.pg_advisory_xact_lock(int.from_bytes(digest, byteorder="big", signed=True))))
    held = await db.scalar(HELD_QUERIES[kind](user_id))
    refusal = await find_refusal(AllowanceRequest(user_id=user_id, kind=kind, held=held, adding=adding))
    if refusal is not None:
        raise _refuse(refusal)
