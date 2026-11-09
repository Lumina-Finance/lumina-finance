"""Planning which days a sync fetches, and for which links

A link left out of a sync it was due for waits a day, one paused or waiting for its bank account to
be chosen again must send nothing, an import the pause held back leaves a gap in the history, one
waiting to retry that joins early is fetched again before its retry is due, a re-read too short
misses late postings and corrections, one
reaching before the import start brings in days the ledger already covers, a window longer than
SimpleFIN Bridge allows is refused on every retry, and halves that don't meet exactly skip or
repeat a day. Days are the profile timezone's: an import starting today there is due, and one
starting tomorrow there, though already today in UTC, would ask for a window ending before it starts
"""

import uuid
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.models.bank_connection import BankAccountLink, BankLinkState
from app.services.bank_sync.windows import LinkNeed, SyncWindow, find_due_links, plan_window
from tests.routes.support.bank_sync_helpers import _build_account, _build_bank_link

# Without clock changes, so the examples' windows are whole runs of 90 calendar days
_BRISBANE = ZoneInfo("Australia/Brisbane")
_TORONTO = ZoneInfo("America/Toronto")

# 1 pm on 4 October in Brisbane
_NOW = datetime(2026, 10, 4, 13, 0, tzinfo=_BRISBANE)
_TODAY = date(2026, 10, 4)


def _link(**values) -> BankAccountLink:
    """Return an unsaved active link, not paused, never synced, not waiting to retry and with no import running, with the fields given"""
    link = _build_bank_link(_build_account(uuid.uuid4()), None)
    link.id = uuid.uuid4()
    link.state = BankLinkState.ACTIVE
    link.paused = False
    link.retry_count = 0
    link.importing = False
    for field, value in values.items():
        setattr(link, field, value)
    return link


def test_plan_window_for_a_daily_sync_never_rereads_before_the_import_start():
    """Everyday, imported from 25 September and synced yesterday through 3 October, re-reads from 25 September rather than 19 September"""
    link = _link(import_start=date(2026, 9, 25), checkpoint=date(2026, 10, 3), last_success_at=datetime(2026, 10, 3, 9, 0, tzinfo=_BRISBANE))

    window = plan_window(find_due_links([link], now=_NOW, timezone=_BRISBANE, overlap_days=14), today=_TODAY, timezone=_BRISBANE, max_days=90)

    assert (window.first_day, window.last_day) == (date(2026, 9, 25), _TODAY)


@pytest.mark.parametrize(
    ("values", "is_due"),
    [
        ({}, True),
        ({"next_attempt_at": _NOW + timedelta(hours=12)}, True),
        ({"next_attempt_at": _NOW + timedelta(hours=12, minutes=1)}, False),
        ({"paused": True}, False),
        ({"paused": True, "importing": True}, True),
        ({"state": BankLinkState.CHOOSE_ACCOUNT}, False),
        ({"import_start": _TODAY, "checkpoint": _TODAY - timedelta(days=1)}, True),
        ({"retry_count": 1, "next_attempt_at": _NOW}, True),
        ({"retry_count": 1, "next_attempt_at": _NOW + timedelta(minutes=1)}, False),
    ],
    ids=[
        "no_next_attempt",
        "due_in_12_hours",
        "due_in_12_hours_and_a_minute",
        "paused_for_review",
        "paused_but_importing",
        "waiting_to_choose_its_bank_account",
        "import_starting_today",
        "retry_due_now",
        "retry_due_in_a_minute",
    ],
)
def test_find_due_links_takes_in_active_links_due_within_12_hours_unless_paused(values, is_due):
    """A link due later today joins the sync now, so the connection's links share one request a day

    A link waiting to retry joins only once its retry is due, so a failure isn't fetched again ahead
    of the 30 minutes its retry waits
    """
    link = _link(**{"import_start": date(2026, 9, 1), "checkpoint": date(2026, 8, 31)} | values)

    due = find_due_links([link], now=_NOW, timezone=_BRISBANE, overlap_days=14)

    assert [need.link for need in due] == ([link] if is_due else [])


