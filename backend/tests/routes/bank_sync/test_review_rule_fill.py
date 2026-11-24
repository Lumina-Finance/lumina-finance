"""The review list answers each waiting item with the rule values saved on it, read as the records stand now

Nothing is matched as the list loads: an item shows what the rules gave it when it arrived, whatever
the rules say now. A merchant, category or tag deleted or merged away since reads as a value the item
still needs. The first page also says whether approving all would add any waiting item, and whether
the rules changed since any of the user's waiting items was put through them, whatever accounts the
page shows. A page of 50 reads in as many statements as a page of one
"""

import uuid
from datetime import timedelta

from sqlalchemy import update

from app.models.account import Account
from app.models.bank_transaction import BankTransaction, OpenReviewKind
from app.schemas.import_run import MAX_IMPORT_TAGS_PER_ROW
from app.services.bank_sync import rule_fills
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    BANK_DATE,
    _build_bank_transaction,
    _commit_other_users_account,
    _commit_review_item,
    _record_bank_source,
    _record_ledger,
    _review_page,
)
from tests.routes.support.import_rule_helpers import (
    _create_rule_ok,
    _description_contains,
    _make_category,
    _make_merchant,
    _make_tag,
    _system_category_id,
)
from tests.routes.support.query_helpers import _get_with_selects
from tests.routes.support.review_rule_helpers import (
    _coffee_rule,
    _commit_filled_item,
    _current_digest,
    _rules_inbox,
    _saved,
    _saved_value,
)


def _fills(page: dict) -> dict[str, dict | None]:
    """Return each item's rule fill by its id"""
    return {item["id"]: item["rule_fill"] for item in page["items"]}


async def _changed(client, inbox, **params) -> bool:
    """Return whether the first page says the rules changed since a waiting item was put through them"""
    return (await _review_page(client, inbox.headers, **params))["rules"]["changed"]


async def _restamp(inbox, *item_ids) -> None:
    """Record that these items were put through the rules as they stand now"""
    digest = await _current_digest(inbox)
    async with TestSession() as session:
        await session.execute(update(BankTransaction).where(BankTransaction.id.in_(item_ids)).values(rules_version=digest))
        await session.commit()


async def test_an_item_shows_the_values_saved_on_it_and_the_rules_behind_them_whatever_the_rules_would_say_now(client):
    """The item with another description holds the coffee values and shows them, and the item the rule matches but holds none shows none"""
    inbox = await _rules_inbox(client)
    tag_id = await _make_tag(client, inbox.headers, "Treat")
    rule = await _coffee_rule(client, inbox, tag_ids=[tag_id])
    saved = _saved(rule, merchant_id=inbox.merchant_id, category_id=inbox.category_id, tag_ids=(tag_id,))
    held = await _commit_filled_item(inbox, saved, "TRN-1", description="LIBRARY FINES")
    matching_but_unfilled = await _commit_filled_item(inbox, None, "TRN-2")

    fills = _fills(await _review_page(client, inbox.headers))

    reference = {"id": rule["id"], "name": "Coffee"}
    assert fills[str(held)] == {
        "merchant": {"id": inbox.merchant_id, "name": "Harbour Coffee", "rule": reference},
        "category": {"id": inbox.category_id, "name": "Coffee", "kind": "expense", "rule": reference},
        "tags": [{"id": tag_id, "name": "Treat", "rule": reference}],
        "category_left_out": None,
        "tags_left_out": None,
    }
    assert fills[str(matching_but_unfilled)] is None, "nothing is matched as the list loads"


async def test_a_category_left_out_and_tags_left_out_are_named_with_their_reasons(client):
    """The saved category left out for the item's direction shows with the kind it has now, and the 33 tags show the rules that add them"""
    inbox = await _rules_inbox(client)
    rule = await _coffee_rule(client, inbox)
    other = await _create_rule_ok(
        client, inbox.headers, name="Extra", conditions=[_description_contains("coffee")], merchant_id=inbox.merchant_id
    )
    tag_ids = [await _make_tag(client, inbox.headers, f"Tag {number}") for number in range(MAX_IMPORT_TAGS_PER_ROW + 1)]
    saved = {
        "merchant": _saved_value(inbox.merchant_id, rule),
        "category_left_out": _saved_value(inbox.category_id, rule) | {"reason": "expense_for_money_in"},
        "tags_left_out": [_saved_value(tag_id, rule if number < MAX_IMPORT_TAGS_PER_ROW else other) for number, tag_id in enumerate(tag_ids)],
    }
    item = await _commit_filled_item(inbox, saved)

    fill = _fills(await _review_page(client, inbox.headers))[str(item)]

    assert fill["category"] is None
    assert fill["category_left_out"] == {
        "id": inbox.category_id,
        "name": "Coffee",
        "kind": "expense",
        "rule": {"id": rule["id"], "name": "Coffee"},
        "reason": "expense_for_money_in",
    }
    assert fill["tags"] == []
    assert fill["tags_left_out"] == {
        "rules": [{"id": rule["id"], "name": "Coffee"}, {"id": other["id"], "name": "Extra"}],
        "count": MAX_IMPORT_TAGS_PER_ROW + 1,
        "limit": MAX_IMPORT_TAGS_PER_ROW,
        "reason": "too_many",
    }


