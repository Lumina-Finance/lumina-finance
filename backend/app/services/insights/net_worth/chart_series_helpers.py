"""Chart series loading helpers for the insights net worth card"""

from datetime import date, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.schemas.fx import FxStatus
from app.services.insights.net_worth.balance_conversion_helpers import (
    build_net_worth_fx_converter,
    get_grouped_net_worth_balance_values,
    prefetch_net_worth_fx_rates,
)
from app.services.insights.net_worth.balance_snapshot_helpers import (
    get_account_balance_snapshots_in_range,
    get_latest_account_balances_before,
    get_latest_account_balances_on_or_before,
)
from app.services.insights.net_worth.bucket_helpers import build_net_worth_buckets
from app.services.insights.net_worth.groups import (
    NET_WORTH_GROUP_INDEX_BY_ID,
    get_net_worth_group_id_for_account,
)


async def get_net_worth_chart_series(
    db: AsyncSession,
    accounts: list[Account],
    base_currency: str,
    from_date: date,
    to_date: date,
) -> tuple[list[int], list[tuple[date, date, list[int]]], FxStatus]:
    """Return signed grouped balances converted to base currency for each chart bucket

    Args:
        db: Active database session
        accounts: Accounts included in the chart
        base_currency: User base currency used for converted values
        from_date: Inclusive chart start date
        to_date: Inclusive chart end date

    Returns:
        Baseline values, chart series rows, and FX conversion status
    """
    buckets = build_net_worth_buckets(from_date, to_date)
    if not accounts or not buckets:
        return [], [], FxStatus()

    account_ids = [account.id for account in accounts]
    group_index_by_account_id = {
        account.id: NET_WORTH_GROUP_INDEX_BY_ID[get_net_worth_group_id_for_account(account)]
        for account in accounts
    }
    baseline_date = from_date - timedelta(days=1)
    converter = await build_net_worth_fx_converter(
        db,
        {base_currency, *(account.currency for account in accounts)},
    )
    await prefetch_net_worth_fx_rates(
        converter,
        accounts=accounts,
        buckets=buckets,
        base_currency=base_currency,
        baseline_date=baseline_date,
    )
    baseline_balances = await get_latest_account_balances_on_or_before(db, account_ids, baseline_date)
    baseline_values = await get_grouped_net_worth_balance_values(
        accounts,
        group_index_by_account_id,
        baseline_balances,
        base_currency=base_currency,
        rate_date=baseline_date,
        converter=converter,
    )
    first_bucket_start = buckets[0][0]

    running = await get_latest_account_balances_before(db, account_ids, first_bucket_start)
    for account_id in account_ids:
        running.setdefault(account_id, 0)

    snapshots = await get_account_balance_snapshots_in_range(db, account_ids, first_bucket_start, to_date)
    snapshot_index = 0
    chart_rows: list[tuple[date, date, list[int]]] = []

    # Carry account balances forward through buckets and convert each bucket's grouped values
    for label_date, value_date in buckets:
        while snapshot_index < len(snapshots) and snapshots[snapshot_index].snapshot_date <= value_date:
            snapshot = snapshots[snapshot_index]
            running[snapshot.account_id] = snapshot.balance
            snapshot_index += 1

        values = await get_grouped_net_worth_balance_values(
            accounts,
            group_index_by_account_id,
            running,
            base_currency=base_currency,
            rate_date=value_date,
            converter=converter,
        )
        chart_rows.append((label_date, value_date, values))

    return baseline_values, chart_rows, converter.get_status()
