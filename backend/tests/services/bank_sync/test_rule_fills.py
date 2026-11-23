"""What the import rules give a waiting bank item, and whether that is enough to add it

A category that doesn't fit the item's direction would turn the bank's amount around in the review
form, and an item added that a write refuses would fail the whole press, so `is_addable` is the one
test the button's state and the press both ask. The scan behind the button reads no more than it needs
"""

import uuid
from collections.abc import AsyncIterator
from datetime import date

import pytest

from app.models.base import CategoryKind
from app.schemas.import_run import MAX_IMPORT_TAGS_PER_ROW
from app.services.bank_sync.rule_fills import (
    RuleFillContext,
    WaitingItem,
    fill_waiting_items,
    is_addable,
    pick_addable,
    read_rule_facts,
)
from app.services.import_rules.file_rows import FillTargets
from app.services.import_rules.matching import ImportRuleMatcher, RuleTag
from tests.services.import_rules._matching_helpers import ACCOUNT_A, CATEGORY_GROCERIES, MERCHANT_MARKET, description, rule

MATCHING_TEXT = "SQ *MARKET 1234"


def _item(**values) -> WaitingItem:
    """Return a -12.50 item the rules' market text matches, on an account that isn't archived"""
    facts = {
        "id": uuid.uuid4(),
        "description": MATCHING_TEXT,
        "note": None,
        "amount": -1250,
        "date": date(2026, 10, 3),
        "account_id": ACCOUNT_A,
        "currency": "CAD",
        "archived": False,
    }
    return WaitingItem(**(facts | values))


def _fill_of(item: WaitingItem, kind: str = CategoryKind.EXPENSE, **rule_values):
    """Return what a market rule giving a merchant, the groceries category of a kind and any other values gives an item"""
    gives = {"merchant": MERCHANT_MARKET, "category": CATEGORY_GROCERIES} | rule_values
    matcher = ImportRuleMatcher([rule("Market", description("contains", "market"), **gives)])
    [fill] = fill_waiting_items(matcher, [item], {CATEGORY_GROCERIES: kind})
    return fill


@pytest.mark.parametrize(
    ("amount", "kind", "left_out"),
    [
        (200000, CategoryKind.INCOME, None),
        (-200000, CategoryKind.EXPENSE, None),
        (200000, CategoryKind.EXPENSE, "expense_for_money_in"),
        (-200000, CategoryKind.INCOME, "income_for_money_out"),
        (200000, CategoryKind.TRANSFER, "transfer"),
        (-200000, CategoryKind.TRANSFER, "transfer"),
        (0, CategoryKind.EXPENSE, "no_direction"),
        (None, CategoryKind.EXPENSE, "no_direction"),
    ],
)
def test_a_category_fills_an_item_only_when_its_kind_is_exactly_the_direction_it_takes(amount, kind, left_out):
    """Income fits money in and expense fits money out, and every other pairing is left out with its reason and the item isn't addable"""
    item = _item(amount=amount)

    fill = _fill_of(item, kind)

    assert fill.matched
    if left_out is None:
        assert fill.category is not None
        assert fill.category_left_out is None
        assert is_addable(item, fill)
    else:
        assert fill.category is None
        assert fill.category_left_out[0].value == CATEGORY_GROCERIES
        assert fill.category_left_out[1] == left_out
        assert not is_addable(item, fill)


@pytest.mark.parametrize(
    ("item_values", "rule_values"),
    [
        ({}, {"merchant": None}),
        ({"archived": True}, {}),
        ({"date": date(1899, 12, 31)}, {}),
        ({"date": date(2100, 1, 1)}, {}),
    ],
    ids=["category_only", "archived_account", "date_before_1900", "date_too_far_ahead"],
)
def test_an_item_a_write_would_refuse_is_not_addable_though_the_rules_match_it(item_values, rule_values):
    """Each is kept out by `is_addable`, so the button and the press never take what the ledger refuses"""
    item = _item(**item_values)

    fill = _fill_of(item, **rule_values)

    assert fill.matched
    assert not is_addable(item, fill)


def test_an_item_the_rules_give_a_merchant_and_a_fitting_category_is_addable():
    """The control for the refusals above: the same item with nothing in the way"""
    item = _item()

    assert is_addable(item, _fill_of(item))


