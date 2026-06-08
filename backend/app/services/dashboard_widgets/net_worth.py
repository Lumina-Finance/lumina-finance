"""Net worth dashboard widget service"""
import uuid
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account, AccountBalanceSnapshot
from app.models.currency import Currency
from app.schemas.fx import FxStatus
from app.services.fx import FxConverter


async def get_net_worth_history(
    db: AsyncSession,
    accounts: list[Account],
    base_currency: str,
    window_days: int,
    now: datetime,
) -> tuple[int, list[int], FxStatus]:
    """Return current net worth and daily history across the requested window

    Args:
        db: Active database session
        accounts: Accounts included in the dashboard scope
        base_currency: User base currency used for dashboard totals
        window_days: Number of daily history slots to return
        now: Viewer-local timestamp used to derive the history window

    Returns:
        Current net worth, oldest-first daily net worth history, and FX status
    """
    series = [0] * window_days
    if not accounts:
        return 0, series, FxStatus()

    today = now.date()
    window_start = today - timedelta(days=window_days - 1)
    account_ids = [account.id for account in accounts]
    accounts_by_id = {account.id: account for account in accounts}
    converter = FxConverter(
        currency_exponents=await _get_currency_exponents(
            db,
            {base_currency, *(account.currency for account in accounts)},
        ),
    )
    for currency in sorted({account.currency for account in accounts if account.currency != base_currency}):
        await converter.prefetch_rates(
            base=currency,
            quote=base_currency,
            start_date=window_start,
            end_date=today,
        )

    # Anchor each account with its most recent snapshot before the displayed window
    anchor_result = await db.execute(
        select(AccountBalanceSnapshot.account_id, AccountBalanceSnapshot.balance)
        .where(
            AccountBalanceSnapshot.account_id.in_(account_ids),
            AccountBalanceSnapshot.dt < window_start,
        )
        .order_by(AccountBalanceSnapshot.account_id, AccountBalanceSnapshot.dt.desc())
        .distinct(AccountBalanceSnapshot.account_id),
    )
    running_balances: dict[uuid.UUID, int] = {row.account_id: row.balance for row in anchor_result}
    for account_id in account_ids:
        running_balances.setdefault(account_id, 0)

    # Walk in-window snapshots from oldest to newest to build the daily history
    in_window_result = await db.execute(
        select(
            AccountBalanceSnapshot.account_id,
            AccountBalanceSnapshot.balance,
            AccountBalanceSnapshot.dt,
        )
        .where(
            AccountBalanceSnapshot.account_id.in_(account_ids),
            AccountBalanceSnapshot.dt >= window_start,
        )
        .order_by(AccountBalanceSnapshot.dt),
    )
    balance_updates_by_day: dict[date, dict[uuid.UUID, int]] = {}
    for row in in_window_result:
        balance_updates_by_day.setdefault(row.dt, {})[row.account_id] = row.balance

    for day_index in range(window_days):
        current_day = window_start + timedelta(days=day_index)
        if current_day > today:
            break
        for account_id, balance in balance_updates_by_day.get(current_day, {}).items():
            running_balances[account_id] = balance
        series[day_index] = await _sum_converted_balances(
            accounts_by_id,
            running_balances,
            base_currency=base_currency,
            rate_date=current_day,
            converter=converter,
        )

    current_net_worth = await _sum_converted_balances(
        accounts_by_id,
        running_balances,
        base_currency=base_currency,
        rate_date=today,
        converter=converter,
    )
    return current_net_worth, series, converter.get_status()


async def _get_currency_exponents(db: AsyncSession, currencies: set[str]) -> dict[str, int]:
    """Load minor-unit exponents for currency codes

    Args:
        db: Active database session
        currencies: Currency codes to load

    Returns:
        Mapping from currency code to minor-unit exponent
    """
    currency_result = await db.execute(
        select(Currency.id, Currency.minor_unit_exponent).where(Currency.id.in_(currencies)),
    )
    return {row.id: row.minor_unit_exponent for row in currency_result}


async def _sum_converted_balances(
    accounts_by_id: dict[uuid.UUID, Account],
    running_balances: dict[uuid.UUID, int],
    *,
    base_currency: str,
    rate_date: date,
    converter: FxConverter,
) -> int:
    """Sum account balances after converting them into the user's base currency

    Args:
        accounts_by_id: Account rows keyed by account ID
        running_balances: Account balances keyed by account ID
        base_currency: User base currency used for dashboard totals
        rate_date: Date used for FX conversion
        converter: Request-scoped FX converter

    Returns:
        Sum of balances that converted successfully
    """
    total = 0
    for account_id, account in accounts_by_id.items():
        converted_balance = await converter.convert_minor_units(
            running_balances[account_id],
            base=account.currency,
            quote=base_currency,
            rate_date=rate_date,
        )
        if converted_balance is not None:
            total += converted_balance
    return total
