"""Route tests for the most periods one budget keeps, so backdating a budget cannot fill the database"""

import asyncio
import importlib
import uuid
from datetime import UTC, date, datetime

import pytest
import sqlalchemy as sa

from app.models.budget import Budget
from app.utils import date_window
from tests.conftest import TestSession
from tests.routes.base_budgets._helpers import _create_base_budget, _create_budget_instance, _create_category, _create_group
from tests.routes.support import _create_user, _get_auth_header

ROUTER = importlib.import_module("app.routes.base_budgets.router")

# 4 May 2026, a Monday, so the series below are counted to May 2026 and a weekly budget can start on a Monday
FROZEN_MOMENT = datetime(2026, 5, 4, 16, 0, tzinfo=UTC)

SETUP_REFUSAL = "A budget can go back at most 1,200 periods. Please choose a later start date"
REPEAT_REFUSAL = "This budget can't repeat: a budget can go back at most 1,200 periods"


@pytest.fixture(autouse=True)
def frozen_clock(freeze_now) -> None:
    """Fix the clocks the periods are counted to and the date window is counted from"""
    freeze_now(ROUTER, FROZEN_MOMENT)
    freeze_now(date_window, FROZEN_MOMENT)


async def _period_starts(base_budget_id: str) -> list[date]:
    """Return a base budget's period starts, oldest first"""
    async with TestSession() as session:
        query = sa.select(Budget.period_start).where(Budget.base_budget_id == uuid.UUID(base_budget_id)).order_by(Budget.period_start)
        return list((await session.scalars(query)).all())


async def _create_recurring(client, headers, category_id, **overrides):
    """Create a recurring budget with one limit for every period"""
    return await _create_base_budget(client, headers, category_ids=[category_id], recurs=True, overall_limit=75000, **overrides)


@pytest.mark.parametrize(
    ("overrides", "periods"),
    [
        ({"period_start": "1976-06-01"}, 600),
        ({"period_start": "1926-06-01"}, 1200),
        ({"period_start": "1926-05-31", "recurrence_dom": 31}, 1200),
        ({"recurrence_freq": "weekly", "recurrence_weekday": 0, "recurrence_dom": None, "period_start": "2003-05-12"}, 1200),
    ],
)
async def test_create_recurring_budget_within_the_limit_makes_every_period_to_today(client, overrides, periods):
    """A monthly budget from 50 years ago has 600 periods, and one from 100 years ago exactly 1,200"""
    headers = _get_auth_header(await _create_user(client))
    category_id = await _create_category(client, headers)

    resp = await _create_recurring(client, headers, category_id, **overrides)

    assert resp.status_code == 201
    starts = await _period_starts(resp.json()["id"])
    assert len(starts) == periods
    assert starts[0] == date.fromisoformat(overrides["period_start"])


@pytest.mark.parametrize(
    "overrides",
    [
        {"period_start": "1926-05-01"},
        {"period_start": "1926-03-31", "recurrence_dom": 31},
        {"recurrence_freq": "weekly", "recurrence_weekday": 0, "recurrence_dom": None, "period_start": "1996-05-06"},
    ],
)
async def test_create_recurring_budget_past_the_limit_is_refused_and_creates_nothing(client, overrides):
    """1,201 monthly periods, or a weekly budget from 30 years ago, is refused with no budget left behind"""
    headers = _get_auth_header(await _create_user(client))
    category_id = await _create_category(client, headers)

    resp = await _create_recurring(client, headers, category_id, **overrides)

    assert resp.status_code == 422
    assert resp.json()["detail"] == SETUP_REFUSAL
    assert (await client.get("/base-budgets", headers=headers)).json() == []


async def test_create_one_off_budget_from_long_ago_is_not_refused(client):
    """A one-off budget has a single period however far back it starts"""
    headers = _get_auth_header(await _create_user(client))
    category_id = await _create_category(client, headers)

    resp = await _create_base_budget(client, headers, category_ids=[category_id], period_start="1900-01-01", overall_limit=75000)

    assert resp.status_code == 201
    assert await _period_starts(resp.json()["id"]) == [date(1900, 1, 1)]


async def test_new_period_on_a_budget_holding_the_limit_removes_its_oldest(client):
    """Below the limit a new period removes nothing, and at 1,200 it removes the oldest one"""
    headers = _get_auth_header(await _create_user(client))
    category_id = await _create_category(client, headers)
    below_id = (await _create_recurring(client, headers, category_id, period_start="1976-06-01")).json()["id"]
    full_id = (await _create_recurring(client, headers, category_id, period_start="1926-06-01")).json()["id"]

    below_resp = await _create_budget_instance(client, headers, below_id, period_start="2026-06-01")
    full_resp = await _create_budget_instance(client, headers, full_id, period_start="2026-06-01")

    assert (below_resp.status_code, full_resp.status_code) == (201, 201)
    below_starts = await _period_starts(below_id)
    assert (len(below_starts), below_starts[0], below_starts[-1]) == (601, date(1976, 6, 1), date(2026, 6, 1)), "below the limit"
    full_starts = await _period_starts(full_id)
    assert (len(full_starts), full_starts[0], full_starts[-1]) == (1200, date(1926, 7, 1), date(2026, 6, 1)), "at the limit"


