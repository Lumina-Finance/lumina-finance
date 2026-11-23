"""Pressing Apply rules adds every waiting new item the user's import rules give a merchant and a fitting category

The press adds an item with the rules' merchant, category and tags and the bank's own date and amount,
and no notes, and leaves every other item waiting: the ones no rule gives both to, the ones a write
would refuse for a known reason, and the ones decided elsewhere meanwhile. It is all or nothing. It
sends back the version of the rules the list showed, and rules changed since refuse it before any
write. A double submission adds each item once, and an add that leaves 50 or fewer new items waiting
resumes the account's paused sync at once
"""

import asyncio
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import func, select, update

from app.models.account import Account
from app.models.bank_transaction import BankTransaction, BankTransactionDisposition, OpenReviewKind
from app.models.import_rule import ImportRule
from app.models.tag import TransactionTag
from app.models.transaction import Transaction
from app.schemas.import_run import MAX_IMPORT_TAGS_PER_ROW
from app.services.bank_sync import review_pause, rule_apply
from app.utils.money import MAX_MINOR_UNITS
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    BANK_DATE,
    _balances,
    _changed_at,
    _commit_other_users_account,
    _commit_paused_link,
    _commit_review_item,
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
from tests.routes.support.import_rule_helpers import _create_rule_ok, _description_contains, _make_category, _make_tag, _system_category_id
from tests.routes.support.lock_helpers import _wait_until_waiting_on
from tests.routes.support.manual_entry_helpers import NOW
from tests.routes.support.query_helpers import _recorded_statements, _writes
from tests.routes.support.review_rule_helpers import _apply, _rules_inbox, _rules_version

NOTHING_ADDED = {"added_ids": [], "account_ids": [], "more_to_add": False}


async def _coffee_rule(client, inbox, text: str = "harbour", **overrides) -> dict:
    """Create the rule Coffee, which gives Harbour Coffee and the Coffee expense category to a description containing some text"""
    return await _create_rule_ok(
        client,
        inbox.headers,
        name="Coffee",
        conditions=[_description_contains(text)],
        merchant_id=inbox.merchant_id,
        category_id=inbox.category_id,
        **overrides,
    )


async def _waiting_ids(client, headers) -> set[str]:
    """Return the ids of the new items the review list still shows"""
    page = await _review_page(client, headers)
    return {item["id"] for item in page["items"] if item["kind"] == "new"}


async def test_pressing_adds_the_three_items_the_rules_fill_and_leaves_the_two_that_aren_t_filled_in_full(client):
    """Of five waiting, three get a merchant and a category, one a category only and one nothing, so two stay and a second press adds none"""
    inbox = await _rules_inbox(client)
    await _coffee_rule(client, inbox)
    groceries_id = await _make_category(client, inbox.headers, "Corner shop")
    await _create_rule_ok(client, inbox.headers, name="Groceries", conditions=[_description_contains("grocer")], category_id=groceries_id)
    coffees = [await _commit_review_item(inbox.everyday_id, f"TRN-{number}") for number in range(3)]
    category_only = await _commit_review_item(inbox.everyday_id, "TRN-3", description="CORNER GROCER 12")
    unmatched = await _commit_review_item(inbox.everyday_id, "TRN-4", description="LIBRARY FINES")
    version = await _rules_version(client, inbox.headers)
    page = await _review_page(client, inbox.headers)
    assert (page["rules"]["any_matches"], page["rules"]["any_addable"]) == (True, True)

    pressed = await _apply(client, inbox.headers, version)

    assert pressed.status_code == 200, pressed.text
    assert pressed.json() == {
        "added_ids": [str(item_id) for item_id in sorted(coffees, reverse=True)],
        "account_ids": [inbox.everyday_id],
        "more_to_add": False,
    }
    after = await _review_page(client, inbox.headers)
    assert {item["id"] for item in after["items"]} == {str(category_only), str(unmatched)}
    assert after["counts"]["new"] == 2
    assert (after["rules"]["any_matches"], after["rules"]["any_addable"]) == (True, False), "one item is only given a category"
    assert [item["rule_fill"]["category"]["name"] for item in after["items"] if item["id"] == str(category_only)] == ["Corner shop"]
    assert len(await _ledger_rows(inbox.everyday_id)) == 3

    before = await _changed_at(client, inbox.headers)
    with client.expecting_no_change(), _recorded_statements() as statements:
        again = await _apply(client, inbox.headers, after["rules"]["version"])
    assert again.status_code == 200, again.text
    assert again.json() == NOTHING_ADDED
    assert _writes(statements) == [], "a press that adds nothing writes nothing"
    assert await _changed_at(client, inbox.headers) == before, "and marks no cache changed"


