"""Pressing Apply rules puts every waiting new item through the person's import rules as they stand now

The press replaces the values saved on each item, clearing the ones the rules no longer give, and
saves the digest of the rules with them. It covers every waiting new item the person owns, whatever
accounts the list shows, and answers how many items' values changed. An item whose values come out the
same takes the new digest and keeps its version, so a selection made before the press still holds.
It locks bank transactions only, by id, and never an account's link, so a sync is never held up
"""

import asyncio
import uuid

from sqlalchemy import func, select

from app.models.bank_transaction import BankTransaction, BankTransactionDisposition
from app.models.category import Category
from app.services.bank_sync import rule_fills
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    _DISMISSED,
    BANK_DATE,
    _changed_at,
    _commit_other_users_account,
    _commit_review_item,
    _import_a_file,
    _ledger_rows,
    _new_group_account,
    _review_page,
    _stored_item,
    _undoable_import,
)
from tests.routes.support.import_rule_helpers import _delete_rule_and_record_after_rules_load
from tests.routes.support.lock_helpers import _wait_until_waiting_on
from tests.routes.support.query_helpers import _recorded_statements
from tests.routes.support.review_rule_helpers import (
    _coffee_rule,
    _commit_filled_item,
    _current_digest,
    _queue_in_order,
    _rules_inbox,
    _saved,
)

_STALE = "b" * 64


async def _apply(client, headers):
    """Press Apply rules"""
    return await client.post("/bank-review/items/apply-rules", headers=headers)


def _old_fill() -> dict:
    """Return values a rule since deleted gave, as an item saved them"""
    return {"merchant": {"id": str(uuid.uuid4()), "rule": {"id": str(uuid.uuid4()), "name": "Old"}}}


async def test_pressing_replaces_the_values_and_clears_the_ones_the_rules_no_longer_give_and_answers_how_many_changed(client):
    """One item gets the coffee values, one loses its old ones, one already holds exactly what the rules give and keeps its version"""
    inbox = await _rules_inbox(client)
    rule = await _coffee_rule(client, inbox)
    current = _saved(rule, merchant_id=inbox.merchant_id, category_id=inbox.category_id)
    refilled = await _commit_filled_item(inbox, _old_fill(), "TRN-1", rules_version=_STALE)
    cleared = await _commit_filled_item(inbox, _old_fill(), "TRN-2", rules_version=_STALE, description="LIBRARY FINES")
    same = await _commit_filled_item(inbox, current, "TRN-3", rules_version=_STALE)
    savings = await _commit_filled_item(inbox, None, "TRN-4", account_id=inbox.savings_id, rules_version=None)
    assert (await _review_page(client, inbox.headers))["rules"]["changed"] is True
    digest = await _current_digest(inbox)

    pressed = await _apply(client, inbox.headers)

    assert pressed.status_code == 200, pressed.text
    assert pressed.json() == {"changed_count": 3}
    for item_id, fill, version in ((refilled, current, 2), (cleared, None, 2), (same, current, 1), (savings, current, 2)):
        stored = await _stored_item(item_id)
        assert (stored.rule_fill, stored.rules_version, stored.version) == (fill, digest, version), item_id
    assert (await _review_page(client, inbox.headers))["rules"]["changed"] is False


async def test_pressing_refreshes_the_pages_and_leaves_a_file_imported_just_before_undoable(client):
    """The press changes none of the ledger, so the Wallet file imported before it can still be undone"""
    inbox = await _rules_inbox(client)
    await _coffee_rule(client, inbox)
    await _commit_filled_item(inbox, None, "TRN-1", rules_version=_STALE)
    await _import_a_file(client, inbox.headers)
    assert await _undoable_import(client, inbox.headers) is not None
    before = await _changed_at(client, inbox.headers)

    pressed = await _apply(client, inbox.headers)

    assert pressed.json() == {"changed_count": 1}
    assert await _changed_at(client, inbox.headers) != before
    assert await _undoable_import(client, inbox.headers) is not None


async def test_a_second_press_changes_nothing_and_answers_none(client):
    """Every item is current after the first press, so the next writes nothing"""
    inbox = await _rules_inbox(client)
    await _coffee_rule(client, inbox)
    await _commit_filled_item(inbox, None, "TRN-1", rules_version=_STALE)
    first = await _apply(client, inbox.headers)

    with client.expecting_no_change():
        second = await _apply(client, inbox.headers)

    assert first.json() == {"changed_count": 1}
    assert second.status_code == 200, second.text
    assert second.json() == {"changed_count": 0}


