"""Transaction overview cash-flow conversion"""
import uuid
from datetime import date

from app.models.account import Account
from app.schemas.fx import FxStatus
from app.schemas.transaction import DailyCashFlow
from app.services.fx import FxConverter
from app.utils.cash_flow_bucket_helpers import get_cash_flow_bucket_rows, get_cash_flow_buckets


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
    buckets = get_cash_flow_buckets(from_date, to_date)
    cash_flow_rows = get_cash_flow_bucket_rows(buckets, daily_totals)
    daily_cash_flow: list[DailyCashFlow] = []

    # Convert shared bucket rows into transaction overview response objects
    for bucket_start, bucket_end, inflow, outflow in cash_flow_rows:
        cash_flow = DailyCashFlow(
            date=bucket_start,
            end_date=bucket_end,
            inflow=inflow,
            outflow=outflow,
        )
        daily_cash_flow.append(cash_flow)
    return daily_cash_flow