async def test_an_added_item_carries_the_rules_merchant_category_and_tags_the_banks_date_and_amount_and_no_notes(client):
    """The ledger row has Harbour Coffee, Coffee and the Treat tag on 3 October at -12.50 with no notes, and the item is accepted and aligned"""
    inbox = await _rules_inbox(client)
    tag_id = await _make_tag(client, inbox.headers, "Treat")
    await _coffee_rule(client, inbox, tag_ids=[tag_id])
    item_id = await _commit_review_item(inbox.everyday_id, "TRN-1", note="Morning flat white")
    version = await _rules_version(client, inbox.headers)

    with _recorded_statements() as statements:
        pressed = await _apply(client, inbox.headers, version)

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


async def test_items_a_write_would_refuse_stay_waiting_while_the_other_is_added(client):
    """A transfer category, an archived account, 33 tags, an unreadable amount and a wrong-kind category each stay, and the coffee is added"""
    inbox = await _rules_inbox(client)
    await _coffee_rule(client, inbox)
    moves = await _create_rule_ok(
        client,
        inbox.headers,
        name="Moves",
        conditions=[_description_contains("xfer")],
        merchant_id=inbox.merchant_id,
        category_id=inbox.category_id,
    )
    tag_ids = [await _make_tag(client, inbox.headers, f"Tag {number}") for number in range(MAX_IMPORT_TAGS_PER_ROW + 1)]
    await _create_rule_ok(
        client,
        inbox.headers,
        name="Many",
        conditions=[_description_contains("tagged")],
        merchant_id=inbox.merchant_id,
        category_id=inbox.category_id,
        tag_ids=tag_ids[:MAX_IMPORT_TAGS_PER_ROW],
    )
    await _create_rule_ok(client, inbox.headers, name="Extra", conditions=[_description_contains("tagged")], tag_ids=tag_ids[-1:])
    salary_id = await _make_category(client, inbox.headers, "Wages", "income")
    await _create_rule_ok(
        client, inbox.headers, name="Pay", conditions=[_description_contains("paid")], merchant_id=inbox.merchant_id, category_id=salary_id
    )
    transfer_id = await _system_category_id(client, inbox.headers, "Transfer")
    async with TestSession() as session:
        await session.execute(update(ImportRule).where(ImportRule.id == uuid.UUID(moves["id"])).values(category_id=uuid.UUID(transfer_id)))
        archived = await session.get_one(Account, uuid.UUID(inbox.savings_id))
        archived.is_archived = True
        await session.commit()
    plain = await _commit_review_item(inbox.everyday_id, "TRN-1")
    stays = {
        "a transfer category": await _commit_review_item(inbox.everyday_id, "TRN-2", description="XFER TO SAVINGS"),
        "an archived account": await _commit_review_item(inbox.savings_id, "TRN-3"),
        "33 tags": await _commit_review_item(inbox.everyday_id, "TRN-4", description="TAGGED SHOP"),
        "an unreadable amount": await _commit_review_item(
            inbox.everyday_id, "TRN-5", observed_amount=None, raw_amount="-12.345", description="HARBOUR PETROL"
        ),
        "an income category on money out": await _commit_review_item(inbox.everyday_id, "TRN-6", description="PAID OUT TO ACME"),
    }
    version = await _rules_version(client, inbox.headers)

    pressed = await _apply(client, inbox.headers, version)

    assert pressed.status_code == 200, pressed.text
    assert pressed.json() == {"added_ids": [str(plain)], "account_ids": [inbox.everyday_id], "more_to_add": False}
    for reason, item_id in stays.items():
        assert (await _stored_item(item_id)).disposition == BankTransactionDisposition.AWAITING_REVIEW, reason
    assert len(await _ledger_rows(inbox.everyday_id)) == 1
    assert await _ledger_rows(inbox.savings_id) == []


