"""Period glance service for the insights page."""

import uuid
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account, AccountBalanceSnapshot
from app.models.base import AccountKind, CategoryKind
from app.models.category import Category
from app.models.currency import Currency
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.fx import FxStatus
from app.schemas.insights import InsightsPeriodGlanceResponse
from app.services.dashboard import get_accessible_accounts
from app.services.fx import FxConverter
from app.services.insights.common import previous_period_bounds

CategoryNetTotals = dict[uuid.UUID, tuple[str, CategoryKind, int]]


async def _query_period_totals(
    db: AsyncSession,
    accounts: list[Account],
    base_currency: str,
    from_date: date,
    to_date: date,
) -> tuple[int, int, FxStatus]:
    """Return sign-directed income and expense totals converted to base currency."""
    if not accounts:
        return 0, 0, FxStatus()

    account_ids = [account.id for account in accounts]
    result = await db.execute(
        select(
            Category.id,
            Transaction.account_id,
            Transaction.dt.label("date"),
            Account.currency.label("account_currency"),
            func.sum(Transaction.amount).label("total"),
        )
        .join(Category, Transaction.category_id == Category.id)
        .join(Account, Transaction.account_id == Account.id)
        .where(
            Transaction.account_id.in_(account_ids),
            Category.kind.in_([CategoryKind.INCOME, CategoryKind.EXPENSE]),
            Transaction.dt >= from_date,
            Transaction.dt <= to_date,
        )
        .group_by(Category.id, Transaction.account_id, Transaction.dt, Account.currency),
    )
    rows = result.all()
    converter = FxConverter(
        currency_exponents=await _get_currency_exponents(
            db,
            {base_currency, *(account.currency for account in accounts)},
        ),
    )
    await _prefetch_period_total_rates(
        converter,
        rows=rows,
        base_currency=base_currency,
    )

    category_totals: dict[uuid.UUID, int] = {}
    for row in rows:
        converted_total = await converter.convert_minor_units(
            int(row.total or 0),
            base=row.account_currency,
            quote=base_currency,
            rate_date=row.date,
        )
        if converted_total is None:
            continue
        category_totals[row.id] = category_totals.get(row.id, 0) + converted_total

    income = 0
    expenses = 0
    for total in category_totals.values():
        if total > 0:
            income += total
        elif total < 0:
            expenses += -total

    return income, expenses, converter.get_status()


async def _get_currency_exponents(db: AsyncSession, currencies: set[str]) -> dict[str, int]:
    result = await db.execute(
        select(Currency.id, Currency.minor_unit_exponent).where(Currency.id.in_(currencies)),
    )
    return {row.id: row.minor_unit_exponent for row in result}


async def _prefetch_period_total_rates(
    converter: FxConverter,
    *,
    rows,
    base_currency: str,
) -> None:
    ranges: dict[str, tuple[date, date]] = {}
    for row in rows:
        currency = row.account_currency
        if currency == base_currency:
            continue
        start, end = ranges.get(currency, (row.date, row.date))
        ranges[currency] = (min(start, row.date), max(end, row.date))

    for currency, (start_date, end_date) in sorted(ranges.items()):
        await converter.prefetch_rates(
            base=currency,
            quote=base_currency,
            start_date=start_date,
            end_date=end_date,
        )


async def _query_category_net_totals(
    db: AsyncSession,
    accounts: list[Account],
    base_currency: str,
    from_date: date,
    to_date: date,
    converter: FxConverter,
) -> CategoryNetTotals:
    """Return converted signed category totals keyed by category id for an inclusive period."""
    if not accounts:
        return {}

    account_ids = [account.id for account in accounts]
    result = await db.execute(
        select(
            Category.id,
            Category.name,
            Category.kind,
            Transaction.account_id,
            Transaction.dt.label("date"),
            Account.currency.label("account_currency"),
            func.sum(Transaction.amount).label("total"),
        )
        .join(Category, Transaction.category_id == Category.id)
        .join(Account, Transaction.account_id == Account.id)
        .where(
            Transaction.account_id.in_(account_ids),
            Category.kind.in_([CategoryKind.INCOME, CategoryKind.EXPENSE]),
            Transaction.dt >= from_date,
            Transaction.dt <= to_date,
        )
        .group_by(Category.id, Category.name, Category.kind, Transaction.account_id, Transaction.dt, Account.currency),
    )
    rows = result.all()
    await _prefetch_period_total_rates(
        converter,
        rows=rows,
        base_currency=base_currency,
    )

    raw_totals: dict[uuid.UUID, tuple[str, CategoryKind, int]] = {}
    for row in rows:
        converted_total = await converter.convert_minor_units(
            int(row.total or 0),
            base=row.account_currency,
            quote=base_currency,
            rate_date=row.date,
        )
        if converted_total is None:
            continue
        name, kind, current_total = raw_totals.get(row.id, (row.name, row.kind, 0))
        raw_totals[row.id] = (name, kind, current_total + converted_total)

    return {
        category_id: (name, kind, amount)
        for category_id, (name, kind, amount) in raw_totals.items()
        if amount
    }


