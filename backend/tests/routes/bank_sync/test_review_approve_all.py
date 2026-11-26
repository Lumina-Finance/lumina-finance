"""Pressing Approve all adds every waiting new item whose saved rule values give a merchant and a category

The press adds an item with the merchant, category and tags saved on it and the bank's own date and
amount, and no notes. It matches no rules, so a rule edited since the item arrived changes nothing.
It leaves every other item waiting: the ones holding no merchant or category, the ones a write would
refuse for a known reason, the ones whose saved merchant or category is gone, and the ones decided
elsewhere meanwhile. It is all or nothing. A double submission adds each item once, and an add that
leaves 50 or fewer new items waiting resumes the account's paused sync at once
"""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select, update

from app.models.account import Account
from app.models.bank_transaction import BankTransaction, BankTransactionDisposition, OpenReviewKind
from app.models.tag import TransactionTag
from app.models.transaction import Transaction
from app.services.bank_sync import approve_all, review_pause
from app.utils import date_window
from app.utils.money import MAX_MINOR_UNITS
from tests.conftest import TestSession
from tests.routes.support.allowance_helpers import ALLOWANCE_REASON, refuse_other_currencies
from tests.routes.support.bank_sync_helpers import (
    BANK_DATE,
    _balances,
    _changed_at,
    _commit_other_users_account,
    _commit_paused_link,
    _commit_waiting_items,
    _dismiss_items,
    _ledger_rows,
    _new_account,
    _new_group_account,
    _pause_state,
    _record_bank_source,
    _record_ledger,
    _review_page,
    _stored_item,
)
from tests.routes.support.import_rule_helpers import _make_category, _make_merchant, _make_tag
from tests.routes.support.lock_helpers import _wait_until_waiting_on
from tests.routes.support.manual_entry_helpers import NOW
from tests.routes.support.query_helpers import _recorded_statements, _writes
from tests.routes.support.review_rule_helpers import _coffee_rule, _commit_filled_item, _queue_in_order, _rules_inbox, _saved

NOTHING_ADDED = {"added_ids": [], "account_ids": [], "more_to_add": False}


async def _approve(client, headers, account_ids: list[str] | None = None):
    """Press Approve all over some accounts or every one"""
    return await client.post("/bank-review/items/approve-all", json={"account_ids": account_ids}, headers=headers)


async def _filled(inbox, external_id: str, **values) -> uuid.UUID:
    """Commit a waiting item holding a merchant and a category a rule gave it, as a sync saved them"""
    rule = {"id": str(uuid.uuid4()), "name": "Coffee"}
    return await _commit_filled_item(inbox, _saved(rule, merchant_id=inbox.merchant_id, category_id=inbox.category_id), external_id, **values)


async def test_pressing_adds_the_three_items_holding_a_merchant_and_a_category_and_leaves_the_two_that_dont(client):
    """Of five waiting, three hold both, one a category only and one nothing, so two stay and a second press adds none"""
    inbox = await _rules_inbox(client)
    rule = await _coffee_rule(client, inbox)
    coffees = [
        await _commit_filled_item(inbox, _saved(rule, merchant_id=inbox.merchant_id, category_id=inbox.category_id), f"TRN-{n}")
        for n in range(3)
    ]
    category_only = await _commit_filled_item(inbox, _saved(rule, category_id=inbox.category_id), "TRN-3")
    unfilled = await _commit_filled_item(inbox, None, "TRN-4")
    assert (await _review_page(client, inbox.headers))["rules"]["any_addable"] is True

    pressed = await _approve(client, inbox.headers)

    assert pressed.status_code == 200, pressed.text
    assert pressed.json() == {
        "added_ids": [str(item_id) for item_id in sorted(coffees, reverse=True)],
        "account_ids": [inbox.everyday_id],
        "more_to_add": False,
    }
    after = await _review_page(client, inbox.headers)
    assert {item["id"] for item in after["items"]} == {str(category_only), str(unfilled)}
    assert after["counts"]["new"] == 2
    assert after["rules"]["any_addable"] is False
    assert len(await _ledger_rows(inbox.everyday_id)) == 3

    before = await _changed_at(client, inbox.headers)
    with client.expecting_no_change(), _recorded_statements() as statements:
        again = await _approve(client, inbox.headers)
    assert again.status_code == 200, again.text
    assert again.json() == NOTHING_ADDED
    assert _writes(statements) == [], "a press that adds nothing writes nothing"
    assert await _changed_at(client, inbox.headers) == before, "and marks no cache changed"


