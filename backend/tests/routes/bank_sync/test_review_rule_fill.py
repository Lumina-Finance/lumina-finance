"""New bank items carry what the user's import rules fill in, worked out as the list is read

The rules are read with every page, so an edited rule fills the items already waiting. The first page
also answers, over every waiting new item, whether any matches a rule and whether pressing Apply rules
would add any, with the rules' version. A person with no rules costs the list no scan, and a page of
50 reads in as many statements as a page of one
"""

import uuid
from datetime import timedelta

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
    _account_is,
    _create_rule_ok,
    _description_contains,
    _direction_is,
    _group_of,
    _make_category,
    _make_merchant,
    _make_tag,
)
from tests.routes.support.query_helpers import _get_with_selects
from tests.routes.support.review_rule_helpers import _rules_inbox


def _fills(page: dict) -> dict[str, dict | None]:
    """Return each item's rule fill by its id"""
    return {item["id"]: item["rule_fill"] for item in page["items"]}


async def test_a_new_item_a_rule_matches_carries_the_values_and_the_rule_behind_them(client):
    """The coffee item is filled in by the rule naming harbour, and the item matching nothing is left null"""
    inbox = await _rules_inbox(client)
    tag_id = await _make_tag(client, inbox.headers, "Treat")
    rule = await _create_rule_ok(
        client,
        inbox.headers,
        name="Coffee",
        conditions=[_description_contains("harbour")],
        merchant_id=inbox.merchant_id,
        category_id=inbox.category_id,
        tag_ids=[tag_id],
    )
    matching = await _commit_review_item(inbox.everyday_id, "TRN-1")
    other = await _commit_review_item(inbox.everyday_id, "TRN-2", description="LIBRARY FINES")

    fills = _fills(await _review_page(client, inbox.headers))

    reference = {"id": rule["id"], "name": "Coffee"}
    assert fills[str(matching)] == {
        "merchant": {"id": inbox.merchant_id, "name": "Harbour Coffee", "rule": reference},
        "category": {"id": inbox.category_id, "name": "Coffee", "kind": "expense", "rule": reference},
        "tags": [{"id": tag_id, "name": "Treat", "rule": reference}],
        "category_left_out": None,
        "tags_left_out": None,
    }
    assert fills[str(other)] is None


async def test_a_rule_on_the_note_fills_the_item_whose_bank_note_says_rent_and_reads_nothing_else(client):
    """E-TRANSFER 4471 with the note March rent is filled by Rent. Without the note, or with only a bank merchant named Rent, it isn't"""
    inbox = await _rules_inbox(client)
    note_has_rent = {"kind": "condition", "attribute": "note", "operator": "contains", "value": "rent"}
    await _create_rule_ok(
        client, inbox.headers, name="Rent", conditions=[note_has_rent], merchant_id=inbox.merchant_id, category_id=inbox.category_id
    )
    noted = await _commit_review_item(inbox.everyday_id, "TRN-1", description="E-TRANSFER 4471", note="March rent")
    unnoted = await _commit_review_item(inbox.everyday_id, "TRN-2", description="E-TRANSFER 4471", note=None)
    merchant_named_rent = await _commit_review_item(inbox.everyday_id, "TRN-3", description="E-TRANSFER 4472", note=None, merchant="Rent")

    fills = _fills(await _review_page(client, inbox.headers))

    assert fills[str(noted)]["merchant"]["rule"]["name"] == "Rent"
    assert fills[str(unnoted)] is None, "the description alone doesn't say rent"
    assert fills[str(merchant_named_rent)] is None, "the merchant the bank names is read by no rule"


async def test_a_pay_rule_with_two_wordings_and_money_in_fills_a_deposit_and_not_a_purchase(client):
    """Rule Pay holds when the description says payroll or direct dep and money came in, so +2,000.00 is filled and -2,000.00 isn't"""
    inbox = await _rules_inbox(client)
    payroll_id = await _make_category(client, inbox.headers, "Payroll deposits", "income")
    wordings = _group_of("any", _description_contains("payroll"), _description_contains("direct dep"))
    rule = await _create_rule_ok(
        client,
        inbox.headers,
        name="Pay",
        conditions=[wordings, _direction_is("in")],
        merchant_id=inbox.merchant_id,
        category_id=payroll_id,
    )
    deposit = await _commit_review_item(inbox.everyday_id, "TRN-1", description="DIRECT DEP ACME", observed_amount=200000)
    purchase = await _commit_review_item(inbox.everyday_id, "TRN-2", description="DIRECT DEP ACME", observed_amount=-200000)

    fills = _fills(await _review_page(client, inbox.headers))

    reference = {"id": rule["id"], "name": "Pay"}
    assert fills[str(deposit)]["category"] == {"id": payroll_id, "name": "Payroll deposits", "kind": "income", "rule": reference}
    assert fills[str(deposit)]["merchant"]["rule"] == reference
    assert fills[str(purchase)] is None