async def test_a_press_that_only_saves_the_new_digest_still_refreshes_the_list(client):
    """No value changes, but the offer reads the digest, so the press marks the cache as it would for a change"""
    inbox = await _rules_inbox(client)
    await _coffee_rule(client, inbox)
    item = await _commit_filled_item(inbox, None, "TRN-1", rules_version=_STALE, description="LIBRARY FINES")

    pressed = await _apply(client, inbox.headers)

    assert pressed.json() == {"changed_count": 0}
    stored = await _stored_item(item)
    assert (stored.rules_version, stored.version) == (await _current_digest(inbox), 1)
    assert (await _review_page(client, inbox.headers))["rules"]["changed"] is False


async def test_pressing_after_the_last_rule_is_deleted_clears_every_value_the_rules_gave(client):
    """The item a deleted rule filled goes back to nothing filled, saved with the digest of no rules"""
    inbox = await _rules_inbox(client)
    rule = await _coffee_rule(client, inbox)
    item = await _commit_filled_item(inbox, _saved(rule, merchant_id=inbox.merchant_id, category_id=inbox.category_id))
    deleted = await client.delete(f"/import-rules/{rule['id']}", headers=inbox.headers)
    assert deleted.status_code == 204, deleted.text

    pressed = await _apply(client, inbox.headers)

    assert pressed.json() == {"changed_count": 1}
    stored = await _stored_item(item)
    assert (stored.rule_fill, stored.rules_version) == (None, await _current_digest(inbox))
    assert (await _review_page(client, inbox.headers))["rules"] == {"any_addable": False, "changed": False, "read_only_reason": None}


async def test_only_the_users_waiting_new_items_are_put_through_the_rules(client):
    """A dismissed item and another person's item keep what they hold"""
    inbox = await _rules_inbox(client)
    await _coffee_rule(client, inbox)
    theirs = await _commit_other_users_account()
    their_item = await _commit_review_item(theirs.id, "THEIRS-1", rules_version=_STALE)
    dismissed = await _commit_review_item(inbox.everyday_id, "TRN-9", **_DISMISSED)
    mine = await _commit_filled_item(inbox, None, "TRN-1", rules_version=_STALE)

    pressed = await _apply(client, inbox.headers)

    assert pressed.json() == {"changed_count": 1}
    assert (await _stored_item(their_item)).rules_version == _STALE
    stored = await _stored_item(dismissed)
    assert (stored.disposition, stored.rule_fill, stored.rules_version, stored.version) == (BankTransactionDisposition.DISMISSED, None, None, 1)
    assert (await _stored_item(mine)).rule_fill is not None


async def test_a_press_over_more_items_than_one_chunk_covers_all_of_them(client, monkeypatch):
    """With chunks of two, five items are locked and saved in three rounds and all five are counted"""
    monkeypatch.setattr(rule_fills, "SCAN_CHUNK_SIZE", 2)
    inbox = await _rules_inbox(client)
    await _coffee_rule(client, inbox)
    items = [await _commit_filled_item(inbox, None, f"TRN-{number}", rules_version=_STALE) for number in range(5)]

    pressed = await _apply(client, inbox.headers)

    assert pressed.json() == {"changed_count": 5}
    digest = await _current_digest(inbox)
    for item_id in items:
        stored = await _stored_item(item_id)
        assert stored.rules_version == digest
        assert stored.rule_fill["merchant"]["id"] == inbox.merchant_id


async def test_the_press_locks_bank_transactions_by_id_and_never_an_accounts_link(client):
    """A sync holds the links for its whole write, so taking one here could deadlock with it"""
    inbox = await _rules_inbox(client)
    await _coffee_rule(client, inbox)
    await _commit_filled_item(inbox, None, "TRN-1", rules_version=_STALE)

    with _recorded_statements() as statements:
        pressed = await _apply(client, inbox.headers)

    assert pressed.status_code == 200, pressed.text
    locking = [statement for statement in statements if "FOR UPDATE" in statement]
    assert locking, "the rows are locked"
    assert all("FROM bank_transactions" in statement and "bank_account_links" not in statement for statement in locking)
    assert all("ORDER BY bank_transactions.id" in statement for statement in locking)


async def test_a_double_submitted_press_changes_each_item_once(client):
    """Both presses queue behind the item. The first saves the new values and the second finds them already saved"""
    inbox = await _rules_inbox(client)
    await _coffee_rule(client, inbox)
    item = await _commit_filled_item(inbox, None, "TRN-1", rules_version=_STALE)

    async with asyncio.timeout(10), TestSession() as holder:
        await holder.execute(select(BankTransaction.id).where(BankTransaction.id == item).with_for_update())
        holder_pid = await holder.scalar(select(func.pg_backend_pid()))
        both = asyncio.gather(_apply(client, inbox.headers), _apply(client, inbox.headers))
        await _wait_until_waiting_on(holder_pid, both, waiters=2)
        await holder.commit()
        first, second = await both

    assert (first.status_code, second.status_code) == (200, 200), (first.text, second.text)
    assert sorted([first.json()["changed_count"], second.json()["changed_count"]]) == [0, 1]
    assert (await _stored_item(item)).version == 2


