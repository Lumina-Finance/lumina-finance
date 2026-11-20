"""Date limits on the report endpoints and the transaction filters: the window every date sits in and the longest range a report covers"""

from datetime import UTC, datetime

import pytest

from app.utils import date_window
from tests.routes.support import _create_account, _create_user, _get_auth_header

# The window then ends on 10 June 2036 for the furthest-ahead calendar
FROZEN_MOMENT = datetime(2026, 6, 9, 23, 30, tzinfo=UTC)

# The route that carries every case, since all of them share one check
CASH_FLOW_PATH = "/insights/cash-flow"
# Every other route taking a report range. Each needs only to show that it runs the check
OTHER_RANGE_PATHS = [
    "/insights/period-glance",
    "/insights/fund-flow",
    "/insights/income-expense-breakdown",
    "/insights/net-worth",
    "/insights/merchant-distribution",
    "/insights/merchant-ranking",
    "/insights/merchants",
    "/transactions/overview",
]


@pytest.fixture(autouse=True)
def frozen_clock(freeze_now) -> None:
    """Fix the moment the window's last day is counted from"""
    freeze_now(date_window, FROZEN_MOMENT)


@pytest.fixture
async def headers(client) -> dict[str, str]:
    """Return the auth header of a signed-up user"""
    return _get_auth_header(await _create_user(client))


@pytest.mark.parametrize(
    ("from_date", "to_date", "detail"),
    [
        ("1850-01-01", "1850-01-31", "Start date must be on or after 1 January 1900"),
        ("2030-01-01", "2036-06-11", "End date must be within ten years of today"),
        ("2099-01-01", "2099-12-31", "Start date must be within ten years of today"),
        ("2000-01-01", "2020-01-01", "Range can cover at most 20 years"),
        ("0001-01-01", "9999-12-31", "Start date must be on or after 1 January 1900"),
    ],
)
async def test_report_range_outside_the_window_or_over_20_years_is_refused(client, headers, from_date, to_date, detail):
    """A range with an end outside the window, or one covering over 20 years, is a 422 that names the problem"""
    response = await client.get(CASH_FLOW_PATH, params={"from_date": from_date, "to_date": to_date}, headers=headers)

    assert response.status_code == 422
    assert response.json()["detail"] == detail


@pytest.mark.parametrize("path", OTHER_RANGE_PATHS)
async def test_every_report_route_refuses_a_range_over_20_years(client, headers, path):
    """Each route taking a report range runs the same check"""
    response = await client.get(path, params={"from_date": "2000-01-01", "to_date": "2020-01-01"}, headers=headers)

    assert response.status_code == 422
    assert response.json()["detail"] == "Range can cover at most 20 years"


@pytest.mark.parametrize(
    ("from_date", "to_date"),
    [
        ("1900-01-01", "1919-12-31"),
        ("2016-06-11", "2036-06-10"),
        ("2016-02-29", "2036-02-28"),
        ("2026-01-01", "2026-01-31"),
    ],
)
async def test_report_range_at_the_edges_of_the_window_and_20_years_is_answered(client, headers, from_date, to_date):
    """A range from 1 January 1900, to the last day of the window, or one day short of 20 years is taken"""
    response = await client.get(CASH_FLOW_PATH, params={"from_date": from_date, "to_date": to_date}, headers=headers)

    assert response.status_code == 200


async def test_report_range_of_exactly_20_years_is_refused(client, headers):
    """A range that reaches the same date 20 years on is over the limit, one day less is not"""
    refused = await client.get("/insights/cash-flow", params={"from_date": "2010-03-01", "to_date": "2030-03-01"}, headers=headers)
    taken = await client.get("/insights/cash-flow", params={"from_date": "2010-03-01", "to_date": "2030-02-28"}, headers=headers)

    assert refused.status_code == 422
    assert taken.status_code == 200


async def test_overview_with_one_end_open_is_held_to_the_window_only(client, headers):
    """An overview with only a start date can reach back to 1900 but not before it"""
    taken = await client.get("/transactions/overview", params={"from_date": "1900-01-01"}, headers=headers)
    refused = await client.get("/transactions/overview", params={"to_date": "2099-01-01"}, headers=headers)

    assert taken.status_code == 200
    assert refused.status_code == 422
    assert refused.json()["detail"] == "End date must be within ten years of today"


