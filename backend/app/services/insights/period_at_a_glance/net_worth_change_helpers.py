"""Net-worth movement helpers for the insights Period At A Glance card"""

import uuid
from datetime import date, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.schemas.fx import FxStatus
from app.services.fx import FxConverter
from app.services.insights.net_worth.balance_conversion_helpers import build_net_worth_fx_converter
from app.services.insights.net_worth.balance_snapshot_helpers import get_latest_account_balances_on_or_before


async def get_period_at_a_glance_net_worth_change(
    db: AsyncSession,
    accounts: list[Account],
    base_currency: str,
    from_date: date,
    to_date: date,
) -> tuple[int, FxStatus]:
    """Return converted net-worth movement over the inclusive Period At A Glance range

    Args:
        db: Active database session
        accounts: Accounts included in the Period At A Glance summary
        base_currency: User base currency used for converted values
        from_date: Inclusive period start date
        to_date: Inclusive period end date

    Returns:
        Converted net-worth movement and FX conversion status
    """
    if not accounts:
        return 0, FxStatus()

    account_ids = [account.id for account in accounts]
    baseline_date = from_date - timedelta(days=1)
    start_balances = await get_latest_account_balances_on_or_before(db, account_ids, baseline_date)
    end_balances = await get_latest_account_balances_on_or_before(db, account_ids, to_date)
    converter = await build_net_worth_fx_converter(
        db,
        {base_currency, *(account.currency for account in accounts)},
    )
    await _prefetch_net_worth_change_rates(
        converter,
        base_currency=base_currency,
        required_dates_by_currency=_get_net_worth_change_rate_dates(
            accounts,
            base_currency=base_currency,
            start_balances=start_balances,
            end_balances=end_balances,
            baseline_date=baseline_date,
            to_date=to_date,
        ),
    )

    net_worth_change = 0

    # Convert each account's starting and ending balances, then add the movement to the total
    for account in accounts:
        start_amount = start_balances.get(account.id, 0)
        end_amount = end_balances.get(account.id, 0)
        converted_start = await converter.convert_minor_units(
            start_amount,
            base=account.currency,
            quote=base_currency,
            rate_date=baseline_date,
        )
        converted_end = await converter.convert_minor_units(
            end_amount,
            base=account.currency,
            quote=base_currency,
            rate_date=to_date,
        )
        if converted_start is None or converted_end is None:
            continue
        net_worth_change += converted_end - converted_start

    return net_worth_change, converter.get_status()


async def _prefetch_net_worth_change_rates(
    converter: FxConverter,
    *,
    base_currency: str,
    required_dates_by_currency: dict[str, set[date]],
) -> None:
    """Prefetch FX rates needed for net-worth change conversion

    Args:
        converter: FX converter used by the Period At A Glance net-worth calculation
        base_currency: User base currency used for converted values
        required_dates_by_currency: Exact conversion dates keyed by account currency

    Returns:
        None
    """
    # Load exact-date rates before converting balances so missing FX status is complete
    for currency, target_dates in sorted(required_dates_by_currency.items()):
        for target_date in sorted(target_dates):
            await converter.prefetch_rates(
                base=currency,
                quote=base_currency,
                start_date=target_date,
                end_date=target_date,
            )


def _get_net_worth_change_rate_dates(
    accounts: list[Account],
    *,
    base_currency: str,
    start_balances: dict[uuid.UUID, int],
    end_balances: dict[uuid.UUID, int],
    baseline_date: date,
    to_date: date,
) -> dict[str, set[date]]:
    """Return FX rate dates needed for non-base account balances

    Args:
        accounts: Accounts included in the Period At A Glance summary
        base_currency: User base currency used for converted values
        start_balances: Starting balance amounts keyed by account ID
        end_balances: Ending balance amounts keyed by account ID
        baseline_date: Date immediately before the selected period
        to_date: Inclusive period end date

    Returns:
        Exact conversion dates keyed by account currency
    """
    dates_by_currency: dict[str, set[date]] = {}
    for account in accounts:
        if account.currency == base_currency:
            continue
        if start_balances.get(account.id, 0) != 0:
            dates_by_currency.setdefault(account.currency, set()).add(baseline_date)
        if end_balances.get(account.id, 0) != 0:
            dates_by_currency.setdefault(account.currency, set()).add(to_date)
    return dates_by_currency