async def test_an_added_item_carries_the_saved_merchant_category_and_tags_the_banks_date_and_amount_and_no_notes(client):
    """The ledger row has Harbour Coffee, Coffee and the Treat tag on 3 October at -12.50 with no notes, and the item is accepted and aligned"""
    inbox = await _rules_inbox(client)
    tag_id = await _make_tag(client, inbox.headers, "Treat")
    rule = await _coffee_rule(client, inbox, tag_ids=[tag_id])
    saved = _saved(rule, merchant_id=inbox.merchant_id, category_id=inbox.category_id, tag_ids=(tag_id,))
    item_id = await _commit_filled_item(inbox, saved, "TRN-1", note="Morning flat white")

    with _recorded_statements() as statements:
        pressed = await _approve(client, inbox.headers)

    assert pressed.status_code == 200, pressed.text
    async with TestSession() as session:
        [row] = (
            await session.execute(
                select(
                    Transaction.id, Transaction.dt, Transaction.amount, Transaction.merchant_id, Transaction.category_id, Transaction.notes
                ).where(Transaction.account_id == uuid.UUID(inbox.everyday_id))
            )
        ).all()
        tags = list(await session.scalars(select(TransactionTag.tag_id).where(TransactionTag.transaction_id == row.id)))
    assert (row.dt, row.amount, str(row.merchant_id), str(row.category_id), row.notes) == (
        BANK_DATE,
        -1250,
        inbox.merchant_id,
        inbox.category_id,
        None,
    )
    assert [str(tag) for tag in tags] == [tag_id]
    stored = await _stored_item(item_id)
    assert stored.disposition == BankTransactionDisposition.ACCEPTED
    assert (stored.transaction_id, stored.aligned_date, stored.aligned_amount) == (row.id, BANK_DATE, -1250)
    assert await _balances(inbox.everyday_id) == [(BANK_DATE, -1250)]
    assert "user_cache_states" in _writes(statements)[-1]


async def test_a_rule_edited_since_the_item_arrived_changes_nothing_the_press_adds(client):
    """The Coffee rule now gives another merchant, and the press still adds the merchant the item arrived with"""
    inbox = await _rules_inbox(client)
    rule = await _coffee_rule(client, inbox)
    other_merchant = await _make_merchant(client, inbox.headers, "Corner Cafe")
    await _commit_filled_item(inbox, _saved(rule, merchant_id=inbox.merchant_id, category_id=inbox.category_id))
    edited = await client.patch(f"/import-rules/{rule['id']}", json={"merchant_id": other_merchant}, headers=inbox.headers)
    assert edited.status_code == 200, edited.text
    assert (await _review_page(client, inbox.headers))["rules"]["changed"] is True

    pressed = await _approve(client, inbox.headers)

    assert pressed.status_code == 200, pressed.text
    assert len(pressed.json()["added_ids"]) == 1
    async with TestSession() as session:
        merchant_ids = list(
            await session.scalars(select(Transaction.merchant_id).where(Transaction.account_id == uuid.UUID(inbox.everyday_id)))
        )
    assert [str(merchant_id) for merchant_id in merchant_ids] == [inbox.merchant_id]


