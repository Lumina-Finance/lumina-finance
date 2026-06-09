"""Net worth service for the insights page"""

from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.schemas.insights import InsightsNetWorthResponse
from app.services.dashboard import get_accessible_accounts
from app.services.insights.net_worth.chart_series_helpers import get_net_worth_chart_series
from app.services.insights.net_worth.groups import (
    NET_WORTH_GROUPS,
)


async def get_net_worth(
    db: AsyncSession,
    user: User,
    from_date: date,
    to_date: date,
) -> InsightsNetWorthResponse:
    """Return compact grouped net worth history for the insights card

    Args:
        db: Active database session
        user: User requesting the insight summary
        from_date: Inclusive chart start date
        to_date: Inclusive chart end date

    Returns:
        Net worth chart response payload
    """
    accounts = await get_accessible_accounts(db, user)
    if not accounts:
        return InsightsNetWorthResponse(groups=[], points=[])

    baseline, chart_rows, fx_status = await get_net_worth_chart_series(db, accounts, user.base_currency, from_date, to_date)
    active_group_indexes = [
        index
        for index in range(len(NET_WORTH_GROUPS))
        if baseline[index] != 0 or any(row_values[index] != 0 for _label_date, _value_date, row_values in chart_rows)
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
                [row_values[index] for index in active_group_indexes],
            )
            for label_date, value_date, row_values in chart_rows
        ],
        fx_status=fx_status,
    )
