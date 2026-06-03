"""Net worth service for the insights page."""

import uuid
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account, AccountBalanceSnapshot
from app.models.base import AccountKind, AccountType
from app.models.currency import Currency
from app.models.user import User
from app.schemas.fx import FxStatus
from app.schemas.insights import InsightsNetWorthResponse, NetWorthGroupKind
from app.services.dashboard import get_accessible_accounts
from app.services.fx import FxConverter

NetWorthGranularity = Literal["day", "week", "month"]

_MONTHLY_RANGE_DAY_COUNT = 31
_HALF_YEAR_DAY_COUNT = 183


@dataclass(frozen=True)
class NetWorthGroup:
    id: str
    name: str
    kind: NetWorthGroupKind


NET_WORTH_GROUPS: tuple[NetWorthGroup, ...] = (
    NetWorthGroup("cash", "Cash", "asset"),
    NetWorthGroup("term_deposits", "Term Deposits", "asset"),
    NetWorthGroup("investments", "Investments", "asset"),
    NetWorthGroup("other_assets", "Other Assets", "asset"),
    NetWorthGroup("revolving_debt", "Revolving Debt", "debt"),
    NetWorthGroup("loans", "Loans", "debt"),
    NetWorthGroup("mortgages", "Mortgages", "debt"),
    NetWorthGroup("other_debt", "Other Debt", "debt"),
)

GROUP_INDEX_BY_ID = {group.id: index for index, group in enumerate(NET_WORTH_GROUPS)}


def _get_granularity(from_date: date, to_date: date) -> NetWorthGranularity:
    """Return the Insights net worth chart bucket cadence."""
    day_count = (to_date - from_date).days + 1
    if day_count <= _MONTHLY_RANGE_DAY_COUNT:
        return "day"
    if day_count <= _HALF_YEAR_DAY_COUNT:
        return "week"
    return "month"


def _bucket_start(target: date, granularity: NetWorthGranularity) -> date:
    if granularity == "day":
        return target
    if granularity == "week":
        return target - timedelta(days=target.weekday())
    return date(target.year, target.month, 1)


def _next_bucket_start(target: date, granularity: NetWorthGranularity) -> date:
    if granularity == "day":
        return target + timedelta(days=1)
    if granularity == "week":
        return target + timedelta(days=7)
    if target.month == 12:
        return date(target.year + 1, 1, 1)
    return date(target.year, target.month + 1, 1)


def _build_buckets(from_date: date, to_date: date) -> list[tuple[date, date]]:
    """Return `(label_date, value_date)` buckets using account-detail semantics."""
    granularity = _get_granularity(from_date, to_date)
    buckets: list[tuple[date, date]] = []
    cursor = _bucket_start(from_date, granularity)
    while cursor <= to_date:
        next_start = _next_bucket_start(cursor, granularity)
        value_date = min(next_start - timedelta(days=1), to_date)
        buckets.append((cursor, value_date))
        cursor = next_start
    return buckets


def _group_id_for_account(account: Account) -> str:
    if account.account_kind == AccountKind.ASSET:
        if account.account_type in {AccountType.CHECKING, AccountType.SAVINGS, AccountType.CASH}:
            return "cash"
        if account.account_type == AccountType.TERM_DEPOSIT:
            return "term_deposits"
        if account.account_type == AccountType.INVESTMENT:
            return "investments"
        return "other_assets"

    if account.account_type in {AccountType.CREDIT_CARD, AccountType.LINE_OF_CREDIT, AccountType.HELOC}:
        return "revolving_debt"
    if account.account_type == AccountType.LOAN:
        return "loans"
    if account.account_type == AccountType.MORTGAGE:
        return "mortgages"
    return "other_debt"


async def _query_net_worth_points(
    db: AsyncSession,
    accounts: list[Account],
    base_currency: str,
    from_date: date,
    to_date: date,
) -> tuple[list[int], list[tuple[date, date, list[int]]], FxStatus]:
    """Return signed grouped balances converted to base currency for each chart bucket."""
    buckets = _build_buckets(from_date, to_date)
    if not accounts or not buckets:
        return [], [], FxStatus()

    account_ids = [account.id for account in accounts]
    group_index_by_account_id = {
        account.id: GROUP_INDEX_BY_ID[_group_id_for_account(account)]
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
    baseline_balances = await _balances_at(db, account_ids, baseline_date)
    baseline_values = await _grouped_values_from_balances(
        accounts,
        group_index_by_account_id,
        baseline_balances,
        base_currency=base_currency,
        rate_date=baseline_date,
        converter=converter,
    )
    first_bucket_start = buckets[0][0]
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
    points: list[tuple[date, date, list[int]]] = []

    for label_date, value_date in buckets:
        while snapshot_index < len(snapshots) and snapshots[snapshot_index].dt <= value_date:
            snapshot = snapshots[snapshot_index]
            running[snapshot.account_id] = int(snapshot.balance)
            snapshot_index += 1

        values = await _grouped_values_from_balances(
            accounts,
            group_index_by_account_id,
            running,
            base_currency=base_currency,
            rate_date=value_date,
            converter=converter,
        )
        points.append((label_date, value_date, values))

    return baseline_values, points, converter.get_status()


async def _balances_at(
    db: AsyncSession,
    account_ids: list[uuid.UUID],
    target_date: date,
) -> dict[uuid.UUID, int]:
    """Return latest balances on or before target_date keyed by account id."""
    if not account_ids:
        return {}

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


async def _grouped_values_from_balances(
    accounts: list[Account],
    group_index_by_account_id: dict[uuid.UUID, int],
    balances: dict[uuid.UUID, int],
    *,
    base_currency: str,
    rate_date: date,
    converter: FxConverter,
) -> list[int]:
    values = [0] * len(NET_WORTH_GROUPS)
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


async def get_net_worth(
    db: AsyncSession,
    user: User,
    from_date: date,
    to_date: date,
) -> InsightsNetWorthResponse:
    """Return compact grouped net worth history for the insights card."""
    accounts = await get_accessible_accounts(db, user)
    if not accounts:
        return InsightsNetWorthResponse(groups=[], points=[])

    baseline, points, fx_status = await _query_net_worth_points(db, accounts, user.base_currency, from_date, to_date)
    active_group_indexes = [
        index
        for index in range(len(NET_WORTH_GROUPS))
        if baseline[index] != 0 or any(point_values[index] != 0 for _label_date, _value_date, point_values in points)
    ]
    if not active_group_indexes:
        return InsightsNetWorthResponse(groups=[], points=[], fx_status=fx_status)

    return InsightsNetWorthResponse(
        groups=[
            (NET_WORTH_GROUPS[index].id, NET_WORTH_GROUPS[index].name, NET_WORTH_GROUPS[index].kind)
            for index in active_group_indexes
        ],
        baseline=[baseline[index] for index in active_group_indexes],
        points=[
            (
                label_date,
                value_date,
                [point_values[index] for index in active_group_indexes],
            )
            for label_date, value_date, point_values in points
        ],
        fx_status=fx_status,
    )
