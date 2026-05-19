"""Net worth service for the insights page."""

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account, AccountBalanceSnapshot
from app.models.base import AccountKind, AccountType
from app.models.user import User
from app.schemas.insights import InsightsNetWorthResponse
from app.services.insights.common import get_base_currency_accounts

NetWorthGranularity = Literal["day", "week", "month"]
NetWorthGroupKind = Literal["asset", "debt"]


@dataclass(frozen=True)
class NetWorthGroup:
    id: str
    name: str
    kind: NetWorthGroupKind


NET_WORTH_GROUPS: tuple[NetWorthGroup, ...] = (
    NetWorthGroup("cash", "Cash", "asset"),
    NetWorthGroup("tax_advantaged", "Tax-Advantaged", "asset"),
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
    """Match the account-detail balance chart frequency."""
    day_count = (to_date - from_date).days + 1
    if day_count <= 30:
        return "day"
    if day_count <= 90:
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
        if account.tax_advantaged_plan_id is not None:
            return "tax_advantaged"
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


def _account_contribution(account: Account, balance: int) -> int:
    return balance if account.account_kind == AccountKind.ASSET else -balance


async def _query_net_worth_points(
    db: AsyncSession,
    accounts: list[Account],
    from_date: date,
    to_date: date,
) -> list[tuple[date, date, list[int]]]:
    """Return signed grouped balances for each chart bucket."""
    buckets = _build_buckets(from_date, to_date)
    if not accounts or not buckets:
        return []

    account_ids = [account.id for account in accounts]
    account_by_id = {account.id: account for account in accounts}
    group_index_by_account_id = {
        account.id: GROUP_INDEX_BY_ID[_group_id_for_account(account)]
        for account in accounts
    }
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

        values = [0] * len(NET_WORTH_GROUPS)
        for account_id in account_ids:
            account = account_by_id[account_id]
            group_index = group_index_by_account_id[account_id]
            values[group_index] += _account_contribution(account, running[account_id])
        points.append((label_date, value_date, values))

    return points


async def get_net_worth(
    db: AsyncSession,
    user: User,
    from_date: date,
    to_date: date,
) -> InsightsNetWorthResponse:
    """Return compact grouped net worth history for the insights card."""
    accounts = await get_base_currency_accounts(db, user)
    if not accounts:
        return InsightsNetWorthResponse(groups=[], points=[])

    points = await _query_net_worth_points(db, accounts, from_date, to_date)
    active_group_indexes = [
        index
        for index in range(len(NET_WORTH_GROUPS))
        if any(point_values[index] != 0 for _label_date, _value_date, point_values in points)
    ]
    if not active_group_indexes:
        return InsightsNetWorthResponse(groups=[], points=[])

    return InsightsNetWorthResponse(
        groups=[
            (NET_WORTH_GROUPS[index].id, NET_WORTH_GROUPS[index].name, NET_WORTH_GROUPS[index].kind)
            for index in active_group_indexes
        ],
        points=[
            (
                label_date,
                value_date,
                [point_values[index] for index in active_group_indexes],
            )
            for label_date, value_date, point_values in points
        ],
    )