@pytest.mark.parametrize(
    ("params", "message"),
    [
        ({"from_date": "1850-01-01"}, "Date must be on or after 1 January 1900"),
        ({"to_date": "2099-01-01"}, "Date must be within ten years of today"),
    ],
)
async def test_account_snapshots_refuse_a_date_outside_the_window_on_that_field(client, headers, params, message):
    """The balance chart's dates are held to the window, with the reason on the field"""
    account_id = (await _create_account(client, headers)).json()["id"]

    response = await client.get(f"/accounts/{account_id}/snapshots", params=params, headers=headers)

    assert response.status_code == 422
    [error] = response.json()["detail"]
    assert error["loc"] == ["query", next(iter(params))]
    assert error["msg"] == message


async def test_account_snapshots_take_the_whole_window_with_no_length_limit(client, headers):
    """An all-time chart from 1 January 1900 to the last day of the window is still answered"""
    account_id = (await _create_account(client, headers)).json()["id"]

    response = await client.get(
        f"/accounts/{account_id}/snapshots", params={"from_date": "1900-01-01", "to_date": "2036-06-10"}, headers=headers
    )

    assert response.status_code == 200


# The routes that filter transactions by date, besides the list that carries every case. A filter only
# narrows a query, so any range inside the window is taken. Each needs only to show that it runs the check
OTHER_TRANSACTION_FILTER_PATHS = [
    "/transactions/export",
    "/transactions/11111111-1111-4111-8111-111111111111/refund-link-candidates",
]
BEFORE_WINDOW_MESSAGE = "Date must be on or after 1 January 1900"
AFTER_WINDOW_MESSAGE = "Date must be within ten years of today"


async def _refused_date(client, headers, path, params):
    """Get a path with a date outside the window and return the one error it names, with the status checked"""
    response = await client.get(path, params=params, headers=headers)

    assert response.status_code == 422
    [error] = response.json()["detail"]
    return error


@pytest.mark.parametrize(
    ("params", "message"),
    [
        ({"from_date": "0001-01-01"}, BEFORE_WINDOW_MESSAGE),
        ({"from_date": "1899-12-31"}, BEFORE_WINDOW_MESSAGE),
        ({"to_date": "2036-06-11"}, AFTER_WINDOW_MESSAGE),
        ({"to_date": "9999-12-31"}, AFTER_WINDOW_MESSAGE),
    ],
)
async def test_transaction_list_refuses_a_date_outside_the_window_on_that_field(client, headers, params, message):
    """A date a day outside the window or far outside it is a 422 naming the field, with the reason"""
    error = await _refused_date(client, headers, "/transactions", params)

    assert error["loc"] == ["query", next(iter(params))]
    assert error["msg"] == message


@pytest.mark.parametrize("path", OTHER_TRANSACTION_FILTER_PATHS)
@pytest.mark.parametrize(
    ("params", "message"), [({"from_date": "0001-01-01"}, BEFORE_WINDOW_MESSAGE), ({"to_date": "9999-12-31"}, AFTER_WINDOW_MESSAGE)]
)
async def test_transaction_export_and_link_candidates_refuse_a_date_outside_the_window(client, headers, path, params, message):
    """The export and the refund-link candidates run the same check on each of their two dates"""
    error = await _refused_date(client, headers, path, params)

    assert error["loc"] == ["query", next(iter(params))]
    assert error["msg"] == message


async def test_transaction_list_takes_a_range_from_the_first_to_the_last_day_of_the_window(client, headers):
    """A range over far more than 20 years is still answered, since a filter only narrows what is listed"""
    response = await client.get("/transactions", params={"from_date": "1900-01-01", "to_date": "2036-06-10"}, headers=headers)

    assert response.status_code == 200


@pytest.mark.parametrize(
    ("unit", "amount", "expected_status"),
    [
        ("year", 20, 201),
        ("year", 21, 422),
        ("quarter", 80, 201),
        ("quarter", 81, 422),
        ("month", 240, 201),
        ("month", 241, 422),
        ("week", 999, 201),
        ("day", 999, 201),
    ],
)
async def test_saved_range_is_held_to_20_years_at_each_unit(client, headers, unit, amount, expected_status):
    """A saved range of up to 20 years is stored, and one more unit past the limit is refused"""
    response = await client.post("/insights/saved-ranges", json={"name": "Long look", "amount": amount, "unit": unit}, headers=headers)

    assert response.status_code == expected_status
    if expected_status == 422:
        [error] = response.json()["detail"]
        assert error["msg"] == "Range can cover at most 20 years"


async def test_saved_this_range_keeps_an_amount_the_builder_hides(client, headers):
    """This spans one period whatever the amount says, so an amount left from an earlier Past 30 years does not refuse the save"""
    response = await client.post(
        "/insights/saved-ranges",
        json={"name": "This year", "amount": 30, "unit": "year", "qualifier": "this"},
        headers=headers,
    )

    assert response.status_code == 201
