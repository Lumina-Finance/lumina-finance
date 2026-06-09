"""Account tax-advantaged plan link validation helpers"""
import uuid
from collections.abc import Mapping
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account, TaxAdvantagedPlan
from app.models.base import AccountKind, TaxTreatment
from app.models.group import GroupMember
from app.routes.accounts.account_creation_scope_helpers import AccountCreationScope
from app.schemas.account import CreateAccountRequest


async def validate_create_account_tax_advantaged_plan_link(
    db: AsyncSession,
    data: CreateAccountRequest,
    creation_scope: AccountCreationScope,
    acting_user_id: uuid.UUID,
) -> None:
    """Validate tax-advantaged plan linking for account creation

    Args:
        db: Active database session
        data: Account creation request body
        creation_scope: Resolved ownership and date-anchor details
        acting_user_id: Authenticated user making the change

    Raises:
        HTTPException: Plan is missing, inaccessible, or incompatible with the account
    """
    await validate_tax_advantaged_plan_link(
        db,
        data.tax_advantaged_plan_id,
        account_kind=AccountKind(data.account_kind),
        currency=data.currency,
        owner_id=creation_scope.owner_id,
        group_id=creation_scope.group_id,
        acting_user_id=acting_user_id,
    )


async def validate_update_account_tax_advantaged_plan_link(
    db: AsyncSession,
    account: Account,
    updates: Mapping[str, Any],
    acting_user_id: uuid.UUID,
) -> None:
    """Validate tax-advantaged plan linking for account updates

    Args:
        db: Active database session
        account: Account being updated
        updates: Explicit fields from the account update request
        acting_user_id: Authenticated user making the change

    Raises:
        HTTPException: Plan is missing, inaccessible, or incompatible with the account
    """
    if "tax_advantaged_plan_id" not in updates:
        return

    await validate_tax_advantaged_plan_link(
        db,
        updates["tax_advantaged_plan_id"],
        account_kind=account.account_kind,
        currency=account.currency,
        owner_id=account.owner_id,
        group_id=account.group_id,
        acting_user_id=acting_user_id,
    )


async def validate_tax_advantaged_plan_link(
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

    # Fetch the plan so account-link validation can check ownership, scope, and currency
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

    # Confirm the plan owner still belongs to the target account group
    owner_membership = await db.get(GroupMember, (group_id, plan.plan_owner_user_id))
    if not owner_membership:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid tax-advantaged plan")
