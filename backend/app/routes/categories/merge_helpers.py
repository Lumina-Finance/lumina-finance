"""Category merge route helpers"""
import uuid

import sqlalchemy as sa
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.budget import BudgetTrackedCategory
from app.models.category import Category
from app.models.merchant import Merchant
from app.models.transaction import Transaction
from app.routes.categories.access_helpers import (
    get_accessible_category_or_404,
    require_group_category_admin,
)
from app.routes.categories.category_scope_filter_helpers import get_system_or_personal_category_filter
from app.services.cache_state import mark_cache_changed_for_scope


async def get_merge_replacement_category(
    db: AsyncSession,
    source_category: Category,
    replacement_category_id: uuid.UUID,
    user_id: uuid.UUID,
) -> Category:
    """Return the valid replacement category for a merge

    Args:
        db: Active database session
        source_category: Category being merged away
        replacement_category_id: Requested replacement category identifier
        user_id: Authenticated user identifier

    Returns:
        Replacement category for the merge

    Raises:
        HTTPException: Replacement category is invalid, missing, or the wrong kind
    """
    if source_category.id == replacement_category_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Replacement category must be different",
        )

    replacement_filter = Category.id == replacement_category_id
    if source_category.group_id is None:
        replacement_filter = replacement_filter & get_system_or_personal_category_filter(user_id)
    else:
        replacement_filter = replacement_filter & (
            Category.is_system.is_(True) | (Category.group_id == source_category.group_id)
        )

    # Fetch a replacement category from the scope allowed by the category being merged
    replacement_result = await db.execute(select(Category).where(replacement_filter))
    replacement = replacement_result.scalar_one_or_none()
    if not replacement:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Replacement category not found",
        )
    if replacement.kind != source_category.kind:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Replacement category kind must match",
        )
    return replacement


async def move_category_references(
    db: AsyncSession,
    source_category_id: uuid.UUID,
    replacement_category_id: uuid.UUID,
) -> None:
    """Move category references from a source category to a replacement

    Args:
        db: Active database session
        source_category_id: Category being merged away
        replacement_category_id: Category receiving the references
    """
    replacement_tracked_category = aliased(BudgetTrackedCategory)

    # Delete duplicate tracked-category rows before moving source references to the replacement
    await db.execute(
        sa.delete(BudgetTrackedCategory).where(
            BudgetTrackedCategory.category_id == source_category_id,
            BudgetTrackedCategory.removed_at.is_(None),
            sa.exists().where(
                replacement_tracked_category.base_budget_id == BudgetTrackedCategory.base_budget_id,
                replacement_tracked_category.category_id == replacement_category_id,
                replacement_tracked_category.removed_at.is_(None),
            ),
        ),
    )

    # Move source transactions to the replacement category
    await db.execute(
        sa.update(Transaction)
        .where(Transaction.category_id == source_category_id)
        .values(category_id=replacement_category_id),
    )

    # Move merchant default categories from the source category to the replacement
    await db.execute(
        sa.update(Merchant)
        .where(Merchant.default_category_id == source_category_id)
        .values(default_category_id=replacement_category_id),
    )

    # Move tracked budget categories from the source category to the replacement
    await db.execute(
        sa.update(BudgetTrackedCategory)
        .where(BudgetTrackedCategory.category_id == source_category_id)
        .values(category_id=replacement_category_id),
    )


async def merge_category_into_replacement_for_user(
    db: AsyncSession,
    category_id: uuid.UUID,
    replacement_category_id: uuid.UUID,
    user_id: uuid.UUID,
) -> None:
    """Merge a category into a replacement category for a user

    Args:
        db: Active database session
        category_id: Category identifier from the route path
        replacement_category_id: Replacement category identifier from the payload
        user_id: Authenticated user identifier

    Raises:
        HTTPException: Category is inaccessible, immutable, or has an invalid replacement
    """
    category = await get_accessible_category_or_404(db, category_id, user_id)
    if category.is_system:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="System categories cannot be deleted")

    await require_group_category_admin(db, category, user_id)
    replacement = await get_merge_replacement_category(db, category, replacement_category_id, user_id)
    await move_category_references(db, category.id, replacement.id)
    await mark_cache_changed_for_scope(db, user_id=category.owner_id, group_id=category.group_id)

    # Delete the source category after all category references point to the replacement
    await db.delete(category)
    await db.commit()