async def test_an_item_added_while_the_press_waited_is_left_as_the_add_made_it(client):
    """The add queues first, so the press finds the item added and writes no values onto it"""
    inbox = await _rules_inbox(client)
    await _coffee_rule(client, inbox)
    item = await _commit_filled_item(inbox, None, "TRN-1", rules_version=_STALE)
    payload = {"dt": BANK_DATE.isoformat(), "amount": -1250, "merchant_id": inbox.merchant_id, "category_id": inbox.category_id}

    async with asyncio.timeout(10), TestSession() as holder:
        await holder.execute(select(BankTransaction.id).where(BankTransaction.id == item).with_for_update())
        holder_pid = await holder.scalar(select(func.pg_backend_pid()))
        adding, pressing = await _queue_in_order(
            holder_pid,
            client.post(f"/bank-review/items/{item}/add", json=payload, headers=inbox.headers),
            _apply(client, inbox.headers),
        )
        await holder.commit()
        added, pressed = await asyncio.gather(adding, pressing)

    assert (added.status_code, pressed.status_code) == (201, 200), (added.text, pressed.text)
    assert pressed.json() == {"changed_count": 0}
    stored = await _stored_item(item)
    assert stored.disposition == BankTransactionDisposition.ACCEPTED
    assert (stored.rule_fill, stored.rules_version) == (None, None)
    assert len(await _ledger_rows(inbox.everyday_id)) == 1


async def test_an_add_queued_after_the_press_adds_the_item_once_with_the_values_it_sends(client):
    """The press queues first and saves the coffee values, then the add takes the item with the values it sends"""
    inbox = await _rules_inbox(client)
    await _coffee_rule(client, inbox)
    item = await _commit_filled_item(inbox, None, "TRN-1", rules_version=_STALE)
    payload = {"dt": BANK_DATE.isoformat(), "amount": -1250, "merchant_id": inbox.merchant_id, "category_id": inbox.category_id}

    async with asyncio.timeout(10), TestSession() as holder:
        await holder.execute(select(BankTransaction.id).where(BankTransaction.id == item).with_for_update())
        holder_pid = await holder.scalar(select(func.pg_backend_pid()))
        pressing, adding = await _queue_in_order(
            holder_pid,
            _apply(client, inbox.headers),
            client.post(f"/bank-review/items/{item}/add", json=payload, headers=inbox.headers),
        )
        await holder.commit()
        pressed, added = await asyncio.gather(pressing, adding)

    assert (pressed.status_code, added.status_code) == (200, 201), (pressed.text, added.text)
    assert pressed.json() == {"changed_count": 1}
    assert (await _stored_item(item)).disposition == BankTransactionDisposition.ACCEPTED
    assert len(await _ledger_rows(inbox.everyday_id)) == 1


async def test_a_waiting_item_of_an_account_the_person_reaches_without_owning_is_left_as_it_is(client):
    """A group account's item with an old digest keeps its digest and values, and alone it doesn't make the offer to apply rules"""
    inbox = await _rules_inbox(client)
    await _coffee_rule(client, inbox)
    joint_id = await _new_group_account(client, inbox.headers)
    old_fill = _old_fill()
    group_item = await _commit_review_item(joint_id, "TRN-G", owner_id=inbox.user_id, rule_fill=old_fill, rules_version=_STALE)
    assert (await _review_page(client, inbox.headers))["rules"]["changed"] is False

    with client.expecting_no_change():
        pressed = await _apply(client, inbox.headers)

    assert pressed.json() == {"changed_count": 0}
    stored = await _stored_item(group_item)
    assert (stored.rule_fill, stored.rules_version, stored.version) == (old_fill, _STALE, 1)
    assert (await _review_page(client, inbox.headers))["rules"]["changed"] is False


async def test_a_category_deleted_after_the_press_read_the_rules_answers_that_the_rules_changed_and_changes_nothing(client, monkeypatch):
    """The rule naming the category goes with it once the press has read the rules, so the press changes nothing"""
    inbox = await _rules_inbox(client)
    rule = await _coffee_rule(client, inbox)
    old_fill = _old_fill()
    item = await _commit_filled_item(inbox, old_fill, "TRN-1", rules_version=_STALE)
    _delete_rule_and_record_after_rules_load(monkeypatch, rule_fills, rule["id"], Category, inbox.category_id)

    pressed = await _apply(client, inbox.headers)

    assert (pressed.status_code, pressed.json()["detail"]) == (
        409,
        "Your import rules or the records they name changed meanwhile. Please try again.",
    )
    stored = await _stored_item(item)
    assert (stored.rule_fill, stored.rules_version, stored.version) == (old_fill, _STALE, 1)