async def test_a_merchant_category_or_tag_deleted_since_reads_as_needed_and_the_list_still_answers(client):
    """No rule names the three records, so each can be deleted, and each item then shows the rest of what it holds with no error"""
    inbox = await _rules_inbox(client)
    rule = await _coffee_rule(client, inbox)
    old_merchant = await _make_merchant(client, inbox.headers, "Old Cafe")
    old_category = await _make_category(client, inbox.headers, "Old coffee")
    old_tag = await _make_tag(client, inbox.headers, "Old tag")
    kept_tag = await _make_tag(client, inbox.headers, "Kept tag")
    no_merchant = await _commit_filled_item(inbox, _saved(rule, merchant_id=old_merchant, category_id=inbox.category_id), "TRN-1")
    no_category = await _commit_filled_item(inbox, _saved(rule, merchant_id=inbox.merchant_id, category_id=old_category), "TRN-2")
    one_tag = await _commit_filled_item(inbox, _saved(rule, merchant_id=inbox.merchant_id, tag_ids=(old_tag, kept_tag)), "TRN-3")
    for path in (f"/merchants/{old_merchant}", f"/categories/{old_category}", f"/tags/{old_tag}"):
        deleted = await client.delete(path, headers=inbox.headers)
        assert deleted.status_code == 204, deleted.text

    fills = _fills(await _review_page(client, inbox.headers))

    assert fills[str(no_merchant)]["merchant"] is None
    assert fills[str(no_merchant)]["category"]["id"] == inbox.category_id
    assert fills[str(no_category)]["category"] is None
    assert fills[str(no_category)]["category_left_out"] is None
    assert fills[str(no_category)]["merchant"]["id"] == inbox.merchant_id
    assert [tag["id"] for tag in fills[str(one_tag)]["tags"]] == [kept_tag]


async def test_a_merchant_merged_away_reads_as_needed_until_the_rules_are_applied_again(client):
    """Merging Harbour Coffee into another merchant moves the rule and deletes it, so the item needs a merchant and the rules changed"""
    inbox = await _rules_inbox(client)
    rule = await _coffee_rule(client, inbox)
    replacement = await _make_merchant(client, inbox.headers, "Corner Cafe")
    item = await _commit_filled_item(inbox, _saved(rule, merchant_id=inbox.merchant_id, category_id=inbox.category_id))
    merged = await client.post(f"/merchants/{inbox.merchant_id}/merge", json={"replacement_merchant_id": replacement}, headers=inbox.headers)
    assert merged.status_code == 204, merged.text

    page = await _review_page(client, inbox.headers)

    fill = _fills(page)[str(item)]
    assert fill["merchant"] is None
    assert fill["category"]["id"] == inbox.category_id
    assert page["rules"] == {"any_addable": False, "changed": True, "read_only_reason": None}


async def test_the_rules_changed_when_a_tag_is_renamed_or_a_rule_edited_but_not_when_a_merchant_is_renamed_and_whatever_the_page_shows(client):
    """The item waits on an archived Savings account. Only an edit that changes the digest raises it, whatever the page filters to"""
    inbox = await _rules_inbox(client)
    tag_id = await _make_tag(client, inbox.headers, "Treat")
    rule = await _coffee_rule(client, inbox, tag_ids=[tag_id])
    item = await _commit_filled_item(inbox, _saved(rule, merchant_id=inbox.merchant_id), account_id=inbox.savings_id)
    async with TestSession() as session:
        (await session.get_one(Account, uuid.UUID(inbox.savings_id))).is_archived = True
        await session.commit()
    assert not await _changed(client, inbox), "the item was put through the rules as they stand"

    renamed_merchant = await client.patch(f"/merchants/{inbox.merchant_id}", json={"name": "Harbour Cafe"}, headers=inbox.headers)
    assert renamed_merchant.status_code == 200, renamed_merchant.text
    assert not await _changed(client, inbox), "renaming a merchant changes nothing a rule matches or gives"

    renamed_tag = await client.patch(f"/tags/{tag_id}", json={"name": "Treats"}, headers=inbox.headers)
    assert renamed_tag.status_code == 200, renamed_tag.text
    assert await _changed(client, inbox), "the tag's name is part of the rules' digest"
    assert await _changed(client, inbox, account_id=inbox.everyday_id), "the page's filter doesn't narrow it"

    await _restamp(inbox, item)
    edited = await client.patch(f"/import-rules/{rule['id']}", json={"name": "Coffee shops"}, headers=inbox.headers)
    assert edited.status_code == 200, edited.text
    assert await _changed(client, inbox)