def _expense_totals_from_category_net_totals(
    category_totals: CategoryNetTotals,
) -> dict[uuid.UUID, tuple[str, int]]:
    """Return positive expense-side totals keyed by category id."""
    totals: dict[uuid.UUID, tuple[str, int]] = {}
    for category_id, (name, _kind, total) in category_totals.items():
        amount = max(-total, 0)
        if amount:
            totals[category_id] = (name, amount)
    return totals


def _top_category(
    current_totals: dict[uuid.UUID, tuple[str, int]],
) -> tuple[str, int | None] | None:
    """Return the largest current expense category, if present."""
    if not current_totals:
        return None
    total_positive_expenses = sum(amount for _name, amount in current_totals.values())
    name, amount = sorted(current_totals.values(), key=lambda item: (-item[1], item[0]))[0]
    return name, round((amount / total_positive_expenses) * 100) if total_positive_expenses > 0 else None


def _biggest_category_change(
    current_totals: CategoryNetTotals,
    previous_totals: CategoryNetTotals,
) -> tuple[str, int, int | None] | None:
    """Return the tracked category with the largest comparable dollar change."""
    category_ids = [
        category_id
        for category_id in set(current_totals) | set(previous_totals)
        if _is_change_candidate(category_id, current_totals, previous_totals)
    ]
    if not category_ids:
        return None

    def change_sort_key(candidate: uuid.UUID) -> tuple[int, str]:
        name, kind = _category_identity(candidate, current_totals, previous_totals)
        current_amount = current_totals.get(candidate, ("", kind, 0))[2]
        previous_amount = previous_totals.get(candidate, ("", kind, 0))[2]
        return -abs(_category_change_amount(kind, current_amount, previous_amount)), name

    category_id = sorted(category_ids, key=change_sort_key)[0]
    name, kind = _category_identity(category_id, current_totals, previous_totals)
    current_amount = current_totals.get(category_id, ("", kind, 0))[2]
    previous_amount = previous_totals.get(category_id, ("", kind, 0))[2]
    change_amount = _category_change_amount(kind, current_amount, previous_amount)
    previous_basis = _category_change_basis(kind, current_amount, previous_amount)
    change_pct = round((change_amount / previous_basis) * 100) if previous_basis > 0 else None
    return name, change_amount, change_pct


def _category_identity(
    category_id: uuid.UUID,
    current_totals: CategoryNetTotals,
    previous_totals: CategoryNetTotals,
) -> tuple[str, CategoryKind]:
    name, kind, _amount = current_totals.get(
        category_id,
        previous_totals.get(category_id, ("", CategoryKind.EXPENSE, 0)),
    )
    return name, kind


def _is_change_candidate(
    category_id: uuid.UUID,
    current_totals: CategoryNetTotals,
    previous_totals: CategoryNetTotals,
) -> bool:
    _name, kind = _category_identity(category_id, current_totals, previous_totals)
    current_amount = current_totals.get(category_id, ("", kind, 0))[2]
    previous_amount = previous_totals.get(category_id, ("", kind, 0))[2]

    if kind == CategoryKind.INCOME:
        return current_amount < 0
    return current_amount != 0 or previous_amount != 0


def _category_change_amount(kind: CategoryKind, current_amount: int, previous_amount: int) -> int:
    if kind == CategoryKind.EXPENSE and current_amount <= 0 and previous_amount <= 0:
        return (-current_amount) - (-previous_amount)
    return current_amount - previous_amount


def _category_change_basis(kind: CategoryKind, current_amount: int, previous_amount: int) -> int:
    if previous_amount == 0:
        return 0
    if kind == CategoryKind.EXPENSE and current_amount <= 0 and previous_amount <= 0:
        return -previous_amount
    return abs(previous_amount)


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


