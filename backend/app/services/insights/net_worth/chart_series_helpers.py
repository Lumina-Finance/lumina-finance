"""Chart series loading helpers for the insights net worth card"""

import uuid
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account, AccountBalanceSnapshot
from app.models.currency import Currency
from app.schemas.fx import FxStatus
from app.services.fx import FxConverter
from app.services.insights.net_worth.bucket_helpers import build_net_worth_buckets
from app.services.insights.net_worth.groups import (
    NET_WORTH_GROUP_INDEX_BY_ID,
    NET_WORTH_GROUPS,
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
    converter = FxConverter(
        currency_exponents=await _get_currency_exponents(
            db,
            {base_currency, *(account.currency for account in accounts)},
        ),
    )
    await _prefetch_net_worth_rates(
        converter,
        accounts=accounts,
        buckets=buckets,
        base_currency=base_currency,
        baseline_date=baseline_date,
    )
    baseline_balances = await _get_account_balances_at(db, account_ids, baseline_date)
    baseline_values = await _get_grouped_values_from_balances(
        accounts,
        group_index_by_account_id,
        baseline_balances,
        base_currency=base_currency,
        rate_date=baseline_date,
        converter=converter,
    )
    first_bucket_start = buckets[0][0]

    # Load each account's latest balance before the first bucket so chart rows can carry values forward
    anchor_result = await db.execute(
        select(AccountBalanceSnapshot.account_id, AccountBalanceSnapshot.balance)
        .where(
            AccountBalanceSnapshot.account_id.in_(account_ids),
            AccountBalanceSnapshot.dt < first_bucket_start,
        )
        .order_by(AccountBalanceSnapshot.account_id, AccountBalanceSnapshot.dt.desc())
        .distinct(AccountBalanceSnapshot.account_id),
    )
    running = {row.account_id: int(row.balance) for row in anchor_result}
    for account_id in account_ids:
        running.setdefault(account_id, 0)

    # Load all in-range balance snapshots once, then walk them into bucket values in date order
    snapshot_result = await db.execute(
        select(
            AccountBalanceSnapshot.account_id,
            AccountBalanceSnapshot.balance,
            AccountBalanceSnapshot.dt,
        )
        .where(
            AccountBalanceSnapshot.account_id.in_(account_ids),
            AccountBalanceSnapshot.dt >= first_bucket_start,
            AccountBalanceSnapshot.dt <= to_date,
        )
        .order_by(AccountBalanceSnapshot.dt, AccountBalanceSnapshot.account_id),
    )
    snapshots = list(snapshot_result)
    snapshot_index = 0
    chart_rows: list[tuple[date, date, list[int]]] = []

    # Carry account balances forward through buckets and convert each bucket's grouped values
    for label_date, value_date in buckets:
        while snapshot_index < len(snapshots) and snapshots[snapshot_index].dt <= value_date:
            snapshot = snapshots[snapshot_index]
            running[snapshot.account_id] = int(snapshot.balance)
            snapshot_index += 1

        values = await _get_grouped_values_from_balances(
            accounts,
            group_index_by_account_id,
            running,
            base_currency=base_currency,
            rate_date=value_date,
            converter=converter,
        )
        chart_rows.append((label_date, value_date, values))

    return baseline_values, chart_rows, converter.get_status()


async def _get_account_balances_at(
    db: AsyncSession,
    account_ids: list[uuid.UUID],
    target_date: date,
) -> dict[uuid.UUID, int]:
    """Return latest account balances on or before a target date

    Args:
        db: Active database session
        account_ids: Account IDs included in the lookup
        target_date: Latest snapshot date allowed in the lookup

    Returns:
        Balance amount keyed by account ID
    """
    if not account_ids:
        return {}

    # Fetch the latest snapshot for each account on or before the requested date
    result = await db.execute(
        select(AccountBalanceSnapshot.account_id, AccountBalanceSnapshot.balance)
        .where(
            AccountBalanceSnapshot.account_id.in_(account_ids),
            AccountBalanceSnapshot.dt <= target_date,
        )
        .order_by(AccountBalanceSnapshot.account_id, AccountBalanceSnapshot.dt.desc())
        .distinct(AccountBalanceSnapshot.account_id),
    )
    return {row.account_id: int(row.balance) for row in result}


async def _get_grouped_values_from_balances(
    accounts: list[Account],
    group_index_by_account_id: dict[uuid.UUID, int],
    balances: dict[uuid.UUID, int],
    *,
    base_currency: str,
    rate_date: date,
    converter: FxConverter,
) -> list[int]:
    """Return grouped converted balance values for one chart date

    Args:
        accounts: Accounts included in the chart
        group_index_by_account_id: Net worth group indexes keyed by account ID
        balances: Balance amounts keyed by account ID
        base_currency: User base currency used for converted values
        rate_date: Date used for FX conversion
        converter: FX converter used for balance conversion

    Returns:
        Converted grouped values in net worth group order
    """
    values = [0] * len(NET_WORTH_GROUPS)

    # Convert each account balance and add it to the account's configured net worth group
    for account in accounts:
        converted_balance = await converter.convert_minor_units(
            int(balances.get(account.id, 0)),
            base=account.currency,
            quote=base_currency,
            rate_date=rate_date,
        )
        if converted_balance is None:
            continue

        group_index = group_index_by_account_id[account.id]
        values[group_index] += converted_balance
    return values


async def _get_currency_exponents(db: AsyncSession, currencies: set[str]) -> dict[str, int]:
    """Return minor-unit exponents keyed by currency code

    Args:
        db: Active database session
        currencies: Currency codes needed for conversion

    Returns:
        Minor-unit exponent keyed by currency code
    """
    # Load currency precision so FX conversion can convert minor units correctly
    result = await db.execute(
        select(Currency.id, Currency.minor_unit_exponent).where(Currency.id.in_(currencies)),
    )
    return {row.id: row.minor_unit_exponent for row in result}


async def _prefetch_net_worth_rates(
    converter: FxConverter,
    *,
    accounts: list[Account],
    buckets: list[tuple[date, date]],
    base_currency: str,
    baseline_date: date,
) -> None:
    """Prefetch FX rates needed for net worth chart conversion

    Args:
        converter: FX converter used by the net worth chart calculation
        accounts: Accounts included in the chart
        buckets: Chart buckets whose value dates may require conversion
        base_currency: User base currency used for converted values
        baseline_date: Date immediately before the selected range

    Returns:
        None
    """
    if not buckets:
        return

    start_date = min(baseline_date, *(value_date for _label_date, value_date in buckets))
    end_date = max(value_date for _label_date, value_date in buckets)
    for currency in sorted({account.currency for account in accounts if account.currency != base_currency}):
        await converter.prefetch_rates(
            base=currency,
            quote=base_currency,
            start_date=start_date,
            end_date=end_date,
        )