async def test_deleting_the_last_rule_offers_the_rules_only_for_items_some_rule_filled(client):
    """An item the rule filled is stale once the rule is gone, and one the rules gave nothing needs nothing"""
    inbox = await _rules_inbox(client)
    rule = await _coffee_rule(client, inbox)
    filled = await _commit_filled_item(inbox, _saved(rule, merchant_id=inbox.merchant_id), "TRN-1")
    await _commit_filled_item(inbox, None, "TRN-2")
    deleted = await client.delete(f"/import-rules/{rule['id']}", headers=inbox.headers)
    assert deleted.status_code == 204, deleted.text

    assert await _changed(client, inbox), "the filled item still holds values from a rule that is gone"

    async with TestSession() as session:
        await session.execute(update(BankTransaction).where(BankTransaction.id == filled).values(rule_fill=None))
        await session.commit()
    assert not await _changed(client, inbox), "both items hold the old digest, but nothing holds values and no rule exists"


async def test_a_first_rule_and_an_item_never_put_through_any_rules_offer_the_rules(client):
    """With no rules the item is current. A first rule makes it stale, and so does an item with no digest, such as one waiting from before"""
    inbox = await _rules_inbox(client)
    item = await _commit_filled_item(inbox, None)
    assert not await _changed(client, inbox), "a person with no rules is offered nothing"

    await _coffee_rule(client, inbox)
    assert await _changed(client, inbox), "the first rule gives the offer for every item already waiting"

    await _restamp(inbox, item)
    assert not await _changed(client, inbox)
    async with TestSession() as session:
        await session.execute(update(BankTransaction).where(BankTransaction.id == item).values(rules_version=None))
        await session.commit()
    assert await _changed(client, inbox), "an item with no digest is offered the rules once the person has any"


async def test_the_first_page_says_an_item_on_a_later_page_can_be_added(client):
    """The one item holding a merchant and a category is the oldest of 51, on page 2, and page 1 still says approving all would add it"""
    inbox = await _rules_inbox(client)
    rule = await _coffee_rule(client, inbox)
    oldest = await _commit_filled_item(
        inbox, _saved(rule, merchant_id=inbox.merchant_id, category_id=inbox.category_id), "TRN-0", observed_date=BANK_DATE - timedelta(days=1)
    )
    async with TestSession() as session:
        account = await session.get_one(Account, uuid.UUID(inbox.everyday_id))
        session.add_all(_build_bank_transaction(account, f"TRN-{number}") for number in range(1, 51))
        await session.commit()

    first = await _review_page(client, inbox.headers)
    second = await _review_page(client, inbox.headers, cursor=first["next_cursor"])

    assert len(first["items"]) == 50
    assert [item["id"] for item in second["items"]] == [str(oldest)]
    assert first["rules"]["any_addable"] is True
    assert all(fill is None for fill in _fills(first).values()), "no item of page 1 holds values"
    assert second["rules"] is None
    assert _fills(second)[str(oldest)]["merchant"]["id"] == inbox.merchant_id