async def test_the_press_over_two_of_three_accounts_leaves_the_third_alone(client):
    """Everyday and Savings are pressed and the Holiday item that matches the rule waits"""
    inbox = await _rules_inbox(client)
    holiday_id = await _new_account(client, inbox.headers, "Holiday")
    await _coffee_rule(client, inbox)
    items = {
        name: await _commit_review_item(account_id, f"TRN-{name}")
        for name, account_id in (("e", inbox.everyday_id), ("s", inbox.savings_id), ("h", holiday_id))
    }
    version = await _rules_version(client, inbox.headers)

    pressed = await _apply(client, inbox.headers, version, [inbox.everyday_id, inbox.savings_id])

    assert pressed.status_code == 200, pressed.text
    assert set(pressed.json()["added_ids"]) == {str(items["e"]), str(items["s"])}
    assert pressed.json()["account_ids"] == sorted([inbox.everyday_id, inbox.savings_id])
    assert (await _stored_item(items["h"])).disposition == BankTransactionDisposition.AWAITING_REVIEW
    assert await _ledger_rows(holiday_id) == []


async def test_a_press_over_a_group_account_is_refused_and_one_over_another_users_account_isnt_found(client):
    """As the list has it, a group account answers 403 and another person's 404, and nothing is added"""
    inbox = await _rules_inbox(client)
    await _coffee_rule(client, inbox)
    joint_id = await _new_group_account(client, inbox.headers)
    theirs = await _commit_other_users_account()
    mine = await _commit_review_item(inbox.everyday_id, "TRN-1")
    version = await _rules_version(client, inbox.headers)

    group = await _apply(client, inbox.headers, version, [inbox.everyday_id, joint_id])
    another = await _apply(client, inbox.headers, version, [inbox.everyday_id, str(theirs.id)])

    assert (group.status_code, group.json()["detail"]) == (403, "Bank items aren't listed for accounts shared with a group")
    assert (another.status_code, another.json()["detail"]) == (404, "Account not found")
    assert (await _stored_item(mine)).disposition == BankTransactionDisposition.AWAITING_REVIEW


async def test_a_press_after_the_rules_changed_is_refused_before_anything_is_written(client):
    """The version the list showed is stale once a rule moves to another merchant, so the item still waits, and the new version adds it"""
    inbox = await _rules_inbox(client)
    rule = await _coffee_rule(client, inbox)
    item_id = await _commit_review_item(inbox.everyday_id, "TRN-1")
    stale = await _rules_version(client, inbox.headers)
    edited = await client.patch(f"/import-rules/{rule['id']}", json={"name": "Coffee shops"}, headers=inbox.headers)
    assert edited.status_code == 200, edited.text

    refused = await _apply(client, inbox.headers, stale)

    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == "Your import rules changed, so nothing was added"
    assert (await _stored_item(item_id)).disposition == BankTransactionDisposition.AWAITING_REVIEW
    assert await _ledger_rows(inbox.everyday_id) == []
    current = await _apply(client, inbox.headers, await _rules_version(client, inbox.headers))
    assert current.json()["added_ids"] == [str(item_id)]


async def test_a_person_with_no_rules_adds_nothing(client):
    """The version of no rules is accepted, and nothing is written or marked"""
    inbox = await _rules_inbox(client)
    item_id = await _commit_review_item(inbox.everyday_id, "TRN-1")
    version = await _rules_version(client, inbox.headers)
    before = await _changed_at(client, inbox.headers)

    with client.expecting_no_change():
        pressed = await _apply(client, inbox.headers, version)

    assert pressed.status_code == 200, pressed.text
    assert pressed.json() == NOTHING_ADDED
    assert (await _stored_item(item_id)).disposition == BankTransactionDisposition.AWAITING_REVIEW
    assert await _changed_at(client, inbox.headers) == before