async def test_an_item_the_saved_values_hold_but_a_write_would_refuse_stays_waiting_while_the_other_is_added(client):
    """One route case for the join with the account: the item of an archived account stays and the plain one is added

    What else keeps an item from being added, such as 33 tags or a date outside the window, is the
    service's table of cases, and a record that is gone is the review list's
    """
    inbox = await _rules_inbox(client)
    rule = await _coffee_rule(client, inbox)
    async with TestSession() as session:
        archived = await session.get_one(Account, uuid.UUID(inbox.savings_id))
        archived.is_archived = True
        await session.commit()
    both = {"merchant_id": inbox.merchant_id, "category_id": inbox.category_id}
    plain = await _commit_filled_item(inbox, _saved(rule, **both), "TRN-1")
    stays = await _commit_filled_item(inbox, _saved(rule, **both), "TRN-2", account_id=inbox.savings_id)

    pressed = await _approve(client, inbox.headers)

    assert pressed.status_code == 200, pressed.text
    assert pressed.json() == {"added_ids": [str(plain)], "account_ids": [inbox.everyday_id], "more_to_add": False}
    assert (await _stored_item(stays)).disposition == BankTransactionDisposition.AWAITING_REVIEW
    assert len(await _ledger_rows(inbox.everyday_id)) == 1
    assert await _ledger_rows(inbox.savings_id) == []


async def test_items_dated_on_the_inside_edges_of_the_window_are_added(client, pin_clock):
    """The first day of 1900 and the last day ten years ahead are both inside, so both are added"""
    pin_clock(datetime(2026, 6, 10, 12, 0, tzinfo=UTC), date_window)
    inbox = await _rules_inbox(client)
    first_day = await _filled(inbox, "TRN-1", observed_date=date_window.EARLIEST_ALLOWED_DATE)
    last_day = await _filled(inbox, "TRN-2", observed_date=date_window.get_latest_allowed_date())

    pressed = await _approve(client, inbox.headers)

    assert pressed.status_code == 200, pressed.text
    assert set(pressed.json()["added_ids"]) == {str(first_day), str(last_day)}


async def test_the_press_over_two_of_three_accounts_leaves_the_third_alone(client):
    """Everyday and Savings are pressed and the Holiday item holding the same values waits"""
    inbox = await _rules_inbox(client)
    holiday_id = await _new_account(client, inbox.headers, "Holiday")
    items = {
        name: await _filled(inbox, f"TRN-{name}", account_id=account_id)
        for name, account_id in (("e", inbox.everyday_id), ("s", inbox.savings_id), ("h", holiday_id))
    }

    pressed = await _approve(client, inbox.headers, [inbox.everyday_id, inbox.savings_id])

    assert pressed.status_code == 200, pressed.text
    assert set(pressed.json()["added_ids"]) == {str(items["e"]), str(items["s"])}
    assert pressed.json()["account_ids"] == sorted([inbox.everyday_id, inbox.savings_id])
    assert (await _stored_item(items["h"])).disposition == BankTransactionDisposition.AWAITING_REVIEW
    assert await _ledger_rows(holiday_id) == []


async def test_a_press_leaves_the_items_of_an_account_the_check_keeps_read_only_waiting(client):
    """The Travel account in US dollars takes nothing once the check refuses other currencies, so its item waits and isn't counted"""
    inbox = await _rules_inbox(client)
    travel_id = await _new_account(client, inbox.headers, "Travel", currency="USD")
    travel_item = await _filled(inbox, "TRN-travel", account_id=travel_id)
    everyday_item = await _filled(inbox, "TRN-everyday")
    refuse_other_currencies()

    pressed = await _approve(client, inbox.headers)

    assert pressed.status_code == 200, pressed.text
    assert pressed.json() == {"added_ids": [str(everyday_item)], "account_ids": [inbox.everyday_id], "more_to_add": False}
    assert (await _stored_item(travel_item)).disposition == BankTransactionDisposition.AWAITING_REVIEW
    assert await _ledger_rows(travel_id) == []

    # Only the Travel item is ready now, so the list says the check's sentence rather than that none is ready
    rules = (await _review_page(client, inbox.headers))["rules"]
    assert rules == {"any_addable": False, "changed": False, "read_only_reason": ALLOWANCE_REASON}
    with client.expecting_no_change():
        named = await _approve(client, inbox.headers, [travel_id])
    assert named.status_code == 200, named.text
    assert named.json() == NOTHING_ADDED


