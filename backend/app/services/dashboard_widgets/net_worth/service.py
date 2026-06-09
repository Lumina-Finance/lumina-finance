"""Net worth dashboard widget service"""
from datetime import datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.schemas.fx import FxStatus
from app.services.dashboard_widgets.net_worth.balance_conversion_helpers import (
    get_converted_net_worth_balance_total,
    get_dashboard_net_worth_fx_converter,
    prefetch_dashboard_net_worth_fx_rates,
)
from app.services.dashboard_widgets.net_worth.balance_snapshot_helpers import (
    get_net_worth_balance_updates_by_day,
    get_net_worth_starting_balances,
)


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
        current_net_worth = 0
        fx_status = FxStatus()
        return current_net_worth, series, fx_status

    today = now.date()
    window_start = today - timedelta(days=window_days - 1)
    account_ids = [account.id for account in accounts]
    accounts_by_id = {account.id: account for account in accounts}
    converter = await get_dashboard_net_worth_fx_converter(
        db,
        {base_currency, *(account.currency for account in accounts)},
    )
    await prefetch_dashboard_net_worth_fx_rates(
        converter,
        accounts,
        base_currency=base_currency,
        start_date=window_start,
        end_date=today,
    )

    running_balances = await get_net_worth_starting_balances(db, account_ids, window_start)
    balance_updates_by_day = await get_net_worth_balance_updates_by_day(
        db,
        account_ids,
        window_start,
    )

    # Carry balances forward day by day while applying snapshots on their update date
    for day_index in range(window_days):
        current_day = window_start + timedelta(days=day_index)
        if current_day > today:
            break
        for account_id, balance in balance_updates_by_day.get(current_day, {}).items():
            running_balances[account_id] = balance
        series[day_index] = await get_converted_net_worth_balance_total(
            accounts_by_id,
            running_balances,
            base_currency=base_currency,
            rate_date=current_day,
            converter=converter,
        )

    current_net_worth = await get_converted_net_worth_balance_total(
        accounts_by_id,
        running_balances,
        base_currency=base_currency,
        rate_date=today,
        converter=converter,
    )
    fx_status = converter.get_status()
    return current_net_worth, series, fx_status
