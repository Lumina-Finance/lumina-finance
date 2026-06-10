"""Response assembly helpers for the insights net worth card"""

from datetime import date

from app.schemas.fx import FxStatus
from app.schemas.insights import InsightsNetWorthResponse
from app.services.insights.net_worth.groups import NET_WORTH_GROUPS


def build_net_worth_response(
    *,
    baseline: list[int],
    chart_rows: list[tuple[date, date, list[int]]],
    fx_status: FxStatus,
) -> InsightsNetWorthResponse:
    """Return the net worth API response from chart series values

    Args:
        baseline: Grouped values for the date before the selected range
        chart_rows: Grouped values for each chart row
        fx_status: FX status from chart series conversion

    Returns:
        Net worth chart response payload
    """
    active_group_indexes = _get_active_group_indexes(baseline, chart_rows)
    if not active_group_indexes:
        response = InsightsNetWorthResponse(groups=[], points=[], fx_status=fx_status)
        return response

    groups = [
        (NET_WORTH_GROUPS[index].id, NET_WORTH_GROUPS[index].name, NET_WORTH_GROUPS[index].kind)
        for index in active_group_indexes
    ]
    active_baseline = [baseline[index] for index in active_group_indexes]
    active_chart_rows = [
        (
            label_date,
            value_date,
            [row_values[index] for index in active_group_indexes],
        )
        for label_date, value_date, row_values in chart_rows
    ]
    response = InsightsNetWorthResponse(
        groups=groups,
        baseline=active_baseline,
        points=active_chart_rows,
        fx_status=fx_status,
    )
    return response


def _get_active_group_indexes(
    baseline: list[int],
    chart_rows: list[tuple[date, date, list[int]]],
) -> list[int]:
    """Return indexes for groups that have any non-zero value

    Args:
        baseline: Grouped values for the date before the selected range
        chart_rows: Grouped values for each chart row

    Returns:
        Group indexes that should be included in the response
    """
    active_group_indexes = [
        index
        for index in range(len(NET_WORTH_GROUPS))
        if baseline[index] != 0 or any(row_values[index] != 0 for _label_date, _value_date, row_values in chart_rows)
    ]
    return active_group_indexes
