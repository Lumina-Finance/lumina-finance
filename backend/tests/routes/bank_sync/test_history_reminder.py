"""Showing an account's reminders about history its bank may not have returned, and dismissing them

A reminder that doesn't show leaves a gap in the ledger nobody notices, and one that comes back once
dismissed nags. A dismissal that hides a newer reminder raised meanwhile hides a newer gap, one sent
twice writes twice, and one that marks the user's data changed ends the undo of their last import.
Only the owner's own personal account can dismiss one
"""

import asyncio
from datetime import date

import pytest
from sqlalchemy import func, select, update

from app.models.bank_connection import BankAccountLink
from app.services.bank_sync import account_link
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    _changed_at,
    _commit_other_users_account,
    _import_a_file,
    _new_account,
    _new_group_account,
    _sign_up,
    _undoable_import,
)
from tests.routes.support.history_reminder_helpers import _CUT_SHORT, _FELL_SHORT, _NOW, _SHOWN, _linked_everyday
from tests.routes.support.lock_helpers import _cancel_unfinished, _wait_until_waiting_on
from tests.routes.support.query_helpers import _recorded_statements, _writes


@pytest.fixture(autouse=True)
def _pinned_now(pin_clock):
    """Pin the time the account link route describes the link at"""
    pin_clock(_NOW, account_link)


