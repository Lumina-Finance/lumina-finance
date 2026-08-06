"""Tax-advantaged category metric service"""

import uuid
from collections.abc import Sequence
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import TaxAdvantagedCategory
from app.services.tax_advantaged_categories.tac_limit_metric_helpers import (
    attach_tac_limit_metrics,
    get_category_owner_timezones,
    get_tac_category_current_years,
    get_tac_limit_metrics,
)
from app.services.tax_advantaged_categories.tac_transfer_metric_helpers import (
    attach_tac_transfer_totals,
    get_tac_transfer_totals,
)

__all__ = [
    "attach_tax_advantaged_category_metrics",
    "get_category_owner_timezones",
]


def _get_current_datetime_for_timezone(timezone: ZoneInfo) -> datetime:
    """Return the current datetime for a timezone

    Args:
        timezone: Timezone used for the current datetime

    Returns:
        Current datetime in the supplied timezone
    """
    current_datetime = datetime.now(timezone)
    return current_datetime


async def attach_tax_advantaged_category_metrics(
    db: AsyncSession,
    tax_advantaged_categories: Sequence[TaxAdvantagedCategory],
    owner_timezones: dict[uuid.UUID, ZoneInfo],
) -> None:
    """Attach current-year limits and transfer tallies to tax-advantaged category rows

    Archived linked accounts are included because contribution and withdrawal
    room is historical tax data, not active account availability

    Args:
        db: Active database session
        tax_advantaged_categories: Tax-advantaged category rows to enrich in place
        owner_timezones: Zone keyed by category owner identifier, from get_category_owner_timezones
    """
    if not tax_advantaged_categories:
        return

    tax_advantaged_category_ids = [tax_advantaged_category.id for tax_advantaged_category in tax_advantaged_categories]
    current_years_by_tax_advantaged_category_id = get_tac_category_current_years(
        tax_advantaged_categories,
        owner_timezones,
        _get_current_datetime_for_timezone,
    )
    limit_metrics = await get_tac_limit_metrics(db, tax_advantaged_category_ids, current_years_by_tax_advantaged_category_id)
    attach_tac_limit_metrics(tax_advantaged_categories, current_years_by_tax_advantaged_category_id, limit_metrics)
    transfer_totals_by_tax_advantaged_category_id = await get_tac_transfer_totals(
        db,
        tax_advantaged_categories,
        tax_advantaged_category_ids,
        current_years_by_tax_advantaged_category_id,
        limit_metrics,
    )
    attach_tac_transfer_totals(tax_advantaged_categories, transfer_totals_by_tax_advantaged_category_id)