async def test_new_period_on_a_budget_past_the_limit_brings_it_down_to_the_limit(client):
    """A budget holding more than 1,200 periods from before the limit keeps its newest 1,200"""
    headers = _get_auth_header(await _create_user(client))
    category_id = await _create_category(client, headers)
    base_id = (await _create_recurring(client, headers, category_id, period_start="1926-06-01")).json()["id"]
    async with TestSession() as session:
        session.add_all(
            Budget(base_budget_id=uuid.UUID(base_id), period_start=date(1926, month, 1), period_end=date(1926, month, 28), overall_limit=75000)
            for month in range(1, 6)
        )
        await session.commit()

    resp = await _create_budget_instance(client, headers, base_id, period_start="2026-06-01")

    assert resp.status_code == 201
    starts = await _period_starts(base_id)
    assert (len(starts), starts[0], starts[-1]) == (1200, date(1926, 7, 1), date(2026, 6, 1))


async def test_new_periods_added_at_once_on_a_full_budget_keep_it_at_the_limit(client):
    """Two new periods arriving together each remove an oldest period, so the budget still keeps 1,200"""
    headers = _get_auth_header(await _create_user(client))
    category_id = await _create_category(client, headers)
    base_id = (await _create_recurring(client, headers, category_id, period_start="1926-06-01")).json()["id"]

    responses = await asyncio.gather(
        _create_budget_instance(client, headers, base_id, period_start="2026-06-01"),
        _create_budget_instance(client, headers, base_id, period_start="2026-07-01"),
    )

    assert [resp.status_code for resp in responses] == [201, 201]
    starts = await _period_starts(base_id)
    assert (len(starts), starts[0], starts[-1]) == (1200, date(1926, 8, 1), date(2026, 7, 1))


async def test_unarchiving_a_full_budget_adds_the_current_period_and_removes_the_oldest(client, freeze_now):
    """Unarchiving adds the period holding today, which removes the oldest of a budget's 1,200"""
    freeze_now(ROUTER, datetime(2026, 4, 4, 16, 0, tzinfo=UTC))
    headers = _get_auth_header(await _create_user(client))
    category_id = await _create_category(client, headers)
    base_id = (await _create_recurring(client, headers, category_id, period_start="1926-05-01")).json()["id"]
    await client.patch(f"/base-budgets/{base_id}", json={"is_archived": True}, headers=headers)

    freeze_now(ROUTER, FROZEN_MOMENT)
    resp = await client.patch(f"/base-budgets/{base_id}", json={"is_archived": False}, headers=headers)

    assert resp.status_code == 200
    starts = await _period_starts(base_id)
    assert (len(starts), starts[0], starts[-1]) == (1200, date(1926, 6, 1), date(2026, 5, 1))


@pytest.mark.parametrize(("period_start", "status_code"), [("2003-05-12", 200), ("2003-05-05", 422)])
async def test_switching_a_one_off_budget_to_recurring_is_refused_past_the_limit(client, period_start, status_code):
    """A one-off weekly budget whose weeks to today would pass 1,200 stays one-off, with the reason"""
    headers = _get_auth_header(await _create_user(client))
    category_id = await _create_category(client, headers)
    base_id = (
        await _create_base_budget(
            client,
            headers,
            category_ids=[category_id],
            recurrence_freq="weekly",
            recurrence_weekday=0,
            recurrence_dom=None,
            period_start=period_start,
            overall_limit=75000,
        )
    ).json()["id"]

    resp = await client.patch(f"/base-budgets/{base_id}", json={"recurs": True}, headers=headers)

    assert resp.status_code == status_code
    saved = (await client.get(f"/base-budgets/{base_id}", headers=headers)).json()
    if status_code == 422:
        assert resp.json()["detail"] == REPEAT_REFUSAL
        assert saved["recurs"] is False
    else:
        assert saved["recurs"] is True


async def test_group_budget_is_not_held_to_the_period_limit(client):
    """A group's budget keeps every period, since removing one would change what each member sees"""
    headers = _get_auth_header(await _create_user(client))
    group_id = await _create_group(client, headers)
    category_id = await _create_category(client, headers, group_id=group_id)

    resp = await _create_recurring(client, headers, category_id, group_id=group_id, period_start="1926-05-01")

    assert resp.status_code == 201
    assert len(await _period_starts(resp.json()["id"])) == 1201