async def test_a_rules_category_of_the_other_direction_is_left_out_and_named_while_the_merchant_is_filled(client):
    """A refund of +50.00 matches a rule giving an expense category, so Coffee is left out with its reason and the merchant still fills"""
    inbox = await _rules_inbox(client)
    rule = await _create_rule_ok(
        client,
        inbox.headers,
        name="Refunds",
        conditions=[_description_contains("refund")],
        merchant_id=inbox.merchant_id,
        category_id=inbox.category_id,
    )
    refund = await _commit_review_item(inbox.everyday_id, "TRN-1", description="REFUND HARBOUR", observed_amount=5000)

    fill = _fills(await _review_page(client, inbox.headers))[str(refund)]

    assert fill["merchant"]["id"] == inbox.merchant_id
    assert fill["category"] is None
    assert fill["category_left_out"] == {
        "id": inbox.category_id,
        "name": "Coffee",
        "kind": "expense",
        "rule": {"id": rule["id"], "name": "Refunds"},
        "reason": "expense_for_money_in",
    }


async def test_a_rule_naming_another_account_leaves_the_item_unfilled(client):
    """An account condition compares the item's own account, so only the Savings item is filled by a rule naming Savings"""
    inbox = await _rules_inbox(client)
    await _create_rule_ok(client, inbox.headers, conditions=[_account_is(inbox.savings_id)], merchant_id=inbox.merchant_id)
    on_everyday = await _commit_review_item(inbox.everyday_id, "TRN-1")
    on_savings = await _commit_review_item(inbox.savings_id, "TRN-2")

    fills = _fills(await _review_page(client, inbox.headers))

    assert fills[str(on_everyday)] is None
    assert fills[str(on_savings)]["merchant"]["id"] == inbox.merchant_id


async def test_tags_past_what_a_transaction_carries_are_left_out_with_the_rules_that_add_them(client):
    """One rule adds 32 tags and a second adds a 33rd to the same item, so none is filled and both rules are named"""
    inbox = await _rules_inbox(client)
    tag_ids = [await _make_tag(client, inbox.headers, f"Tag {number}") for number in range(MAX_IMPORT_TAGS_PER_ROW + 1)]
    many = await _create_rule_ok(
        client, inbox.headers, name="Many", conditions=[_description_contains("harbour")], tag_ids=tag_ids[:MAX_IMPORT_TAGS_PER_ROW]
    )
    extra = await _create_rule_ok(client, inbox.headers, name="Extra", conditions=[_description_contains("coffee")], tag_ids=tag_ids[-1:])
    item = await _commit_review_item(inbox.everyday_id, "TRN-1")

    fill = _fills(await _review_page(client, inbox.headers))[str(item)]

    assert fill["tags"] == []
    assert fill["tags_left_out"] == {
        "rules": [{"id": many["id"], "name": "Many"}, {"id": extra["id"], "name": "Extra"}],
        "count": MAX_IMPORT_TAGS_PER_ROW + 1,
        "limit": MAX_IMPORT_TAGS_PER_ROW,
        "reason": "too_many",
    }


async def test_editing_a_rule_changes_the_fill_and_the_version_the_next_time_the_list_loads(client):
    """Moving the rule to another merchant fills the item already waiting with it, under a new version"""
    inbox = await _rules_inbox(client)
    other_merchant_id = await _make_merchant(client, inbox.headers, "Corner Cafe")
    rule = await _create_rule_ok(
        client, inbox.headers, conditions=[_description_contains("harbour")], merchant_id=inbox.merchant_id, category_id=inbox.category_id
    )
    item = await _commit_review_item(inbox.everyday_id, "TRN-1")
    before = await _review_page(client, inbox.headers)

    edited = await client.patch(f"/import-rules/{rule['id']}", json={"merchant_id": other_merchant_id}, headers=inbox.headers)
    assert edited.status_code == 200, edited.text
    after = await _review_page(client, inbox.headers)

    assert _fills(before)[str(item)]["merchant"]["id"] == inbox.merchant_id
    assert _fills(after)[str(item)]["merchant"]["id"] == other_merchant_id
    assert after["rules"]["version"] != before["rules"]["version"]


