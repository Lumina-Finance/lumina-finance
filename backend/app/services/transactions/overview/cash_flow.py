"""Transaction overview cash-flow conversion"""
import uuid
from datetime import date, timedelta
from typing import Literal

from app.models.account import Account
from app.schemas.fx import FxStatus
from app.schemas.transaction import DailyCashFlow
from app.services.fx import FxConverter

OverviewCashFlowGranularity = Literal["day", "week", "month"]
_MONTHLY_RANGE_DAY_COUNT = 31
_HALF_YEAR_DAY_COUNT = 183


async def convert_overview_daily_cash_flow(
    *,
    cash_flow_rows,
    accounts_by_id: dict[uuid.UUID, Account],
    converter: FxConverter,
    base_currency: str,
    from_date: date | None,
    to_date: date | None,
) -> tuple[list[DailyCashFlow], FxStatus]:
    """Convert cash-flow query rows into response rows

    Args:
        cash_flow_rows: Query rows containing account-level inflow and outflow totals
        accounts_by_id: Account rows keyed by account ID
        converter: Request-scoped FX converter
        base_currency: User base currency used for overview metrics
        from_date: Optional inclusive start date for the overview window
        to_date: Optional inclusive end date for the overview window

    Returns:
        Converted cash-flow response rows and FX status for the conversion
    """
    daily_totals: dict[date, tuple[int, int]] = {}

    # Convert account-level cash-flow rows into base-currency daily totals for later chart bucketing
    for row in cash_flow_rows:
        currency = accounts_by_id[row.account_id].currency
        row_inflow = int(row.inflow or 0)
        row_outflow = int(row.outflow or 0)
        converted_inflow = await converter.convert_minor_units(
            row_inflow,
            base=currency,
            quote=base_currency,
            rate_date=row.date,
        )
        converted_outflow = await converter.convert_minor_units(
            row_outflow,
            base=currency,
            quote=base_currency,
            rate_date=row.date,
        )

        # Drop rows only when every non-zero side failed conversion
        if (
            (row_inflow == 0 or converted_inflow is None)
            and (row_outflow == 0 or converted_outflow is None)
        ):
            continue

        # Keep partial rows when one side converts and the other side is zero or unavailable
        inflow, outflow = daily_totals.get(row.date, (0, 0))

        # Merge converted account totals into the date bucket before range bucketing
        daily_totals[row.date] = (
            inflow + (converted_inflow or 0),
            outflow + (converted_outflow or 0),
        )

    if not daily_totals:
        return [], converter.get_status()

    period_start = from_date or min(daily_totals)
    period_end = to_date or max(daily_totals)
    daily_cash_flow = _bucket_overview_daily_cash_flow(
        daily_totals,
        from_date=period_start,
        to_date=period_end,
    )
    return daily_cash_flow, converter.get_status()


def sum_overview_net_flow(daily_cash_flow: list[DailyCashFlow]) -> tuple[int, int]:
    """Sum net inflow and outflow from converted cash-flow rows

    Args:
        daily_cash_flow: Converted cash-flow response rows

    Returns:
        Total inflow and outflow for the overview window
    """
    return (
        sum(day.inflow for day in daily_cash_flow),
        sum(day.outflow for day in daily_cash_flow),
    )


def _get_overview_cash_flow_granularity(from_date: date, to_date: date) -> OverviewCashFlowGranularity:
    """Choose the cash-flow bucket granularity for a date range

    Args:
        from_date: Inclusive start date for the overview window
        to_date: Inclusive end date for the overview window

    Returns:
        Bucket granularity used for cash-flow chart rows
    """
    day_count = (to_date - from_date).days + 1
    if day_count <= _MONTHLY_RANGE_DAY_COUNT:
        return "day"
    if day_count <= _HALF_YEAR_DAY_COUNT:
        return "week"
    return "month"


def _get_overview_cash_flow_bucket_key(
    target: date,
    granularity: OverviewCashFlowGranularity,
) -> tuple[int, ...]:
    """Return a comparable bucket key for a cash-flow date

    Args:
        target: Date being assigned to a cash-flow bucket
        granularity: Bucket granularity selected for the overview range

    Returns:
        Tuple key identifying the date's day, week, or month bucket
    """
    if granularity == "day":
        return (target.year, target.month, target.day)
    if granularity == "week":
        iso_year, iso_week, _weekday = target.isocalendar()
        return (iso_year, iso_week)
    return (target.year, target.month)


def _build_overview_cash_flow_buckets(from_date: date, to_date: date) -> list[tuple[date, date]]:
    """Build contiguous cash-flow buckets for an overview range

    Args:
        from_date: Inclusive start date for the overview window
        to_date: Inclusive end date for the overview window

    Returns:
        Ordered list of inclusive bucket start and end dates
    """
    granularity = _get_overview_cash_flow_granularity(from_date, to_date)
    buckets: list[tuple[date, date]] = []
    bucket_start = from_date
    current_key = _get_overview_cash_flow_bucket_key(from_date, granularity)
    current_date = from_date

    # Walk by day so partial first and last weeks/months stay inside the requested range
    while current_date <= to_date:
        bucket_key = _get_overview_cash_flow_bucket_key(current_date, granularity)
        if bucket_key != current_key:
            buckets.append((bucket_start, current_date - timedelta(days=1)))
            bucket_start = current_date
            current_key = bucket_key
        current_date += timedelta(days=1)

    buckets.append((bucket_start, to_date))
    return buckets


def _bucket_overview_daily_cash_flow(
    daily_totals: dict[date, tuple[int, int]],
    *,
    from_date: date,
    to_date: date,
) -> list[DailyCashFlow]:
    """Aggregate daily cash-flow totals into overview buckets

    Args:
        daily_totals: Mapping from date to inflow and outflow totals
        from_date: Inclusive start date for the overview window
        to_date: Inclusive end date for the overview window

    Returns:
        Cash-flow rows grouped into the selected bucket size
    """
    daily_cash_flow: list[DailyCashFlow] = []
    for bucket_start, bucket_end in _build_overview_cash_flow_buckets(from_date, to_date):
        inflow = 0
        outflow = 0
        current_date = bucket_start
        while current_date <= bucket_end:
            day_inflow, day_outflow = daily_totals.get(current_date, (0, 0))
            inflow += day_inflow
            outflow += day_outflow
            current_date += timedelta(days=1)
        daily_cash_flow.append(DailyCashFlow(
            date=bucket_start,
            end_date=bucket_end,
            inflow=inflow,
            outflow=outflow,
        ))
    return daily_cash_flow