async def test_a_press_adds_the_items_of_an_account_in_another_currency_while_the_check_allows_it(client):
    """With no refusal installed the Travel account in US dollars takes its item like any other"""
    inbox = await _rules_inbox(client)
    travel_id = await _new_account(client, inbox.headers, "Travel", currency="USD")
    travel_item = await _filled(inbox, "TRN-travel", account_id=travel_id)
    assert (await _review_page(client, inbox.headers))["rules"]["read_only_reason"] is None

    pressed = await _approve(client, inbox.headers)

    assert pressed.status_code == 200, pressed.text
    assert pressed.json()["added_ids"] == [str(travel_item)]


async def test_a_press_over_a_group_account_is_refused_and_one_over_another_users_account_isnt_found(client):
    """As the list has it, a group account answers 403 and another person's 404, and nothing is added"""
    inbox = await _rules_inbox(client)
    joint_id = await _new_group_account(client, inbox.headers)
    theirs = await _commit_other_users_account()
    mine = await _filled(inbox, "TRN-1")

    group = await _approve(client, inbox.headers, [inbox.everyday_id, joint_id])
    another = await _approve(client, inbox.headers, [inbox.everyday_id, str(theirs.id)])

    assert (group.status_code, group.json()["detail"]) == (403, "Bank items aren't listed for accounts shared with a group")
    assert (another.status_code, another.json()["detail"]) == (404, "Account not found")
    assert (await _stored_item(mine)).disposition == BankTransactionDisposition.AWAITING_REVIEW


async def test_a_correction_is_never_touched(client):
    """A correction waiting on the ledger's Harbour Coffee row stays exactly as it was while the new item is added"""
    inbox = await _rules_inbox(client)
    [ledger_id] = await _record_ledger(client, inbox.headers, inbox.everyday_id, (BANK_DATE.isoformat(), -1250))
    correction = await _record_bank_source(ledger_id, "TRN-1")
    async with TestSession() as session:
        (await session.get_one(BankTransaction, correction)).open_kind = OpenReviewKind.CORRECTION
        await session.commit()
    stored_before = await _stored_item(correction)
    new_item = await _filled(inbox, "TRN-2")

    pressed = await _approve(client, inbox.headers)

    assert pressed.json()["added_ids"] == [str(new_item)]
    stored = await _stored_item(correction)
    assert (stored.disposition, stored.open_kind, stored.version, stored.transaction_id) == (
        stored_before.disposition,
        OpenReviewKind.CORRECTION,
        stored_before.version,
        uuid.UUID(ledger_id),
    )
    assert len(await _ledger_rows(inbox.everyday_id)) == 2


async def test_a_press_adds_at_most_the_limit_newest_first_and_says_more_are_left(client, monkeypatch):
    """With a limit of 2 and three items on three days, the two newest are added and more are left, and a second press adds the oldest"""
    monkeypatch.setattr(approve_all, "MAX_ADDED_PER_PRESS", 2)
    inbox = await _rules_inbox(client)
    days = [BANK_DATE - timedelta(days=number) for number in range(3)]
    newest, middle, oldest = [await _filled(inbox, f"TRN-{day}", observed_date=day) for day in days]

    first = await _approve(client, inbox.headers)
    second = await _approve(client, inbox.headers)

    assert first.json() == {"added_ids": [str(newest), str(middle)], "account_ids": [inbox.everyday_id], "more_to_add": True}
    assert second.json() == {"added_ids": [str(oldest)], "account_ids": [inbox.everyday_id], "more_to_add": False}


async def test_a_press_that_adds_exactly_the_limit_with_nothing_more_left_says_no_more_are_left(client, monkeypatch):
    """With a limit of 2 and two items, both are added and the answer doesn't ask for another press"""
    monkeypatch.setattr(approve_all, "MAX_ADDED_PER_PRESS", 2)
    inbox = await _rules_inbox(client)
    items = [await _filled(inbox, f"TRN-{number}", observed_date=BANK_DATE - timedelta(days=number)) for number in range(2)]

    pressed = await _approve(client, inbox.headers)

    assert pressed.json() == {"added_ids": [str(item_id) for item_id in items], "account_ids": [inbox.everyday_id], "more_to_add": False}