@pytest.mark.parametrize(
    ("values", "is_due"),
    [
        ({"next_attempt_at": _NOW + timedelta(hours=20)}, True),
        ({"next_attempt_at": _NOW + timedelta(days=3)}, True),
        ({"paused": True, "next_attempt_at": _NOW + timedelta(hours=20)}, False),
        ({"state": BankLinkState.CHOOSE_ACCOUNT, "next_attempt_at": _NOW + timedelta(hours=20)}, False),
        ({"retry_count": 1, "next_attempt_at": _NOW + timedelta(minutes=1)}, False),
        ({"last_failure_reason": "Sign in to your bank again", "next_attempt_at": _NOW + timedelta(hours=20)}, False),
    ],
    ids=["due_in_20_hours", "due_in_3_days", "paused_for_review", "waiting_to_choose_its_bank_account", "retry_not_due", "bank_sign_in_needed"],
)
def test_find_due_links_with_a_sync_asked_for_takes_in_every_other_link_nothing_holds_back(values, is_due):
    """Sync now fetches Savings with Everyday whenever Savings is next due, since the request costs the same

    A link waiting on a retry, on the user at the bank or on the review pause stays out
    """
    everyday = _link(import_start=date(2026, 9, 1), checkpoint=date(2026, 8, 31))
    savings = _link(**{"import_start": date(2026, 9, 1), "checkpoint": date(2026, 8, 31)} | values)

    due = find_due_links([everyday, savings], now=_NOW, timezone=_BRISBANE, overlap_days=14, requested=[everyday.id])

    assert [need.link for need in due] == ([everyday, savings] if is_due else [everyday])


def test_find_due_links_leaves_out_an_import_starting_tomorrow_in_the_profile_timezone():
    """It's 8 pm on 3 October in Phoenix, already 4 October in UTC, so a link imported from 4 October has nothing to fetch yet

    An import start can run ahead of the profile's date after the user moves west, and a window for
    it would end before it starts. The provider refuses that
    """
    link = _link(import_start=date(2026, 10, 4), checkpoint=date(2026, 10, 3))

    due = find_due_links([link], now=datetime(2026, 10, 4, 3, tzinfo=UTC), timezone=ZoneInfo("America/Phoenix"), overlap_days=14)

    assert due == []


@pytest.mark.parametrize(
    ("first_day", "last_day"),
    [(date(2026, 10, 1), date(2026, 12, 28)), (date(2026, 2, 1), date(2026, 5, 1))],
    ids=["clocks_going_back_inside_it", "clocks_going_forward_inside_it"],
)
def test_plan_window_spans_at_most_90_days_of_elapsed_time_across_a_clock_change(first_day, last_day):
    """Clocks going back on 1 November would make 90 days in Toronto an hour too long, so the window ends a day sooner

    Clocks going forward on 8 March leave 90 days an hour short. SimpleFIN Bridge accepts that
    """
    need = LinkNeed(_link(import_start=first_day, checkpoint=first_day - timedelta(days=1)), first_day)

    window = plan_window([need], today=date(2026, 12, 31), timezone=_TORONTO, max_days=90)

    start, end = window.bounds(_TORONTO)
    assert (window.first_day, window.last_day) == (first_day, last_day)
    assert end.astimezone(UTC) - start.astimezone(UTC) <= timedelta(days=90)


def test_halves_of_a_90_day_window_meet_and_the_earlier_leaves_out_links_whose_need_starts_later():
    """1 January to 31 March splits at 14 February with no day missed or repeated, and Savings, needed from 1 March, is only in the later"""
    everyday = LinkNeed(_link(import_start=date(2026, 1, 1), checkpoint=date(2025, 12, 31)), date(2026, 1, 1))
    savings = LinkNeed(_link(import_start=date(2026, 3, 1), checkpoint=date(2026, 2, 28)), date(2026, 3, 1))

    earlier, later = SyncWindow(date(2026, 1, 1), date(2026, 3, 31), (everyday, savings)).halves()

    assert earlier == SyncWindow(date(2026, 1, 1), date(2026, 2, 14), (everyday,))
    assert later == SyncWindow(date(2026, 2, 15), date(2026, 3, 31), (everyday, savings))
