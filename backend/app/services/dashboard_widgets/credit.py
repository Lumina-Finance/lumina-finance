"""Credit dashboard widget service"""
import uuid
from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import AccountKind
from app.schemas.fx import FxStatus
from app.services.accounts.snapshots import get_current_balances
from app.services.fx import FxConverter
from app.services.fx.currency_exponent_helpers import get_currency_exponents


def get_credit_widget_accounts(accounts: list[Account]) -> list[Account]:
    """Return the accounts the credit widget can count, sorted by name

    Args:
        accounts: Accounts included in the dashboard scope

    Returns:
        Revolving accounts that have a credit limit
    """
    eligible = [
        account for account in accounts
        if account.account_kind == AccountKind.REVOLVING and account.credit_limit is not None
    ]
    return sorted(eligible, key=lambda account: (account.name.casefold(), account.id))


async def get_credit_widget(
    db: AsyncSession,
    accounts: list[Account],
    excluded_account_ids: set[uuid.UUID],
    base_currency: str,
    rate_date: date,
) -> tuple[int, int, FxStatus]:
    """Return credit limit and usage totals for the eligible accounts the user counts

    Args:
        db: Active database session
        accounts: Accounts included in the dashboard scope
        excluded_account_ids: Accounts the user left out, which may include ones outside `accounts`
        base_currency: User base currency used for dashboard totals
        rate_date: Date used for FX conversion

    Returns:
        Credit limit total, used credit total, and FX conversion status
    """
    credit_accounts = [
        account for account in get_credit_widget_accounts(accounts)
        if account.id not in excluded_account_ids
    ]
    if not credit_accounts:
        fx_status = FxStatus()
        return 0, 0, fx_status

    balances = await get_current_balances(db, [account.id for account in credit_accounts], rate_date)
    converter = FxConverter(
        currency_exponents=await get_currency_exponents(
            db,
            {base_currency, *(account.currency for account in credit_accounts)},
        ),
    )
    for currency in sorted({account.currency for account in credit_accounts if account.currency != base_currency}):
        await converter.prefetch_rates(
            base=currency,
            quote=base_currency,
            start_date=rate_date,
            end_date=rate_date,
        )

    credit_limit_total = 0
    credit_used = 0
    for account in credit_accounts:
        converted_limit = await converter.convert_minor_units(
            account.credit_limit or 0,
            base=account.currency,
            quote=base_currency,
            rate_date=rate_date,
        )
        converted_used = await converter.convert_minor_units(
            max(-balances.get(account.id, 0), 0),
            base=account.currency,
            quote=base_currency,
            rate_date=rate_date,
        )
        if converted_limit is not None:
            credit_limit_total += converted_limit
        if converted_used is not None:
            credit_used += converted_used
    fx_status = converter.get_status()
    return credit_limit_total, credit_used, fx_status