async def test_a_failure_in_one_write_adds_nothing(client):
    """Two payments of the most an account can hold are each fine alone, but the second overflows the balance, so neither is added"""
    inbox = await _rules_inbox(client)
    rule = await _coffee_rule(client, inbox)
    salary_id = await _make_category(client, inbox.headers, "Wages", "income")
    saved = _saved(rule, merchant_id=inbox.merchant_id, category_id=salary_id)
    first = await _commit_filled_item(inbox, saved, "TRN-1", observed_amount=MAX_MINOR_UNITS)
    second = await _commit_filled_item(inbox, saved, "TRN-2", observed_amount=MAX_MINOR_UNITS)

    pressed = await _approve(client, inbox.headers)

    assert pressed.status_code == 422, pressed.text
    assert pressed.json()["detail"] == "Everyday would end up with a larger balance than an account can hold"
    assert await _ledger_rows(inbox.everyday_id) == []
    for item_id in (first, second):
        assert (await _stored_item(item_id)).disposition == BankTransactionDisposition.AWAITING_REVIEW


@pytest.mark.parametrize(
    ("waiting", "pause_state"),
    [(52, (True, NOW + timedelta(days=1), [])), (51, (False, NOW, ["scheduled"]))],
    ids=["leaves_51", "leaves_50"],
)
async def test_a_press_that_leaves_50_new_items_waiting_resumes_the_paused_sync_at_once(client, pin_clock, waiting, pause_state):
    """Everyday is paused for review with the one item holding values among its new items, and adding it leaves 51 or 50"""
    pin_clock(NOW, review_pause)
    inbox = await _rules_inbox(client)
    await _filled(inbox, "TRN-MARKET")
    link = await _commit_paused_link(inbox.everyday_id, NOW)
    await _commit_waiting_items(link, waiting - 1)

    with _recorded_statements() as statements:
        pressed = await _approve(client, inbox.headers)

    assert pressed.status_code == 200, pressed.text
    assert len(pressed.json()["added_ids"]) == 1
    assert await _pause_state(link) == pause_state
    assert "user_cache_states" in _writes(statements)[-1]


async def test_a_double_submitted_press_adds_each_item_once(client):
    """Both presses read the two items waiting and queue behind them. The first adds both and the second finds them decided"""
    inbox = await _rules_inbox(client)
    item_ids = [await _filled(inbox, f"TRN-{number}") for number in range(2)]

    async with asyncio.timeout(10), TestSession() as holder:
        await holder.execute(select(BankTransaction.id).where(BankTransaction.id.in_(item_ids)).with_for_update())
        holder_pid = await holder.scalar(select(func.pg_backend_pid()))
        both = asyncio.gather(_approve(client, inbox.headers), _approve(client, inbox.headers))
        await _wait_until_waiting_on(holder_pid, both, waiters=2)
        await holder.commit()
        first, second = await both

    assert (first.status_code, second.status_code) == (200, 200), (first.text, second.text)
    answers = sorted([first.json(), second.json()], key=lambda answer: len(answer["added_ids"]))
    assert answers[0] == NOTHING_ADDED
    assert sorted(answers[1]["added_ids"]) == sorted(str(item_id) for item_id in item_ids)
    assert len(await _ledger_rows(inbox.everyday_id)) == 2


async def test_a_press_and_a_single_add_of_the_same_item_add_it_once(client):
    """The single add queues first and adds it, so the press finds it added and adds nothing"""
    inbox = await _rules_inbox(client)
    item_id = await _filled(inbox, "TRN-1")
    single = {"dt": BANK_DATE.isoformat(), "amount": -1250, "merchant_id": inbox.merchant_id, "category_id": inbox.category_id}

    async with asyncio.timeout(10), TestSession() as holder:
        await holder.execute(select(BankTransaction.id).where(BankTransaction.id == item_id).with_for_update())
        holder_pid = await holder.scalar(select(func.pg_backend_pid()))
        adding, pressing = await _queue_in_order(
            holder_pid,
            client.post(f"/bank-review/items/{item_id}/add", json=single, headers=inbox.headers),
            _approve(client, inbox.headers),
        )
        await holder.commit()
        added, pressed = await asyncio.gather(adding, pressing)

    assert (added.status_code, pressed.status_code) == (201, 200), (added.text, pressed.text)
    assert pressed.json() == NOTHING_ADDED
    assert len(await _ledger_rows(inbox.everyday_id)) == 1
    assert await _balances(inbox.everyday_id) == [(BANK_DATE, -1250)]


