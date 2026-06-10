"""Tax-advantaged category routes"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.routes.tax_advantaged_categories.tac_category_creation_helpers import create_tax_advantaged_category_with_metrics
from app.routes.tax_advantaged_categories.tac_category_deletion_helpers import delete_tax_advantaged_category_for_owner
from app.routes.tax_advantaged_categories.tac_category_detail_helpers import get_tax_advantaged_category_with_metrics_for_owner
from app.routes.tax_advantaged_categories.tac_category_listing_helpers import get_tax_advantaged_categories_with_metrics_for_owner
from app.routes.tax_advantaged_categories.tac_category_update_helpers import update_tax_advantaged_category_with_metrics
from app.routes.tax_advantaged_categories.tac_limit_router import router as tac_limit_router
from app.schemas.tax_advantaged_category import (
    CreateTaxAdvantagedCategoryRequest,
    TaxAdvantagedCategoryResponse,
    UpdateTaxAdvantagedCategoryRequest,
)

router = APIRouter(prefix="/tax-advantaged-categories", tags=["tax-advantaged-categories"])
router.include_router(tac_limit_router)


@router.get("", response_model=list[TaxAdvantagedCategoryResponse])
async def list_tax_advantaged_categories(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return tax-advantaged categories owned by the authenticated user

    Args:
        user: Authenticated user
        db: Active database session

    Returns:
        Tax-advantaged categories owned by the authenticated user with current-year limits attached
    """
    tax_advantaged_categories = await get_tax_advantaged_categories_with_metrics_for_owner(db, user.id)
    return tax_advantaged_categories


@router.post("", response_model=TaxAdvantagedCategoryResponse, status_code=status.HTTP_201_CREATED)
async def create_tax_advantaged_category(
    data: CreateTaxAdvantagedCategoryRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create a tax-advantaged category owned by the authenticated user

    Args:
        data: Tax-advantaged category creation payload
        user: Authenticated user
        db: Active database session

    Returns:
        Created tax-advantaged category with current-year limits attached

    Raises:
        HTTPException: Tax treatment, group scope, or currency is invalid
    """
    tax_advantaged_category = await create_tax_advantaged_category_with_metrics(db, user.id, data)
    return tax_advantaged_category


@router.get("/{tax_advantaged_category_id}", response_model=TaxAdvantagedCategoryResponse)
async def get_tax_advantaged_category(
    tax_advantaged_category_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return an owned tax-advantaged category

    Args:
        tax_advantaged_category_id: Tax-advantaged category identifier to fetch
        user: Authenticated user
        db: Active database session

    Returns:
        Owned tax-advantaged category with current-year limits attached

    Raises:
        HTTPException: Tax-advantaged category does not exist or belongs to another user
    """
    tax_advantaged_category = await get_tax_advantaged_category_with_metrics_for_owner(db, tax_advantaged_category_id, user.id)
    return tax_advantaged_category


@router.patch("/{tax_advantaged_category_id}", response_model=TaxAdvantagedCategoryResponse)
async def update_tax_advantaged_category(
    tax_advantaged_category_id: uuid.UUID,
    data: UpdateTaxAdvantagedCategoryRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update an owned tax-advantaged category

    Args:
        tax_advantaged_category_id: Tax-advantaged category identifier to update
        data: Partial tax-advantaged category update payload
        user: Authenticated user
        db: Active database session

    Returns:
        Updated tax-advantaged category with current-year limits attached

    Raises:
        HTTPException: Tax-advantaged category is inaccessible or a supplied field is invalid
    """
    tax_advantaged_category = await update_tax_advantaged_category_with_metrics(db, tax_advantaged_category_id, user.id, data)
    return tax_advantaged_category


@router.delete("/{tax_advantaged_category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tax_advantaged_category(
    tax_advantaged_category_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete an owned tax-advantaged category

    Args:
        tax_advantaged_category_id: Tax-advantaged category identifier to delete
        user: Authenticated user
        db: Active database session

    Raises:
        HTTPException: Tax-advantaged category does not exist or belongs to another user
    """
    await delete_tax_advantaged_category_for_owner(db, tax_advantaged_category_id, user.id)