async def _query_net_worth_change(
    db: AsyncSession,
    accounts: list[Account],
    base_currency: str,
    from_date: date,
    to_date: date,
) -> tuple[int, FxStatus]:
    """Return converted net-worth movement between the two valuation dates."""
    if not accounts:
        return 0, FxStatus()

    account_ids = [account.id for account in accounts]
    start_balances = await _balances_at(db, account_ids, from_date)
    end_balances = await _balances_at(db, account_ids, to_date)
    converter = FxConverter(
        currency_exponents=await _get_currency_exponents(
            db,
            {base_currency, *(account.currency for account in accounts)},
        ),
    )
    await _prefetch_net_worth_change_rates(
        converter,
        base_currency=base_currency,
        required_dates_by_currency=_net_worth_change_rate_dates(
            accounts,
            base_currency=base_currency,
            start_balances=start_balances,
            end_balances=end_balances,
            from_date=from_date,
            to_date=to_date,
        ),
    )

    net_worth_change = 0
    for account in accounts:
        sign = 1 if account.account_kind == AccountKind.ASSET else -1
        start_amount = start_balances.get(account.id, 0) * sign
        end_amount = end_balances.get(account.id, 0) * sign
        converted_start = await converter.convert_minor_units(
            start_amount,
            base=account.currency,
            quote=base_currency,
            rate_date=from_date,
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
    for currency, target_dates in sorted(required_dates_by_currency.items()):
        for target_date in sorted(target_dates):
            await converter.prefetch_rates(
                base=currency,
                quote=base_currency,
                start_date=target_date,
                end_date=target_date,
            )


def _net_worth_change_rate_dates(
    accounts: list[Account],
    *,
    base_currency: str,
    start_balances: dict[uuid.UUID, int],
    end_balances: dict[uuid.UUID, int],
    from_date: date,
    to_date: date,
) -> dict[str, set[date]]:
    dates_by_currency: dict[str, set[date]] = {}
    for account in accounts:
        if account.currency == base_currency:
            continue
        sign = 1 if account.account_kind == AccountKind.ASSET else -1
        if start_balances.get(account.id, 0) * sign != 0:
            dates_by_currency.setdefault(account.currency, set()).add(from_date)
        if end_balances.get(account.id, 0) * sign != 0:
            dates_by_currency.setdefault(account.currency, set()).add(to_date)
    return dates_by_currency


async def get_period_glance(
    db: AsyncSession,
    user: User,
    from_date: date,
    to_date: date,
) -> InsightsPeriodGlanceResponse:
    """Return compact insight totals for the top period-glance card."""
    previous_from_date, previous_to_date = previous_period_bounds(from_date, to_date)
    all_accounts = await get_accessible_accounts(db, user)

    if not all_accounts:
        return InsightsPeriodGlanceResponse(
            income=0,
            expenses=0,
            net_worth_change=0,
        )

    income, expenses, income_expense_fx_status = await _query_period_totals(
        db,
        all_accounts,
        user.base_currency,
        from_date,
        to_date,
    )
    top_category_converter = FxConverter(
        currency_exponents=await _get_currency_exponents(
            db,
            {user.base_currency, *(account.currency for account in all_accounts)},
        ),
    )
    current_top_category_net_totals = await _query_category_net_totals(
        db,
        all_accounts,
        user.base_currency,
        from_date,
        to_date,
        top_category_converter,
    )
    current_category_totals = _expense_totals_from_category_net_totals(current_top_category_net_totals)
    biggest_change_converter = FxConverter(
        currency_exponents=await _get_currency_exponents(
            db,
            {user.base_currency, *(account.currency for account in all_accounts)},
        ),
    )
    current_category_net_totals = await _query_category_net_totals(
        db,
        all_accounts,
        user.base_currency,
        from_date,
        to_date,
        biggest_change_converter,
    )
    previous_category_net_totals = await _query_category_net_totals(
        db,
        all_accounts,
        user.base_currency,
        previous_from_date,
        previous_to_date,
        biggest_change_converter,
    )
    net_worth_change, net_worth_change_fx_status = await _query_net_worth_change(
        db,
        all_accounts,
        user.base_currency,
        from_date,
        to_date,
    )
    top_category = _top_category(current_category_totals)
    top_category_fx_status = top_category_converter.get_status()
    biggest_change = _biggest_category_change(current_category_net_totals, previous_category_net_totals)
    biggest_change_fx_status = biggest_change_converter.get_status()

    return InsightsPeriodGlanceResponse(
        income=income,
        expenses=expenses,
        income_expense_fx_status=income_expense_fx_status,
        net_worth_change=net_worth_change,
        net_worth_change_fx_status=net_worth_change_fx_status,
        top_category_name=top_category[0] if top_category else None,
        top_category_share_pct=top_category[1] if top_category else None,
        top_category_fx_status=top_category_fx_status,
        biggest_change_name=biggest_change[0] if biggest_change else None,
        biggest_change_amount=biggest_change[1] if biggest_change else None,
        biggest_change_pct=biggest_change[2] if biggest_change else None,
        biggest_change_fx_status=biggest_change_fx_status,
    )