async def test_a_press_and_a_single_add_of_the_same_item_when_the_press_is_first_still_leave_the_ledger_holding_it_once(client):
    """The press queues first and adds the item, so the single add finds it added and the ledger holds it once"""
    inbox = await _rules_inbox(client)
    item_id = await _filled(inbox, "TRN-1")
    single = {"dt": BANK_DATE.isoformat(), "amount": -1250, "merchant_id": inbox.merchant_id, "category_id": inbox.category_id}

    async with asyncio.timeout(10), TestSession() as holder:
        await holder.execute(select(BankTransaction.id).where(BankTransaction.id == item_id).with_for_update())
        holder_pid = await holder.scalar(select(func.pg_backend_pid()))
        pressing, adding = await _queue_in_order(
            holder_pid,
            _approve(client, inbox.headers),
            client.post(f"/bank-review/items/{item_id}/add", json=single, headers=inbox.headers),
        )
        await holder.commit()
        pressed, added = await asyncio.gather(pressing, adding)

    assert pressed.status_code == 200, pressed.text
    assert pressed.json()["added_ids"] == [str(item_id)]
    assert added.status_code == 201, added.text
    assert len(await _ledger_rows(inbox.everyday_id)) == 1
    assert await _balances(inbox.everyday_id) == [(BANK_DATE, -1250)]


async def test_an_item_dismissed_in_another_tab_while_the_press_waited_is_left_out(client):
    """Both items were waiting when the press read them. One was dismissed before the press got its lock, so only the other is added"""
    inbox = await _rules_inbox(client)
    kept, dismissed = [await _filled(inbox, f"TRN-{number}") for number in range(2)]

    async with asyncio.timeout(10), TestSession() as other_tab:
        await other_tab.execute(select(BankTransaction.id).where(BankTransaction.id.in_([kept, dismissed])).with_for_update())
        other_pid = await other_tab.scalar(select(func.pg_backend_pid()))
        pressing = asyncio.create_task(_approve(client, inbox.headers))
        await _wait_until_waiting_on(other_pid, pressing)
        await _dismiss_items(other_tab, [dismissed])
        await other_tab.commit()
        pressed = await pressing

    assert pressed.status_code == 200, pressed.text
    assert pressed.json()["added_ids"] == [str(kept)]
    assert (await _stored_item(dismissed)).disposition == BankTransactionDisposition.DISMISSED
    assert len(await _ledger_rows(inbox.everyday_id)) == 1


async def test_an_item_a_sync_refilled_while_the_press_waited_is_added_as_it_now_stands(client):
    """The sync put one item through rules that give it no merchant before the press got its lock, so only the other is added"""
    inbox = await _rules_inbox(client)
    kept, refilled = [await _filled(inbox, f"TRN-{number}") for number in range(2)]

    async with asyncio.timeout(10), TestSession() as sync:
        await sync.execute(select(BankTransaction.id).where(BankTransaction.id.in_([kept, refilled])).with_for_update())
        sync_pid = await sync.scalar(select(func.pg_backend_pid()))
        pressing = asyncio.create_task(_approve(client, inbox.headers))
        await _wait_until_waiting_on(sync_pid, pressing)
        await sync.execute(
            update(BankTransaction).where(BankTransaction.id == refilled).values(rule_fill=None, version=BankTransaction.version + 1)
        )
        await sync.commit()
        pressed = await pressing

    assert pressed.status_code == 200, pressed.text
    assert pressed.json()["added_ids"] == [str(kept)]
    assert (await _stored_item(refilled)).disposition == BankTransactionDisposition.AWAITING_REVIEW
