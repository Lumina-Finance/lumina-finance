import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.account import Account, TaxAdvantagedConfig
from app.models.base import PermissionLevel, TaxTreatment
from app.models.user import User
from app.permissions import check_account_access
from app.schemas.tax_advantaged_config import (
    CreateTaxAdvantagedConfigRequest,
    TaxAdvantagedConfigResponse,
    UpdateTaxAdvantagedConfigRequest,
)

router = APIRouter(prefix="/accounts", tags=["tax-advantaged-configs"])


def _require_tax_advantaged(account: Account) -> None:
    """Raise 422 if the account's tax_treatment is TAXABLE.

    Tax-advantaged configs only make sense on accounts with contribution/withdrawal
    rules — applying one to a taxable account is a category error.
    """
    if account.tax_treatment == TaxTreatment.TAXABLE:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Tax-advantaged configs cannot be set on taxable accounts",
        )


async def _get_config_or_404(
    db: AsyncSession, account_id: uuid.UUID, year: int,
) -> TaxAdvantagedConfig:
    """Fetch a config row for an (account, year) pair, or raise 404."""
    result = await db.execute(
        select(TaxAdvantagedConfig).where(
            TaxAdvantagedConfig.account_id == account_id,
            TaxAdvantagedConfig.year == year,
        ),
    )
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tax-advantaged config not found",
        )
    return config


@router.get(
    "/{account_id}/tax-advantaged-configs",
    response_model=list[TaxAdvantagedConfigResponse],
)
async def list_tax_advantaged_configs(
    account_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return all tax-advantaged configs for an account, ordered by year ascending. Requires read access."""
    await check_account_access(db, account_id, user.id, PermissionLevel.READ)

    result = await db.execute(
        select(TaxAdvantagedConfig)
        .where(TaxAdvantagedConfig.account_id == account_id)
        .order_by(TaxAdvantagedConfig.year),
    )
    return result.scalars().all()


@router.post(
    "/{account_id}/tax-advantaged-configs",
    response_model=TaxAdvantagedConfigResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_tax_advantaged_config(
    account_id: uuid.UUID,
    data: CreateTaxAdvantagedConfigRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create a new per-year config row for a tax-advantaged account. Requires admin access."""
    account = await check_account_access(db, account_id, user.id, PermissionLevel.ADMIN)
    _require_tax_advantaged(account)

    existing_result = await db.execute(
        select(TaxAdvantagedConfig).where(
            TaxAdvantagedConfig.account_id == account_id,
            TaxAdvantagedConfig.year == data.year,
        ),
    )
    if existing_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A config for this year already exists",
        )

    config = TaxAdvantagedConfig(
        account_id=account_id,
        year=data.year,
        contribution_limit=data.contribution_limit,
        withdrawal_limit=data.withdrawal_limit,
    )
    db.add(config)
    await db.commit()
    await db.refresh(config)
    return config


@router.patch(
    "/{account_id}/tax-advantaged-configs/{year}",
    response_model=TaxAdvantagedConfigResponse,
)
async def update_tax_advantaged_config(
    account_id: uuid.UUID,
    year: int,
    data: UpdateTaxAdvantagedConfigRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update an existing config row's limits. Requires admin access.

    ``contribution_limit`` cannot be cleared — delete the config row instead.
    ``withdrawal_limit`` is legitimately nullable and may be set to null.
    """
    await check_account_access(db, account_id, user.id, PermissionLevel.ADMIN)
    config = await _get_config_or_404(db, account_id, year)

    updates = data.model_dump(exclude_unset=True)
    if not updates:
        return config

    if "contribution_limit" in updates and updates["contribution_limit"] is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="contribution_limit cannot be cleared; delete the config row instead",
        )

    for field, value in updates.items():
        setattr(config, field, value)

    await db.commit()
    await db.refresh(config)
    return config


@router.delete(
    "/{account_id}/tax-advantaged-configs/{year}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_tax_advantaged_config(
    account_id: uuid.UUID,
    year: int,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete a per-year config row. Requires admin access."""
    await check_account_access(db, account_id, user.id, PermissionLevel.ADMIN)
    config = await _get_config_or_404(db, account_id, year)

    await db.delete(config)
    await db.commit()
