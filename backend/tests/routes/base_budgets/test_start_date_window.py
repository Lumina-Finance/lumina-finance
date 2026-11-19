"""Route tests for the dates a recurring budget may start on, since each period since its start is created at once"""

import importlib
import uuid
from datetime import UTC, datetime

import pytest
import sqlalchemy as sa

from app.models.budget import Budget
from app.utils import date_window
from tests.conftest import TestSession
from tests.routes.base_budgets._helpers import _create_base_budget, _create_category
from tests.routes.support import _create_user, _get_auth_header

# A Monday, so a weekly budget anchored on Mondays starts on 1 January 1900, a Monday too
FROZEN_MOMENT = datetime(2026, 5, 4, 16, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def frozen_clock(freeze_now) -> None:
    """Fix the clocks the periods are counted to and the window is counted from"""
    freeze_now(importlib.import_module("app.routes.base_budgets.router"), FROZEN_MOMENT)
    freeze_now(date_window, FROZEN_MOMENT)


async def _count_periods(base_budget_id: str) -> int:
    """Count the period rows a base budget holds"""
    async with TestSession() as session:
        return await session.scalar(sa.select(sa.func.count()).select_from(Budget).where(Budget.base_budget_id == uuid.UUID(base_budget_id)))


async def test_create_recurring_budget_from_2024_makes_a_period_for_each_month_to_today(client):
    """A monthly budget starting 1 January 2024 has the 29 periods from then to May 2026, as before"""
    headers = _get_auth_header(await _create_user(client))
    category_id = await _create_category(client, headers)

    resp = await _create_base_budget(client, headers, category_ids=[category_id], recurs=True, period_start="2024-01-01", overall_limit=75000)

    assert resp.status_code == 201
    assert await _count_periods(resp.json()["id"]) == 29


async def test_create_weekly_budget_from_the_first_allowed_day_makes_every_week_since(client):
    """The cost at the window's edge is known: a weekly budget from 1 January 1900 has 6,593 periods"""
    headers = _get_auth_header(await _create_user(client))
    category_id = await _create_category(client, headers)

    resp = await _create_base_budget(
        client,
        headers,
        category_ids=[category_id],
        recurrence_freq="weekly",
        recurrence_weekday=0,
        recurrence_dom=None,
        recurs=True,
        period_start="1900-01-01",
        overall_limit=1,
    )

    assert resp.status_code == 201
    assert await _count_periods(resp.json()["id"]) == 6593


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        (
            {"recurrence_freq": "weekly", "recurrence_weekday": 0, "recurrence_dom": None, "period_start": "1850-01-01"},
            "Date must be on or after 1 January 1900",
        ),
        ({"period_start": "2040-01-01"}, "Date must be within ten years of today"),
    ],
)
async def test_create_recurring_budget_refuses_a_start_outside_the_window_and_creates_nothing(client, overrides, message):
    """A start before 1900 or past ten years from today is refused on the start date field"""
    headers = _get_auth_header(await _create_user(client))
    category_id = await _create_category(client, headers)

    resp = await _create_base_budget(client, headers, category_ids=[category_id], recurs=True, overall_limit=75000, **overrides)

    assert resp.status_code == 422
    [error] = resp.json()["detail"]
    assert error["loc"] == ["body", "period_start"]
    assert error["msg"] == message
    assert (await client.get("/base-budgets", headers=headers)).json() == []
