"""TAC limit metric helpers"""
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import TaxAdvantagedPlan, TaxAdvantagedPlanLimit
from app.models.user import User


@dataclass(frozen=True)
class TacLimitMetrics:
    """TAC limit values grouped for plan response metric assignment"""

    limit_values_by_plan_year: dict[tuple[uuid.UUID, int], tuple[int, int | None, int, int]]
    accrued_lifetime_contribution_limits: dict[uuid.UUID, int]
    plan_ids_with_accrued_limit_rows: set[uuid.UUID]


async def get_tac_plan_current_years(
    db: AsyncSession,
    plans: Sequence[TaxAdvantagedPlan],
    current_datetime_for_timezone: Callable[[ZoneInfo], datetime],
) -> dict[uuid.UUID, int]:
    """Return the current calendar year for each TAC plan

    Args:
        db: Active database session
        plans: Tax-advantaged plans being enriched
        current_datetime_for_timezone: Clock function for timezone-aware current dates

    Returns:
        Current calendar year keyed by plan identifier
    """
    owner_ids = {plan.plan_owner_user_id for plan in plans}

    # Fetch owner time zones so current-year metrics use each owner's local calendar
    owner_result = await db.execute(select(User.id, User.tz).where(User.id.in_(owner_ids)))
    owner_timezones = dict(owner_result.all())
    current_years_by_plan_id = {
        plan.id: current_datetime_for_timezone(ZoneInfo(owner_timezones[plan.plan_owner_user_id])).year
        for plan in plans
    }
    return current_years_by_plan_id


async def get_tac_limit_metrics(
    db: AsyncSession,
    plan_ids: Sequence[uuid.UUID],
    current_years_by_plan_id: dict[uuid.UUID, int],
) -> TacLimitMetrics:
    """Return configured TAC limit metrics for plan responses

    Args:
        db: Active database session
        plan_ids: Plan identifiers being enriched
        current_years_by_plan_id: Current calendar year keyed by plan identifier

    Returns:
        TAC limit metrics grouped for response assignment
    """
    limit_values_by_plan_year: dict[tuple[uuid.UUID, int], tuple[int, int | None, int, int]] = {}
    accrued_lifetime_contribution_limits: dict[uuid.UUID, int] = dict.fromkeys(plan_ids, 0)
    plan_ids_with_accrued_limit_rows: set[uuid.UUID] = set()

    # Fetch all configured limit rows for the requested plans so current and lifetime fields can be derived together
    limit_result = await db.execute(
        select(
            TaxAdvantagedPlanLimit.plan_id,
            TaxAdvantagedPlanLimit.year,
            TaxAdvantagedPlanLimit.contribution_limit,
            TaxAdvantagedPlanLimit.withdrawal_limit,
            TaxAdvantagedPlanLimit.accrued_contributions,
            TaxAdvantagedPlanLimit.accrued_withdrawals,
        ).where(TaxAdvantagedPlanLimit.plan_id.in_(plan_ids)),
    )

    # Index each row by plan and year while summing contribution room through the owner's current year
    for limit_row in limit_result:
        limit_values_by_plan_year[(limit_row.plan_id, limit_row.year)] = (
            limit_row.contribution_limit,
            limit_row.withdrawal_limit,
            limit_row.accrued_contributions,
            limit_row.accrued_withdrawals,
        )
        if limit_row.year <= current_years_by_plan_id[limit_row.plan_id]:
            accrued_lifetime_contribution_limits[limit_row.plan_id] += limit_row.contribution_limit
            plan_ids_with_accrued_limit_rows.add(limit_row.plan_id)

    metrics = TacLimitMetrics(
        limit_values_by_plan_year=limit_values_by_plan_year,
        accrued_lifetime_contribution_limits=accrued_lifetime_contribution_limits,
        plan_ids_with_accrued_limit_rows=plan_ids_with_accrued_limit_rows,
    )
    return metrics


def attach_tac_limit_metrics(
    plans: Sequence[TaxAdvantagedPlan],
    current_years_by_plan_id: dict[uuid.UUID, int],
    metrics: TacLimitMetrics,
) -> None:
    """Attach configured TAC limit metrics to plan rows

    Args:
        plans: Plan rows to enrich in place
        current_years_by_plan_id: Current calendar year keyed by plan identifier
        metrics: TAC limit metrics grouped for response assignment
    """
    # Apply current-year and lifetime contribution limit fields to each plan response row
    for plan in plans:
        current_year_limit_values = metrics.limit_values_by_plan_year.get((plan.id, current_years_by_plan_id[plan.id]))
        plan.current_year_contribution_limit = current_year_limit_values[0] if current_year_limit_values else None
        plan.current_year_withdrawal_limit = current_year_limit_values[1] if current_year_limit_values else None
        if plan.lifetime_contribution_limit is not None and plan.id in metrics.plan_ids_with_accrued_limit_rows:
            plan.accrued_lifetime_contribution_limit = min(
                metrics.accrued_lifetime_contribution_limits[plan.id],
                plan.lifetime_contribution_limit,
            )
        else:
            plan.accrued_lifetime_contribution_limit = None