async def _read_link(client, headers: dict, account_id: str) -> dict:
    """Read Everyday's live link through the account's bank link route"""
    response = await client.get(f"/accounts/{account_id}/bank-link", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["link"]


async def _dismiss_history(client, headers: dict, account_id: str, shown: dict):
    """Dismiss the history reminder as it showed, through the route"""
    return await client.post(f"/accounts/{account_id}/bank-link/history-reminder/dismiss", json=shown, headers=headers)


async def _dismiss_cut_off_day(client, headers: dict, account_id: str, day: str):
    """Dismiss the reminder about a day that may be missing transactions, through the route"""
    return await client.post(f"/accounts/{account_id}/bank-link/cut-off-day/dismiss", json={"day": day}, headers=headers)


def _link_writes(statements: list[str]) -> list[str]:
    """Return the writes to a bank link among the statements"""
    return [write for write in _writes(statements) if write.startswith("UPDATE bank_account_links")]


async def test_dismissing_the_history_reminder_hides_it_for_good(client):
    """Everyday's import from 1 June got history from 9 June, and the user dismisses its reminder

    The answer and the read after it leave it out, and the owner's pages hear of it from the cache
    mark, the last write
    """
    headers, account_id, _ = await _linked_everyday(client, **_FELL_SHORT)
    shown = await _read_link(client, headers, account_id)
    before = await _changed_at(client, headers)

    with _recorded_statements() as statements:
        dismissed = await _dismiss_history(client, headers, account_id, _SHOWN)

    assert shown["history_reminder"] == _SHOWN
    assert dismissed.status_code == 200, dismissed.text
    assert dismissed.json()["link"]["history_reminder"] is None
    assert "user_cache_states" in _writes(statements)[-1]
    assert await _changed_at(client, headers) != before
    assert (await _read_link(client, headers, account_id))["history_reminder"] is None


async def test_dismissing_the_reminder_about_a_day_leaves_the_history_reminder(client):
    """Everyday shows both reminders, and the user dismisses the one saying 2 October may be missing transactions

    Each ✕ dismisses its own reminder, so the history reminder stays until it is dismissed in turn
    """
    headers, account_id, _ = await _linked_everyday(client, **_FELL_SHORT, **_CUT_SHORT)
    shown = await _read_link(client, headers, account_id)
    before = await _changed_at(client, headers)

    with _recorded_statements() as statements:
        dismissed = await _dismiss_cut_off_day(client, headers, account_id, "2026-10-02")

    assert shown["cut_off_day"] == "2026-10-02"
    assert dismissed.status_code == 200, dismissed.text
    assert (dismissed.json()["link"]["cut_off_day"], dismissed.json()["link"]["history_reminder"]) == (None, _SHOWN)
    assert "user_cache_states" in _writes(statements)[-1]
    assert await _changed_at(client, headers) != before
    after = await _read_link(client, headers, account_id)
    assert (after["cut_off_day"], after["history_reminder"]) == (None, _SHOWN)


@pytest.mark.parametrize(
    ("link_values", "route", "sent", "showing"),
    [
        pytest.param(
            {**_FELL_SHORT, "history_reminder_dismissed": True}, "history-reminder", _SHOWN, ("history_reminder", None), id="history-dismissed"
        ),
        pytest.param(
            {"history_reminder_start": date(2026, 9, 21)},
            "history-reminder",
            _SHOWN,
            ("history_reminder", {"requested_start": "2026-09-21", "earliest_returned": None}),
            id="history-replaced",
        ),
        pytest.param(
            {**_CUT_SHORT, "cut_off_day_dismissed": True}, "cut-off-day", {"day": "2026-10-02"}, ("cut_off_day", None), id="day-dismissed"
        ),
        pytest.param(
            {"cut_off_day": date(2026, 10, 4)}, "cut-off-day", {"day": "2026-10-02"}, ("cut_off_day", "2026-10-04"), id="day-replaced"
        ),
    ],
)
async def test_dismissing_a_reminder_no_longer_showing_changes_nothing(client, link_values, route, sent, showing):
    """The user dismisses the reminder they saw after another tab dismissed it, or a later catch-up or day replaced it

    The answer is the account as it stands, a newer reminder still showing, and nothing is written
    """
    headers, account_id, _ = await _linked_everyday(client, **link_values)
    before = await _changed_at(client, headers)

    with _recorded_statements() as statements:
        dismissed = await client.post(f"/accounts/{account_id}/bank-link/{route}/dismiss", json=sent, headers=headers)

    assert dismissed.status_code == 200, dismissed.text
    field, value = showing
    assert dismissed.json()["link"][field] == value
    assert _writes(statements) == []
    assert await _changed_at(client, headers) == before


async def test_a_dismissal_queued_behind_a_sync_raising_a_newer_reminder_leaves_the_newer_one(client):
    """A sync holds Everyday's link while the user dismisses its reminder, and raises a catch-up's from 21 September before letting go

    The dismissal, queued behind the sync, finds the newer reminder rather than the one the user
    saw, so it answers with the newer one showing and writes nothing to the link
    """
    headers, account_id, link = await _linked_everyday(client, **_FELL_SHORT)
    newer = {"requested_start": "2026-09-21", "earliest_returned": None}

    requests: list[asyncio.Task] = []
    try:
        async with asyncio.timeout(10), TestSession() as holder:
            await holder.execute(select(BankAccountLink.id).where(BankAccountLink.id == link.id).with_for_update())
            holder_pid = await holder.scalar(select(func.pg_backend_pid()))
            with _recorded_statements() as statements:
                requests.append(asyncio.create_task(_dismiss_history(client, headers, account_id, _SHOWN)))
                await _wait_until_waiting_on(holder_pid, requests[0])
                await holder.execute(
                    update(BankAccountLink)
                    .where(BankAccountLink.id == link.id)
                    .values(history_reminder_start=date(2026, 9, 21), history_reminder_earliest=None)
                )
                await holder.commit()
                [dismissed] = await asyncio.gather(*requests)
    finally:
        await _cancel_unfinished(requests)

    assert dismissed.status_code == 200, dismissed.text
    assert dismissed.json()["link"]["history_reminder"] == newer
    assert _link_writes(statements) == []
    assert (await _read_link(client, headers, account_id))["history_reminder"] == newer


@pytest.mark.parametrize(
    ("route", "sent"), [("history-reminder", _SHOWN), ("cut-off-day", {"day": "2026-10-02"})], ids=["history-reminder", "cut-off-day"]
)
async def test_dismissing_for_an_unlinked_account_a_group_account_or_another_users_account_is_refused(client, route, sent):
    """Savings isn't linked, Joint belongs to the Smith Family group and Theirs to another user"""
    headers, _ = await _sign_up(client)
    savings_id = await _new_account(client, headers, "Savings")
    joint_id = await _new_group_account(client, headers)
    theirs = await _commit_other_users_account()
    refusals = [
        (savings_id, 404, "This account is not linked to a bank"),
        (joint_id, 403, "Accounts shared with a group can't be linked to a bank yet"),
        (str(theirs.id), 404, "Account not found"),
    ]

    for account_id, status_code, detail in refusals:
        response = await client.post(f"/accounts/{account_id}/bank-link/{route}/dismiss", json=sent, headers=headers)

        assert response.status_code == status_code, response.text
        assert response.json()["detail"] == detail


@pytest.mark.parametrize(
    ("route", "sent", "field"),
    [("history-reminder", _SHOWN, "history_reminder"), ("cut-off-day", {"day": "2026-10-02"}, "cut_off_day")],
    ids=["history-reminder", "cut-off-day"],
)
async def test_dismissing_a_reminder_leaves_the_last_import_undoable(client, route, sent, field):
    """The user imported a file, then dismissed one of Everyday's reminders

    A dismissal changes none of their data, so the import can still be undone
    """
    headers, account_id, _ = await _linked_everyday(client, **_FELL_SHORT, **_CUT_SHORT)
    await _import_a_file(client, headers)

    dismissed = await client.post(f"/accounts/{account_id}/bank-link/{route}/dismiss", json=sent, headers=headers)

    assert dismissed.status_code == 200, dismissed.text
    assert dismissed.json()["link"][field] is None
    assert await _undoable_import(client, headers) is not None
