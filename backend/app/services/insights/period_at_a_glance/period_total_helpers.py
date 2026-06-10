"""Income and expense total helpers for the insights Period At A Glance card"""

import uuid
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.transaction import Transaction
from app.schemas.fx import FxStatus
from app.services.fx import FxConverter
from app.services.fx.currency_exponent_helpers import get_currency_exponents
from app.services.insights.period_at_a_glance.conversion_helpers import prefetch_period_at_a_glance_rates


async def get_period_at_a_glance_income_expense_totals(
    db: AsyncSession,
    accounts: list[Account],
    base_currency: str,
    from_date: date,
    to_date: date,
) -> tuple[int, int, FxStatus]:
    """Return sign-directed income and expense totals converted to base currency

    Args:
        db: Active database session
        accounts: Accounts included in the Period At A Glance summary
        base_currency: User base currency used for converted values
        from_date: Inclusive period start date
        to_date: Inclusive period end date

    Returns:
        Income total, expense total, and FX conversion status
    """
    if not accounts:
        return 0, 0, FxStatus()

    account_ids = [account.id for account in accounts]

    # Load transaction totals grouped by category, account, transaction date, and account currency
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
        currency_exponents=await get_currency_exponents(
            db,
            {base_currency, *(account.currency for account in accounts)},
        ),
    )
    await prefetch_period_at_a_glance_rates(
        converter,
        rows=rows,
        base_currency=base_currency,
    )

    category_totals: dict[uuid.UUID, int] = {}

    # Convert each grouped transaction total before netting categories into income and expenses
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

    # Split signed category net totals into display income and expense amounts
    for total in category_totals.values():
        if total > 0:
            income += total
        elif total < 0:
            expenses += -total

    return income, expenses, converter.get_status()
