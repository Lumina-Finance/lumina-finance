import uuid
from collections.abc import Sequence
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account, TaxAdvantagedPlan, TaxAdvantagedPlanLimit
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.transaction import Transaction
from app.models.user import User

_TAC_TRANSFER_CATEGORY_NAME = "Transfer"


async def attach_tax_advantaged_plan_metrics(
    db: AsyncSession,
    plans: Sequence[TaxAdvantagedPlan],
) -> None:
    """Attach current-year limits and transfer tallies to plan rows.

    Archived linked accounts are included because contribution and withdrawal
    room is historical tax data, not active account availability.

    Args:
        db: Active database session.
        plans: Plan rows to enrich in place.
    """
    if not plans:
        return

    plan_ids = [p.id for p in plans]
    owner_ids = {p.plan_owner_user_id for p in plans}
    owner_result = await db.execute(select(User.id, User.tz).where(User.id.in_(owner_ids)))
    owner_timezones = dict(owner_result.all())
    plan_years = {
        plan.id: datetime.now(ZoneInfo(owner_timezones[plan.plan_owner_user_id])).year
        for plan in plans
    }

    limits: dict[tuple[uuid.UUID, int], tuple[int, int | None]] = {}
    accrued_lifetime_limits: dict[uuid.UUID, int] = {plan.id: 0 for plan in plans}
    has_accrued_limit_rows: set[uuid.UUID] = set()

    result = await db.execute(
        select(
            TaxAdvantagedPlanLimit.plan_id,
            TaxAdvantagedPlanLimit.year,
            TaxAdvantagedPlanLimit.contribution_limit,
            TaxAdvantagedPlanLimit.withdrawal_limit,
        ).where(TaxAdvantagedPlanLimit.plan_id.in_(plan_ids)),
    )
    for row in result:
        limits[(row.plan_id, row.year)] = (row.contribution_limit, row.withdrawal_limit)
        if row.year <= plan_years[row.plan_id]:
            accrued_lifetime_limits[row.plan_id] += row.contribution_limit
            has_accrued_limit_rows.add(row.plan_id)

    for plan in plans:
        row = limits.get((plan.id, plan_years[plan.id]))
        plan.current_year_contribution_limit = row[0] if row else None
        plan.current_year_withdrawal_limit = row[1] if row else None
        if plan.lifetime_contribution_limit is not None and plan.id in has_accrued_limit_rows:
            plan.accrued_lifetime_contribution_limit = min(
                accrued_lifetime_limits[plan.id],
                plan.lifetime_contribution_limit,
            )
        else:
            plan.accrued_lifetime_contribution_limit = None

    positive = Transaction.amount > 0
    negative = Transaction.amount < 0

    tallies: dict[uuid.UUID, dict[str, int]] = {
        plan.id: {
            "ytd_contributions": 0,
            "ytd_withdrawals": 0,
            "lifetime_contributions": 0,
            "lifetime_withdrawals": 0,
        }
        for plan in plans
    }
    result = await db.execute(
        select(
            Account.tax_advantaged_plan_id,
            func.extract("year", Transaction.dt).label("year"),
            func.coalesce(
                func.sum(case((positive, Transaction.amount), else_=0)),
                0,
            ).label("contributions"),
            func.coalesce(
                func.sum(case((negative, -Transaction.amount), else_=0)),
                0,
            ).label("withdrawals"),
        )
        .join(Account, Transaction.account_id == Account.id)
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Account.tax_advantaged_plan_id.in_(plan_ids),
            # Archived accounts remain linked to their plan history.
            Category.kind == CategoryKind.TRANSFER,
            Category.name == _TAC_TRANSFER_CATEGORY_NAME,
        )
        .group_by(Account.tax_advantaged_plan_id, "year"),
    )
    for row in result:
        plan_id = row.tax_advantaged_plan_id
        tallies[plan_id]["lifetime_contributions"] += row.contributions
        tallies[plan_id]["lifetime_withdrawals"] += row.withdrawals
        if int(row.year) == plan_years[plan_id]:
            tallies[plan_id]["ytd_contributions"] += row.contributions
            tallies[plan_id]["ytd_withdrawals"] += row.withdrawals

    for plan in plans:
        row = tallies[plan.id]
        plan.ytd_contributions = row["ytd_contributions"]
        plan.ytd_withdrawals = row["ytd_withdrawals"]
        plan.lifetime_contributions = row["lifetime_contributions"]
        plan.lifetime_withdrawals = row["lifetime_withdrawals"]
