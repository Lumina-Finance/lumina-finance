"""Category total query helpers for the insights Period At A Glance card"""

import uuid
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.transaction import Transaction
from app.services.fx import FxConverter
from app.services.insights.period_at_a_glance.conversion import prefetch_period_at_a_glance_rates

CategoryNetTotals = dict[uuid.UUID, tuple[str, CategoryKind, int]]


async def get_period_at_a_glance_category_net_totals(
    db: AsyncSession,
    accounts: list[Account],
    base_currency: str,
    from_date: date,
    to_date: date,
    converter: FxConverter,
) -> CategoryNetTotals:
    """Return converted signed category totals keyed by category ID for an inclusive period

    Args:
        db: Active database session
        accounts: Accounts included in the Period At A Glance summary
        base_currency: User base currency used for converted values
        from_date: Inclusive period start date
        to_date: Inclusive period end date
        converter: FX converter used for category total conversion

    Returns:
        Signed category totals keyed by category ID
    """
    if not accounts:
        return {}

    account_ids = [account.id for account in accounts]

    # Load signed transaction totals grouped by category, account, transaction date, and account currency
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
    await prefetch_period_at_a_glance_rates(
        converter,
        rows=rows,
        base_currency=base_currency,
    )

    raw_totals: dict[uuid.UUID, tuple[str, CategoryKind, int]] = {}

    # Convert each grouped total before adding it into its signed category net total
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
