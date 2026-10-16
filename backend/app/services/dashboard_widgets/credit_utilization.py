"""Dashboard credit widget data that follows the accounts the user chose to count"""

import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.institution import Institution
from app.models.user import User
from app.schemas.dashboard import CreditUtilizationAccount, CreditUtilizationResponse
from app.schemas.institution import InstitutionResponse
from app.services.accounts.access import get_accessible_accounts
from app.services.cache_state import mark_user_cache_changed
from app.services.dashboard_widgets.credit import get_credit_widget, get_credit_widget_accounts
from app.services.dashboard_widgets.credit_exclusions import (
    get_excluded_credit_account_ids,
    replace_excluded_credit_account_ids,
)


async def get_credit_utilization(db: AsyncSession, user: User, rate_date: date) -> CreditUtilizationResponse:
    """Return the credit widget's data, leaving out the accounts the user chose to

    Args:
        db: Active database session
        user: Authenticated user requesting credit utilization
        rate_date: Date used for FX conversion

    Returns:
        Credit totals for the accounts counted, and every account the user can choose between
    """
    accounts = await get_accessible_accounts(db, user)
    return await _build_credit_utilization(db, user, accounts, rate_date)


async def replace_credit_utilization_exclusions(
    db: AsyncSession,
    user: User,
    account_ids: list[uuid.UUID],
    rate_date: date,
) -> CreditUtilizationResponse:
    """Save the credit accounts a user leaves out and return the widget's data as it now reads

    Args:
        db: Active database session
        user: Authenticated user changing the choice
        account_ids: Credit accounts to leave out
        rate_date: Date used for FX conversion

    Returns:
        Credit utilization reflecting the new choice

    Raises:
        HTTPException: A requested account is not a readable credit account with a limit
    """
    accounts = await get_accessible_accounts(db, user)
    await replace_excluded_credit_account_ids(db, user, accounts, set(account_ids))
    await mark_user_cache_changed(db, user.id)
    await db.commit()
    return await _build_credit_utilization(db, user, accounts, rate_date)


async def _build_credit_utilization(
    db: AsyncSession,
    user: User,
    accounts: list[Account],
    rate_date: date,
) -> CreditUtilizationResponse:
    """Build the widget's data from the accounts the user can read

    The chooser lists every card the widget counts, shared and group-managed ones included, which is
    an exception to building for individually owned resources only. The issue's problem is leaving
    out a card shared with someone else, and the stored row is the user's own preference that never
    changes the account
    """
    excluded_account_ids = await get_excluded_credit_account_ids(db, user)
    credit_limit_total, credit_used, fx_status = await get_credit_widget(
        db,
        accounts,
        excluded_account_ids,
        user.base_currency,
        rate_date,
    )
    credit_accounts = get_credit_widget_accounts(accounts)
    institution_ids = {account.institution_id for account in credit_accounts if account.institution_id}
    institutions = {}
    if institution_ids:
        result = await db.execute(select(Institution).where(Institution.id.in_(institution_ids)))
        institutions = {institution.id: institution for institution in result.scalars().all()}
    return CreditUtilizationResponse(
        credit_limit_total=credit_limit_total,
        credit_used=credit_used,
        fx_status=fx_status,
        accounts=[
            CreditUtilizationAccount(
                id=account.id,
                name=account.name,
                is_counted=account.id not in excluded_account_ids,
                account_type=account.account_type,
                institution=(InstitutionResponse.model_validate(institutions[account.institution_id]) if account.institution_id else None),
            )
            for account in credit_accounts
        ],
    )