async def test_the_first_page_answers_the_two_facts_over_items_on_a_later_page(client):
    """The one item a rule matches is the oldest of 51, so it waits on page 2 and page 1 still says it matches and can be added"""
    inbox = await _rules_inbox(client)
    await _create_rule_ok(
        client, inbox.headers, conditions=[_description_contains("library")], merchant_id=inbox.merchant_id, category_id=inbox.category_id
    )
    oldest = await _commit_review_item(inbox.everyday_id, "TRN-0", description="LIBRARY FINES", observed_date=BANK_DATE - timedelta(days=1))
    async with TestSession() as session:
        account = await session.get_one(Account, uuid.UUID(inbox.everyday_id))
        session.add_all(_build_bank_transaction(account, f"TRN-{number}") for number in range(1, 51))
        await session.commit()

    first = await _review_page(client, inbox.headers)
    second = await _review_page(client, inbox.headers, cursor=first["next_cursor"])

    assert len(first["items"]) == 50
    assert [item["id"] for item in second["items"]] == [str(oldest)]
    assert set(first["rules"]) == {"version", "any_matches", "any_addable"}
    assert (first["rules"]["any_matches"], first["rules"]["any_addable"]) == (True, True)
    assert all(fill is None for fill in _fills(first).values()), "no item of page 1 matches"
    assert second["rules"] is None
    assert _fills(second)[str(oldest)]["merchant"]["id"] == inbox.merchant_id


async def test_a_correction_and_a_removal_carry_no_fill_and_count_for_no_fact(client):
    """Both match the rule by their description, but only new items are filled and counted"""
    inbox = await _rules_inbox(client)
    await _create_rule_ok(
        client, inbox.headers, conditions=[_description_contains("harbour")], merchant_id=inbox.merchant_id, category_id=inbox.category_id
    )
    ledger_ids = await _record_ledger(client, inbox.headers, inbox.everyday_id, (BANK_DATE.isoformat(), -1250), (BANK_DATE.isoformat(), -1250))
    correction = await _record_bank_source(ledger_ids[0], "TRN-1")
    removal = await _record_bank_source(ledger_ids[1], "TRN-2")
    async with TestSession() as session:
        (await session.get_one(BankTransaction, correction)).open_kind = OpenReviewKind.CORRECTION
        removed = await session.get_one(BankTransaction, removal)
        removed.open_kind = OpenReviewKind.REMOVAL
        removed.removed_at = removed.observed_at
        await session.commit()

    page = await _review_page(client, inbox.headers)

    assert {item["kind"] for item in page["items"]} == {"correction", "removal"}
    assert all(fill is None for fill in _fills(page).values())
    assert (page["rules"]["any_matches"], page["rules"]["any_addable"]) == (False, False)


async def test_a_person_with_no_rules_costs_the_list_no_scan(client):
    """The list reads the bank items twice, for the page and for the counts, and the version it sends is the empty rules'"""
    inbox = await _rules_inbox(client)
    await _commit_review_item(inbox.everyday_id, "TRN-1")

    page, selects = await _get_with_selects(client, "/bank-review/items", inbox.headers)

    assert sum("FROM bank_transactions" in select for select in selects) == 2
    assert page["rules"]["any_matches"] is False
    assert page["rules"]["any_addable"] is False
    assert page["items"][0]["rule_fill"] is None


async def test_the_list_reads_a_page_of_50_in_as_many_statements_as_a_page_of_one_with_one_scan(client, monkeypatch):
    """Beside another person's rows, a rule giving only a merchant matches every item and can add none, so the scan reads them all in chunks

    The bank items are read three times however many wait: the page, the counts and the scan
    """
    monkeypatch.setattr(rule_fills, "SCAN_CHUNK_SIZE", 10)
    inbox = await _rules_inbox(client)
    await _create_rule_ok(client, inbox.headers, conditions=[_description_contains("harbour")], merchant_id=inbox.merchant_id)
    theirs = await _commit_other_users_account()
    for number in range(3):
        await _commit_review_item(theirs.id, f"THEIRS-{number}")
    await _commit_review_item(inbox.everyday_id, "TRN-0")
    _, one_selects = await _get_with_selects(client, "/bank-review/items", inbox.headers)
    async with TestSession() as session:
        account = await session.get_one(Account, uuid.UUID(inbox.everyday_id))
        session.add_all(_build_bank_transaction(account, f"TRN-{number}") for number in range(1, 50))
        await session.commit()

    full_page, full_selects = await _get_with_selects(client, "/bank-review/items", inbox.headers)

    assert len(full_page["items"]) == 50
    assert all(item["rule_fill"]["merchant"]["id"] == inbox.merchant_id for item in full_page["items"])
    assert (full_page["rules"]["any_matches"], full_page["rules"]["any_addable"]) == (True, False)
    assert len(full_selects) == len(one_selects)
    assert sum("FROM bank_transactions" in select for select in one_selects) == 3
    assert sum("FROM bank_transactions" in select for select in full_selects) == 3