async def test_a_merchant_alone_adds_nothing_and_a_correction_or_removal_carries_no_fill_and_counts_for_nothing(client):
    """An item holding only a merchant isn't addable, and the correction and removal match the rule's text without being waiting new items"""
    inbox = await _rules_inbox(client)
    rule = await _coffee_rule(client, inbox)
    await _commit_filled_item(inbox, _saved(rule, merchant_id=inbox.merchant_id))
    ledger_ids = await _record_ledger(client, inbox.headers, inbox.everyday_id, (BANK_DATE.isoformat(), -1250), (BANK_DATE.isoformat(), -1250))
    correction = await _record_bank_source(ledger_ids[0], "TRN-2")
    removal = await _record_bank_source(ledger_ids[1], "TRN-3")
    async with TestSession() as session:
        values = {"rule_fill": None, "rules_version": None}
        await session.execute(
            update(BankTransaction).where(BankTransaction.id == correction).values(open_kind=OpenReviewKind.CORRECTION, **values)
        )
        await session.execute(
            update(BankTransaction)
            .where(BankTransaction.id == removal)
            .values(open_kind=OpenReviewKind.REMOVAL, removed_at=BankTransaction.observed_at, **values)
        )
        await session.commit()

    page = await _review_page(client, inbox.headers)

    assert {item["kind"] for item in page["items"]} == {"new", "correction", "removal"}
    assert all(item["rule_fill"] is None for item in page["items"] if item["kind"] != "new")
    assert page["rules"] == {"any_addable": False, "changed": False, "read_only_reason": None}


async def test_a_list_with_nothing_waiting_reads_no_rules(client):
    """The two facts are false without a statement about the rules, and the page is the same shape"""
    inbox = await _rules_inbox(client)
    await _coffee_rule(client, inbox)

    page, selects = await _get_with_selects(client, "/bank-review/items", inbox.headers)

    assert page["rules"] == {"any_addable": False, "changed": False, "read_only_reason": None}
    assert not any("FROM import_rules" in select for select in selects)


async def test_the_list_reads_a_page_of_50_in_as_many_statements_as_a_page_of_one(client, monkeypatch):
    """Beside another person's rows, every item holds a merchant, category and tag and is addable, so the scan stops at its first chunk"""
    monkeypatch.setattr(rule_fills, "SCAN_CHUNK_SIZE", 100)
    inbox = await _rules_inbox(client)
    tag_id = await _make_tag(client, inbox.headers, "Treat")
    rule = await _coffee_rule(client, inbox, tag_ids=[tag_id])
    saved = _saved(rule, merchant_id=inbox.merchant_id, category_id=inbox.category_id, tag_ids=(tag_id,))
    theirs = await _commit_other_users_account()
    for number in range(3):
        await _commit_review_item(theirs.id, f"THEIRS-{number}")
    await _commit_filled_item(inbox, saved, "TRN-0")
    _, one_selects = await _get_with_selects(client, "/bank-review/items", inbox.headers)
    digest = await _current_digest(inbox)
    async with TestSession() as session:
        account = await session.get_one(Account, uuid.UUID(inbox.everyday_id))
        records = [_build_bank_transaction(account, f"TRN-{number}") for number in range(1, 50)]
        for record in records:
            record.rule_fill, record.rules_version = saved, digest
        session.add_all(records)
        await session.commit()

    full_page, full_selects = await _get_with_selects(client, "/bank-review/items", inbox.headers)

    assert len(full_page["items"]) == 50
    assert all(item["rule_fill"]["merchant"]["id"] == inbox.merchant_id for item in full_page["items"])
    assert full_page["rules"] == {"any_addable": True, "changed": False, "read_only_reason": None}
    assert len(full_selects) == len(one_selects)


async def test_items_holding_a_merchant_and_a_category_that_cannot_be_added_leave_nothing_addable(client):
    """An archived account, a transfer category and a deleted merchant each leave an item that can't be added, so nothing is addable"""
    inbox = await _rules_inbox(client)
    rule = await _coffee_rule(client, inbox)
    old_merchant = await _make_merchant(client, inbox.headers, "Old Cafe")
    transfer_id = await _system_category_id(client, inbox.headers, "Transfer")
    async with TestSession() as session:
        archived = await session.get_one(Account, uuid.UUID(inbox.savings_id))
        archived.is_archived = True
        await session.commit()
    both = {"merchant_id": inbox.merchant_id, "category_id": inbox.category_id}
    await _commit_filled_item(inbox, _saved(rule, **both), "TRN-1", account_id=inbox.savings_id)
    await _commit_filled_item(inbox, _saved(rule, merchant_id=inbox.merchant_id, category_id=transfer_id), "TRN-2")
    await _commit_filled_item(inbox, _saved(rule, merchant_id=old_merchant, category_id=inbox.category_id), "TRN-3")
    deleted = await client.delete(f"/merchants/{old_merchant}", headers=inbox.headers)
    assert deleted.status_code == 204, deleted.text

    page = await _review_page(client, inbox.headers)

    assert len(page["items"]) == 3
    assert page["rules"]["any_addable"] is False