async def test_a_correction_is_never_touched(client):
    """A correction waiting on the ledger's Harbour Coffee row matches the rule too, and stays exactly as it was while the new item is added"""
    inbox = await _rules_inbox(client)
    await _coffee_rule(client, inbox)
    [ledger_id] = await _record_ledger(client, inbox.headers, inbox.everyday_id, (BANK_DATE.isoformat(), -1250))
    correction = await _record_bank_source(ledger_id, "TRN-1")
    async with TestSession() as session:
        (await session.get_one(BankTransaction, correction)).open_kind = OpenReviewKind.CORRECTION
        await session.commit()
    stored_before = await _stored_item(correction)
    new_item = await _commit_review_item(inbox.everyday_id, "TRN-2")

    pressed = await _apply(client, inbox.headers, await _rules_version(client, inbox.headers))

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
    monkeypatch.setattr(rule_apply, "MAX_ADDED_PER_PRESS", 2)
    inbox = await _rules_inbox(client)
    await _coffee_rule(client, inbox)
    days = [BANK_DATE - timedelta(days=number) for number in range(3)]
    newest, middle, oldest = [await _commit_review_item(inbox.everyday_id, f"TRN-{day}", observed_date=day) for day in days]
    version = await _rules_version(client, inbox.headers)

    first = await _apply(client, inbox.headers, version)
    second = await _apply(client, inbox.headers, version)

    assert first.json() == {"added_ids": [str(newest), str(middle)], "account_ids": [inbox.everyday_id], "more_to_add": True}
    assert second.json() == {"added_ids": [str(oldest)], "account_ids": [inbox.everyday_id], "more_to_add": False}


async def test_a_failure_in_one_write_adds_nothing(client):
    """Two payments of the most an account can hold are each fine alone, but the second overflows the balance, so neither is added"""
    inbox = await _rules_inbox(client)
    salary_id = await _make_category(client, inbox.headers, "Wages", "income")
    await _create_rule_ok(
        client, inbox.headers, name="Pay", conditions=[_description_contains("big")], merchant_id=inbox.merchant_id, category_id=salary_id
    )
    first = await _commit_review_item(inbox.everyday_id, "TRN-1", description="BIG PAYMENT 1", observed_amount=MAX_MINOR_UNITS)
    second = await _commit_review_item(inbox.everyday_id, "TRN-2", description="BIG PAYMENT 2", observed_amount=MAX_MINOR_UNITS)
    version = await _rules_version(client, inbox.headers)

    pressed = await _apply(client, inbox.headers, version)

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
    """Everyday is paused for review with the one item the rule fills among its new items, and adding it leaves 51 or 50"""
    pin_clock(NOW, review_pause)
    inbox = await _rules_inbox(client)
    await _coffee_rule(client, inbox, "market")
    await _commit_review_item(inbox.everyday_id, "TRN-MARKET", description="MARKET 1")
    link = await _commit_paused_link(inbox.everyday_id, NOW)
    await _commit_waiting_items(link, waiting - 1)
    version = await _rules_version(client, inbox.headers)

    with _recorded_statements() as statements:
        pressed = await _apply(client, inbox.headers, version)

    assert pressed.status_code == 200, pressed.text
    assert len(pressed.json()["added_ids"]) == 1
    assert await _pause_state(link) == pause_state
    assert "user_cache_states" in _writes(statements)[-1]


async def test_a_double_submitted_press_adds_each_item_once(client):
    """Both presses read the two items waiting and queue behind them. The first adds both and the second finds them decided"""
    inbox = await _rules_inbox(client)
    await _coffee_rule(client, inbox)
    item_ids = [await _commit_review_item(inbox.everyday_id, f"TRN-{number}") for number in range(2)]
    version = await _rules_version(client, inbox.headers)

    async with asyncio.timeout(10), TestSession() as holder:
        await holder.execute(select(BankTransaction.id).where(BankTransaction.id.in_(item_ids)).with_for_update())
        holder_pid = await holder.scalar(select(func.pg_backend_pid()))
        both = asyncio.gather(_apply(client, inbox.headers, version), _apply(client, inbox.headers, version))
        await _wait_until_waiting_on(holder_pid, both, waiters=2)
        await holder.commit()
        first, second = await both

    assert (first.status_code, second.status_code) == (200, 200), (first.text, second.text)
    answers = sorted([first.json(), second.json()], key=lambda answer: len(answer["added_ids"]))
    assert answers[0] == NOTHING_ADDED
    assert sorted(answers[1]["added_ids"]) == sorted(str(item_id) for item_id in item_ids)
    assert len(await _ledger_rows(inbox.everyday_id)) == 2


