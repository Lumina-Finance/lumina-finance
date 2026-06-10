"""Credit dashboard widget service"""
from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import AccountKind
from app.schemas.fx import FxStatus
from app.services.accounts.snapshots import get_current_balances
from app.services.fx import FxConverter
from app.services.fx.currency_exponent_helpers import get_currency_exponents


async def get_credit_widget(
    db: AsyncSession,
    accounts: list[Account],
    base_currency: str,
    rate_date: date,
) -> tuple[int, int, FxStatus]:
    """Return credit limit and usage totals for eligible accounts

    Args:
        db: Active database session
        accounts: Accounts included in the dashboard scope
        base_currency: User base currency used for dashboard totals
        rate_date: Date used for FX conversion

    Returns:
        Credit limit total, used credit total, and FX conversion status
    """
    credit_accounts = [
        account for account in accounts
        if account.account_kind == AccountKind.REVOLVING and account.credit_limit is not None
    ]
    if not credit_accounts:
        fx_status = FxStatus()
        return 0, 0, fx_status

    balances = await get_current_balances(db, [account.id for account in credit_accounts])
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
