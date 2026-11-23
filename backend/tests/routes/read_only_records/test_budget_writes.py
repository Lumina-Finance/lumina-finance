"""What the budget routes do with a budget the installed check keeps read-only, as its currency is another than the user's main one

Each budget says why it is read-only. Nothing on it changes, while a recurring one keeps starting its
periods on schedule and every one can be archived or deleted
"""

import importlib
from datetime import UTC, date, datetime

import pytest
import sqlalchemy as sa

from app.models.budget import Budget
from app.utils import date_window
from tests.conftest import TestSession
from tests.routes.base_budgets._helpers import _create_base_budget, _create_budget_instance, _create_category
from tests.routes.read_only_records._helpers import _sign_up_holding_usd
from tests.routes.support.allowance_helpers import ALLOWANCE_REASON, refuse_other_currencies

ROUTER = importlib.import_module("app.routes.base_budgets.router")

# 4 May 2026, so a monthly budget started on 1 April has an April and a May period
FROZEN_MOMENT = datetime(2026, 5, 4, 16, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def frozen_clock(freeze_now) -> None:
    """Fix the clocks the periods are counted to and the date window is counted from"""
    _freeze(freeze_now, FROZEN_MOMENT)


def _freeze(freeze_now, moment: datetime) -> None:
    """Set the clocks the periods are counted to and the date window is counted from to the moment"""
    freeze_now(ROUTER, moment)
    freeze_now(date_window, moment)


async def _new_budget(client, headers, name: str = "Travel", currency: str = "USD", recurs: bool = True, **fields) -> str:
    """Create a monthly $1,000 budget from 1 April, recurring and in US dollars unless told otherwise, and return its id

    A group's budget tracks a category of the group's own
    """
    scope = {"group_id": fields["group_id"]} if "group_id" in fields else {}
    created = await _create_base_budget(
        client,
        headers,
        category_ids=[await _create_category(client, headers, name=f"{name} spending", **scope)],
        name=name,
        currency=currency,
        recurs=recurs,
        period_start="2026-04-01",
        overall_limit=100_000,
        **fields,
    )
    assert created.status_code == 201, created.text
    return created.json()["id"]


async def _periods() -> list[tuple[str, int]]:
    """Return each stored budget period's start and limit, oldest first"""
    async with TestSession() as session:
        rows = await session.execute(sa.select(Budget.period_start, Budget.overall_limit).order_by(Budget.period_start))
    return [(period_start.isoformat(), overall_limit) for period_start, overall_limit in rows]


async def _period_id(period_start: str) -> str:
    """Return the id of the stored period starting on the day"""
    async with TestSession() as session:
        return str(await session.scalar(sa.select(Budget.id).where(Budget.period_start == date.fromisoformat(period_start))))


async def _remove_periods(client, headers, *period_starts: str) -> None:
    """Delete the stored periods starting on the days, before any check is installed"""
    for period_start in period_starts:
        removed = await client.delete(f"/budgets/{await _period_id(period_start)}", headers=headers)
        assert removed.status_code == 204, removed.text


async def test_list_says_why_only_a_personal_budget_in_another_currency_is_read_only(client):
    """A group's US budget and a Canadian one can change"""
    headers = await _sign_up_holding_usd(client)
    group_id = (await client.post("/groups", json={"name": "Household"}, headers=headers)).json()["id"]
    await _new_budget(client, headers)
    await _new_budget(client, headers, "Joint", group_id=group_id)
    await _new_budget(client, headers, "Groceries", currency="CAD")
    refuse_other_currencies()

    listed = await client.get("/base-budgets", headers=headers)

    assert listed.status_code == 200, listed.text
    assert {row["name"]: row["read_only_reason"] for row in listed.json()} == {"Travel": ALLOWANCE_REASON, "Joint": None, "Groceries": None}


async def test_edit_read_only_budget_is_refused_and_changes_nothing(client):
    """The name stays as it was"""
    headers = await _sign_up_holding_usd(client)
    budget_id = await _new_budget(client, headers, name="Travel")
    refuse_other_currencies()

    response = await client.patch(f"/base-budgets/{budget_id}", json={"name": "Holiday"}, headers=headers)

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == ALLOWANCE_REASON
    assert (await client.get(f"/base-budgets/{budget_id}", headers=headers)).json()["name"] == "Travel"


async def test_edit_period_limit_of_a_read_only_budget_is_refused_and_changes_nothing(client):
    """May's limit stays $1,000"""
    headers = await _sign_up_holding_usd(client)
    await _new_budget(client, headers)
    may_id = await _period_id("2026-05-01")
    refuse_other_currencies()

    response = await client.patch(f"/budgets/{may_id}", json={"overall_limit": 120_000}, headers=headers)

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == ALLOWANCE_REASON
    assert await _periods() == [("2026-04-01", 100_000), ("2026-05-01", 100_000)]


async def test_delete_period_of_a_read_only_budget_is_refused_and_keeps_it(client):
    """Removing one period changes the budget's history, unlike deleting the whole budget"""
    headers = await _sign_up_holding_usd(client)
    await _new_budget(client, headers)
    april_id = await _period_id("2026-04-01")
    refuse_other_currencies()

    response = await client.delete(f"/budgets/{april_id}", headers=headers)

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == ALLOWANCE_REASON
    assert await _periods() == [("2026-04-01", 100_000), ("2026-05-01", 100_000)]


async def test_read_only_budget_still_starts_its_scheduled_period(client):
    """May hasn't been started yet, so starting it with April's limit goes through as the schedule would"""
    headers = await _sign_up_holding_usd(client)
    budget_id = await _new_budget(client, headers)
    await _remove_periods(client, headers, "2026-05-01")
    refuse_other_currencies()

    response = await _create_budget_instance(client, headers, budget_id, period_start="2026-05-01", overall_limit=100_000)

    assert response.status_code == 201, response.text
    assert response.json()["base_budget"]["read_only_reason"] == ALLOWANCE_REASON
    assert await _periods() == [("2026-04-01", 100_000), ("2026-05-01", 100_000)]


async def test_read_only_budget_starts_a_period_beginning_today(client, freeze_now):
    """At 1am on 1 June in the user's Toronto, June has begun, so the schedule starts it"""
    _freeze(freeze_now, datetime(2026, 6, 1, 5, 0, tzinfo=UTC))
    headers = await _sign_up_holding_usd(client)
    budget_id = await _new_budget(client, headers)
    await _remove_periods(client, headers, "2026-06-01")
    refuse_other_currencies()

    response = await _create_budget_instance(client, headers, budget_id, period_start="2026-06-01", overall_limit=100_000)

    assert response.status_code == 201, response.text
    assert await _periods() == [("2026-04-01", 100_000), ("2026-05-01", 100_000), ("2026-06-01", 100_000)]


async def test_read_only_budget_counts_today_in_the_users_timezone(client, freeze_now):
    """At 11pm on 31 May in the user's Toronto it is already 1 June in UTC, yet June hasn't begun for the user"""
    _freeze(freeze_now, datetime(2026, 6, 1, 3, 0, tzinfo=UTC))
    headers = await _sign_up_holding_usd(client)
    budget_id = await _new_budget(client, headers)
    refuse_other_currencies()

    response = await _create_budget_instance(client, headers, budget_id, period_start="2026-06-01", overall_limit=100_000)

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == ALLOWANCE_REASON
    assert await _periods() == [("2026-04-01", 100_000), ("2026-05-01", 100_000)]


@pytest.mark.parametrize(
    ("period_start", "overall_limit"),
    [
        pytest.param("2026-05-01", 120_000, id="new-limit"),
        pytest.param("2026-06-01", 100_000, id="not-begun"),
    ],
)
async def test_read_only_budget_refuses_a_period_its_schedule_wouldnt_start(client, period_start, overall_limit):
    """A period with a limit of the user's own, or one that hasn't begun, is a change the user makes, so nothing is added"""
    headers = await _sign_up_holding_usd(client)
    budget_id = await _new_budget(client, headers)
    await _remove_periods(client, headers, "2026-05-01")
    refuse_other_currencies()

    response = await _create_budget_instance(client, headers, budget_id, period_start=period_start, overall_limit=overall_limit)

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == ALLOWANCE_REASON
    assert await _periods() == [("2026-04-01", 100_000)]


async def test_read_only_budget_refuses_a_period_overlapping_its_latest(client):
    """May is already started, so a second May is no period the schedule starts"""
    headers = await _sign_up_holding_usd(client)
    budget_id = await _new_budget(client, headers)
    refuse_other_currencies()

    response = await _create_budget_instance(client, headers, budget_id, period_start="2026-05-01", overall_limit=100_000)

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == ALLOWANCE_REASON
    assert await _periods() == [("2026-04-01", 100_000), ("2026-05-01", 100_000)]


async def test_read_only_budget_refuses_a_period_past_a_gap(client, freeze_now):
    """On 4 June, with May and June removed, the schedule starts May next, so June is the user's own choice"""
    _freeze(freeze_now, datetime(2026, 6, 4, 16, 0, tzinfo=UTC))
    headers = await _sign_up_holding_usd(client)
    budget_id = await _new_budget(client, headers)
    await _remove_periods(client, headers, "2026-05-01", "2026-06-01")
    refuse_other_currencies()

    response = await _create_budget_instance(client, headers, budget_id, period_start="2026-06-01", overall_limit=100_000)

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == ALLOWANCE_REASON
    assert await _periods() == [("2026-04-01", 100_000)]


async def test_read_only_one_off_budget_refuses_a_further_period(client):
    """A one-off budget has no schedule, so May after its single April period is the user's own addition"""
    headers = await _sign_up_holding_usd(client)
    budget_id = await _new_budget(client, headers, recurs=False)
    refuse_other_currencies()

    response = await _create_budget_instance(client, headers, budget_id, period_start="2026-05-01", overall_limit=100_000)

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == ALLOWANCE_REASON
    assert await _periods() == [("2026-04-01", 100_000)]


async def test_archive_and_delete_read_only_budget_go_through(client):
    """The budget can be put away, and then deleted with its periods"""
    headers = await _sign_up_holding_usd(client)
    budget_id = await _new_budget(client, headers)
    refuse_other_currencies()

    archived = await client.patch(f"/base-budgets/{budget_id}", json={"is_archived": True}, headers=headers)
    deleted = await client.delete(f"/base-budgets/{budget_id}", headers=headers)

    assert archived.status_code == 200, archived.text
    assert archived.json()["is_archived"] is True
    assert deleted.status_code == 204, deleted.text
    assert (await client.get("/base-budgets", headers=headers)).json() == []