async def test_a_press_and_a_single_add_of_the_same_item_add_it_once(client):
    """Both queue behind the item, and whichever takes the lock first adds it. The other finds it added"""
    inbox = await _rules_inbox(client)
    await _coffee_rule(client, inbox)
    item_id = await _commit_review_item(inbox.everyday_id, "TRN-1")
    version = await _rules_version(client, inbox.headers)
    single = {"dt": BANK_DATE.isoformat(), "amount": -1250, "merchant_id": inbox.merchant_id, "category_id": inbox.category_id}

    async with asyncio.timeout(10), TestSession() as holder:
        await holder.execute(select(BankTransaction.id).where(BankTransaction.id == item_id).with_for_update())
        holder_pid = await holder.scalar(select(func.pg_backend_pid()))
        both = asyncio.gather(
            _apply(client, inbox.headers, version),
            client.post(f"/bank-review/items/{item_id}/add", json=single, headers=inbox.headers),
        )
        await _wait_until_waiting_on(holder_pid, both, waiters=2)
        await holder.commit()
        pressed, added = await both

    assert (pressed.status_code, added.status_code) == (200, 201), (pressed.text, added.text)
    assert len(await _ledger_rows(inbox.everyday_id)) == 1
    assert await _balances(inbox.everyday_id) == [(BANK_DATE, -1250)]
    assert pressed.json()["added_ids"] in ([str(item_id)], [])


async def test_an_item_dismissed_in_another_tab_while_the_press_waited_is_left_out(client):
    """Both items were waiting when the press read them. One was dismissed before the press got its lock, so only the other is added"""
    inbox = await _rules_inbox(client)
    await _coffee_rule(client, inbox)
    kept, dismissed = [await _commit_review_item(inbox.everyday_id, f"TRN-{number}") for number in range(2)]
    version = await _rules_version(client, inbox.headers)

    async with asyncio.timeout(10), TestSession() as other_tab:
        await other_tab.execute(select(BankTransaction.id).where(BankTransaction.id.in_([kept, dismissed])).with_for_update())
        other_pid = await other_tab.scalar(select(func.pg_backend_pid()))
        pressing = asyncio.create_task(_apply(client, inbox.headers, version))
        await _wait_until_waiting_on(other_pid, pressing)
        await _dismiss_items(other_tab, [dismissed])
        await other_tab.commit()
        pressed = await pressing

    assert pressed.status_code == 200, pressed.text
    assert pressed.json()["added_ids"] == [str(kept)]
    assert (await _stored_item(dismissed)).disposition == BankTransactionDisposition.DISMISSED
    assert len(await _ledger_rows(inbox.everyday_id)) == 1


async def test_an_item_a_sync_changed_while_the_press_waited_is_matched_as_it_now_stands(client):
    """The bank renamed one item to something no rule matches before the press got its lock, so only the other is added"""
    inbox = await _rules_inbox(client)
    await _coffee_rule(client, inbox)
    kept, renamed = [await _commit_review_item(inbox.everyday_id, f"TRN-{number}") for number in range(2)]
    version = await _rules_version(client, inbox.headers)

    async with asyncio.timeout(10), TestSession() as sync:
        await sync.execute(select(BankTransaction.id).where(BankTransaction.id.in_([kept, renamed])).with_for_update())
        sync_pid = await sync.scalar(select(func.pg_backend_pid()))
        pressing = asyncio.create_task(_apply(client, inbox.headers, version))
        await _wait_until_waiting_on(sync_pid, pressing)
        await sync.execute(
            update(BankTransaction)
            .where(BankTransaction.id == renamed)
            .values(description="LIBRARY FINES", version=BankTransaction.version + 1)
        )
        await sync.commit()
        pressed = await pressing

    assert pressed.status_code == 200, pressed.text
    assert pressed.json()["added_ids"] == [str(kept)]
    assert (await _stored_item(renamed)).disposition == BankTransactionDisposition.AWAITING_REVIEW