def test_tags_past_what_a_transaction_carries_are_all_left_out_and_32_are_kept():
    """The 33rd tag leaves every tag out rather than cutting one, and keeps the item from being added"""
    keys = [RuleTag(uuid.uuid4(), f"tag {number}") for number in range(MAX_IMPORT_TAGS_PER_ROW + 1)]
    item = _item()

    kept = _fill_of(item, tags=keys[:MAX_IMPORT_TAGS_PER_ROW])
    left_out = _fill_of(item, tags=keys)

    assert len(kept.tags) == MAX_IMPORT_TAGS_PER_ROW
    assert kept.tags_left_out == ()
    assert is_addable(item, kept)
    assert left_out.tags == ()
    assert len(left_out.tags_left_out) == MAX_IMPORT_TAGS_PER_ROW + 1
    assert not is_addable(item, left_out)


def _context() -> RuleFillContext:
    """Return the rules a market rule makes: a merchant and an expense category"""
    matcher = ImportRuleMatcher([rule("Market", description("contains", "market"), merchant=MERCHANT_MARKET, category=CATEGORY_GROCERIES)])
    return RuleFillContext("version", matcher, FillTargets({}, {}, {}), {CATEGORY_GROCERIES: CategoryKind.EXPENSE}, has_rules=True)


class _Chunks:
    """Chunks of waiting items that count how many were read"""

    def __init__(self, *chunks: list[WaitingItem]) -> None:
        """Hold the chunks to hand out"""
        self._chunks = chunks
        self.read = 0

    async def __call__(self) -> AsyncIterator[list[WaitingItem]]:
        """Yield each chunk, counting it as it is read"""
        for chunk in self._chunks:
            self.read += 1
            yield chunk


async def test_the_scan_stops_once_an_item_matches_and_one_is_addable():
    """A first chunk with an addable item answers both facts, so the second and third chunks are never read"""
    chunks = _Chunks([_item()], [_item()], [_item()])

    facts = await read_rule_facts(chunks(), _context())

    assert (facts.any_matches, facts.any_addable) == (True, True)
    assert chunks.read == 1


async def test_the_scan_goes_on_past_a_match_that_isnt_addable_and_reads_everything_when_nothing_matches():
    """A match nothing can add keeps it reading to the addable item in the second chunk, and no match reads all three chunks"""
    category_only = ImportRuleMatcher([rule("Market", description("contains", "market"), category=CATEGORY_GROCERIES)])
    kinds = {CATEGORY_GROCERIES: CategoryKind.EXPENSE}
    only_category = RuleFillContext("version", category_only, FillTargets({}, {}, {}), kinds, has_rules=True)
    matching_without_merchant = _Chunks([_item()], [_item()], [_item()])
    nothing_matches = _Chunks([_item(description="LIBRARY")], [_item(description="LIBRARY")], [_item(description="LIBRARY")])
    second_chunk_adds = _Chunks([_item(description="LIBRARY")], [_item()], [_item()])

    without_merchant = await read_rule_facts(matching_without_merchant(), only_category)
    none = await read_rule_facts(nothing_matches(), _context())
    adds_later = await read_rule_facts(second_chunk_adds(), _context())

    assert (without_merchant.any_matches, without_merchant.any_addable) == (True, False)
    assert matching_without_merchant.read == 3, "no item could be added, so every chunk was read"
    assert (none.any_matches, none.any_addable) == (False, False)
    assert nothing_matches.read == 3
    assert (adds_later.any_matches, adds_later.any_addable) == (True, True)
    assert second_chunk_adds.read == 2


async def test_picking_stops_one_past_the_limit_and_says_whether_more_are_left():
    """With a limit of 2 and two addable items in each chunk, the second chunk shows more are left and the third is never read"""
    items = [_item() for _ in range(6)]
    chunks = _Chunks(items[:2], items[2:4], items[4:])
    exactly = _Chunks(items[:2])

    picked, more = await pick_addable(chunks(), _context(), 2)
    all_of_them, none_left = await pick_addable(exactly(), _context(), 2)

    assert picked == [item.id for item in items[:2]]
    assert more is True
    assert chunks.read == 2
    assert all_of_them == [item.id for item in items[:2]]
    assert none_left is False
