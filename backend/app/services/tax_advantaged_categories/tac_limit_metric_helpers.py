"""TAC limit metric helpers"""

import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import TaxAdvantagedCategory, TaxAdvantagedCategoryLimit


@dataclass(frozen=True)
class TacLimitMetrics:
    """TAC limit values grouped for tax-advantaged category response metric assignment"""

    limit_values_by_category_year: dict[tuple[uuid.UUID, int], tuple[int, int | None, int, int]]
    accrued_lifetime_contribution_limits: dict[uuid.UUID, int]
    category_ids_with_accrued_limit_rows: set[uuid.UUID]


async def get_tac_category_current_years(
    db: AsyncSession,
    tax_advantaged_categories: Sequence[TaxAdvantagedCategory],
    current_datetime_for_timezone: Callable[[ZoneInfo], datetime],
) -> dict[uuid.UUID, int]:
    """Return the current calendar year for each TAC category

    Args:
        db: Active database session
        tax_advantaged_categories: Tax-advantaged categories being enriched
        current_datetime_for_timezone: Clock function for timezone-aware current dates

    Returns:
        Current calendar year keyed by tax-advantaged category identifier
    """
    owner_ids = {tax_advantaged_category.category_owner_user_id for tax_advantaged_category in tax_advantaged_categories}

    # Fetch owner time zones through the helper since other owners' user rows are not
    # directly visible, so current-year metrics use each owner's local calendar
    owner_timezones: dict[uuid.UUID, str] = {}
    for owner_id in owner_ids:
        owner_timezones[owner_id] = await db.scalar(select(func.public.user_tz(owner_id)))
    current_years_by_tax_advantaged_category_id = {
        tax_advantaged_category.id: current_datetime_for_timezone(
            ZoneInfo(owner_timezones[tax_advantaged_category.category_owner_user_id]),
        ).year
        for tax_advantaged_category in tax_advantaged_categories
    }
    return current_years_by_tax_advantaged_category_id


async def get_tac_limit_metrics(
    db: AsyncSession,
    tax_advantaged_category_ids: Sequence[uuid.UUID],
    current_years_by_tax_advantaged_category_id: dict[uuid.UUID, int],
) -> TacLimitMetrics:
    """Return configured TAC limit metrics for tax-advantaged category responses

    Args:
        db: Active database session
        tax_advantaged_category_ids: Tax-advantaged category identifiers being enriched
        current_years_by_tax_advantaged_category_id: Current calendar year keyed by tax-advantaged category identifier

    Returns:
        TAC limit metrics grouped for response assignment
    """
    limit_values_by_category_year: dict[tuple[uuid.UUID, int], tuple[int, int | None, int, int]] = {}
    accrued_lifetime_contribution_limits: dict[uuid.UUID, int] = dict.fromkeys(tax_advantaged_category_ids, 0)
    category_ids_with_accrued_limit_rows: set[uuid.UUID] = set()

    # Fetch configured limit rows for the requested categories so derived fields can be calculated together
    limit_result = await db.execute(
        select(
            TaxAdvantagedCategoryLimit.tax_advantaged_category_id,
            TaxAdvantagedCategoryLimit.year,
            TaxAdvantagedCategoryLimit.contribution_limit,
            TaxAdvantagedCategoryLimit.withdrawal_limit,
            TaxAdvantagedCategoryLimit.accrued_contributions,
            TaxAdvantagedCategoryLimit.accrued_withdrawals,
        ).where(TaxAdvantagedCategoryLimit.tax_advantaged_category_id.in_(tax_advantaged_category_ids)),
    )

    # Index each row by category and year while summing contribution room through the owner's current year
    for limit_row in limit_result:
        limit_values_by_category_year[(limit_row.tax_advantaged_category_id, limit_row.year)] = (
            limit_row.contribution_limit,
            limit_row.withdrawal_limit,
            limit_row.accrued_contributions,
            limit_row.accrued_withdrawals,
        )
        if limit_row.year <= current_years_by_tax_advantaged_category_id[limit_row.tax_advantaged_category_id]:
            accrued_lifetime_contribution_limits[limit_row.tax_advantaged_category_id] += limit_row.contribution_limit
            category_ids_with_accrued_limit_rows.add(limit_row.tax_advantaged_category_id)

    metrics = TacLimitMetrics(
        limit_values_by_category_year=limit_values_by_category_year,
        accrued_lifetime_contribution_limits=accrued_lifetime_contribution_limits,
        category_ids_with_accrued_limit_rows=category_ids_with_accrued_limit_rows,
    )
    return metrics


def attach_tac_limit_metrics(
    tax_advantaged_categories: Sequence[TaxAdvantagedCategory],
    current_years_by_tax_advantaged_category_id: dict[uuid.UUID, int],
    metrics: TacLimitMetrics,
) -> None:
    """Attach configured TAC limit metrics to tax-advantaged category rows

    Args:
        tax_advantaged_categories: Tax-advantaged category rows to enrich in place
        current_years_by_tax_advantaged_category_id: Current calendar year keyed by tax-advantaged category identifier
        metrics: TAC limit metrics grouped for response assignment
    """
    # Apply current-year and lifetime contribution limit fields to each tax-advantaged category response row
    for tax_advantaged_category in tax_advantaged_categories:
        current_year_limit_key = (
            tax_advantaged_category.id,
            current_years_by_tax_advantaged_category_id[tax_advantaged_category.id],
        )
        current_year_limit_values = metrics.limit_values_by_category_year.get(current_year_limit_key)
        tax_advantaged_category.current_year_contribution_limit = current_year_limit_values[0] if current_year_limit_values else None
        tax_advantaged_category.current_year_withdrawal_limit = current_year_limit_values[1] if current_year_limit_values else None
        has_accrued_limit_rows = tax_advantaged_category.id in metrics.category_ids_with_accrued_limit_rows
        if tax_advantaged_category.lifetime_contribution_limit is not None and has_accrued_limit_rows:
            tax_advantaged_category.accrued_lifetime_contribution_limit = min(
                metrics.accrued_lifetime_contribution_limits[tax_advantaged_category.id],
                tax_advantaged_category.lifetime_contribution_limit,
            )
        else:
            tax_advantaged_category.accrued_lifetime_contribution_limit = None
