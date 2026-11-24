"""What the rules save on a waiting bank item, and whether what it holds is enough to add it

A category that doesn't fit the item's direction would turn the bank's amount around in the review
form, and an item added that a write refuses would fail the whole press, so `is_addable` is the one
test the button's state and the press both ask. The values are saved as ids and read back with the
records as they are now, so a record gone since, or a category whose kind changed, is caught on the read
"""

import uuid
from datetime import date

import pytest

from app.models.base import CategoryKind
from app.models.category import Category
from app.models.merchant import Merchant
from app.models.tag import Tag
from app.schemas.import_run import MAX_IMPORT_TAGS_PER_ROW
from app.services.bank_sync.rule_fills import fill_candidates, fill_to_saved
from app.services.bank_sync.saved_fills import SavedItem, is_addable, read_saved_fill
from app.services.import_rules.file_rows import FillTargets
from app.services.import_rules.matching import ImportRuleMatcher, RuleTag
from tests.services.import_rules._matching_helpers import ACCOUNT_A, CATEGORY_GROCERIES, MERCHANT_MARKET, candidate, description, rule

_GOOD_DAY = date(2026, 10, 3)


def _saved_by_the_rules(amount: int | None = -1250, kind: str = CategoryKind.EXPENSE, **rule_values) -> dict | None:
    """Return what a market rule giving a merchant, the groceries category of a kind and any other values saves on an item with this amount"""
    gives = {"merchant": MERCHANT_MARKET, "category": CATEGORY_GROCERIES} | rule_values
    matcher = ImportRuleMatcher([rule("Market", description("contains", "market"), **gives)])
    [fill] = fill_candidates(matcher, [candidate(amount_minor=amount, account_id=ACCOUNT_A)], {CATEGORY_GROCERIES: kind})
    return fill_to_saved(fill)


def _targets(kind: str = CategoryKind.EXPENSE, *, merchant: bool = True, category: bool = True, tags: tuple[RuleTag, ...] = ()) -> FillTargets:
    """Return the records the market rule names as they are now, leaving out the kinds that are gone"""
    return FillTargets(
        merchants={MERCHANT_MARKET: Merchant(id=MERCHANT_MARKET, name="Market")} if merchant else {},
        categories={CATEGORY_GROCERIES: Category(id=CATEGORY_GROCERIES, name="Groceries", kind=kind)} if category else {},
        tags={tag.id: Tag(id=tag.id, name=tag.key) for tag in tags},
    )


def _item(saved: dict | None, **values) -> SavedItem:
    """Return a -12.50 item on an account that isn't archived, holding saved values"""
    facts = {"id": uuid.uuid4(), "amount": -1250, "date": _GOOD_DAY, "archived": False, "saved": saved}
    return SavedItem(**(facts | values))


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
    """Income fits money in and expense fits money out, and every other pairing is saved as left out with its reason and isn't addable"""
    saved = _saved_by_the_rules(amount, kind)
    item = _item(saved, amount=amount)

    fill = read_saved_fill(item, _targets(kind))

    if left_out is None:
        assert "category" in saved
        assert fill.category is not None
        assert fill.category_left_out is None
        assert is_addable(item, fill)
    else:
        assert "category" not in saved
        assert saved["category_left_out"]["reason"] == left_out
        assert fill.category is None
        assert fill.category_left_out[1] == left_out
        assert not is_addable(item, fill)


def test_a_category_whose_kind_changed_since_the_item_arrived_is_held_to_the_direction_again():
    """The category was an expense when the -12.50 item was filled and is income now, so it is left out and the item isn't addable"""
    item = _item(_saved_by_the_rules())

    fill = read_saved_fill(item, _targets(CategoryKind.INCOME))

    assert fill.category is None
    assert fill.category_left_out[1] == "income_for_money_out"
    assert not is_addable(item, fill)


@pytest.mark.parametrize(
    ("item_values", "rule_values", "targets"),
    [
        ({}, {"merchant": None}, {}),
        ({"archived": True}, {}, {}),
        ({"date": date(1899, 12, 31)}, {}, {}),
        ({"date": date(2100, 1, 1)}, {}, {}),
        ({"amount": None}, {}, {}),
        ({}, {}, {"merchant": False}),
        ({}, {}, {"category": False}),
    ],
    ids=["category_only", "archived_account", "date_before_1900", "date_too_far_ahead", "unreadable_amount", "merchant_gone", "category_gone"],
)
def test_an_item_a_write_would_refuse_or_missing_a_record_is_not_addable_though_values_are_saved(item_values, rule_values, targets):
    """Each is kept out by `is_addable`, so the button and the press never take what the ledger refuses or a value that no longer exists"""
    item = _item(_saved_by_the_rules(**rule_values), **item_values)

    fill = read_saved_fill(item, _targets(**targets))

    assert not is_addable(item, fill)


def test_an_item_holding_a_merchant_and_a_fitting_category_is_addable():
    """The control for the refusals above: the same item with nothing in the way"""
    item = _item(_saved_by_the_rules())

    assert is_addable(item, read_saved_fill(item, _targets()))


def test_a_tag_that_is_gone_is_dropped_and_the_rest_of_the_item_still_reads():
    """The rule added two tags and one was deleted, so the item reads with the other and is addable"""
    kept, gone = RuleTag(uuid.uuid4(), "kept"), RuleTag(uuid.uuid4(), "gone")
    item = _item(_saved_by_the_rules(tags=[kept, gone]))

    fill = read_saved_fill(item, _targets(tags=(kept,)))

    assert [tag.value for tag in fill.tags] == [kept.id]
    assert is_addable(item, fill)


def test_tags_past_what_a_transaction_carries_are_all_saved_as_left_out_and_32_are_kept():
    """The 33rd tag leaves every tag out rather than cutting one, and keeps the item from being added"""
    keys = [RuleTag(uuid.uuid4(), f"tag {number}") for number in range(MAX_IMPORT_TAGS_PER_ROW + 1)]
    kept_item = _item(_saved_by_the_rules(tags=keys[:MAX_IMPORT_TAGS_PER_ROW]))
    left_out_item = _item(_saved_by_the_rules(tags=keys))

    kept = read_saved_fill(kept_item, _targets(tags=tuple(keys)))
    left_out = read_saved_fill(left_out_item, _targets(tags=tuple(keys)))

    assert len(kept.tags) == MAX_IMPORT_TAGS_PER_ROW
    assert kept.tags_left_out == ()
    assert is_addable(kept_item, kept)
    assert left_out.tags == ()
    assert len(left_out.tags_left_out) == MAX_IMPORT_TAGS_PER_ROW + 1
    assert not is_addable(left_out_item, left_out)


def test_values_a_rule_gave_for_nothing_are_not_saved():
    """A description no rule matches saves nothing, which reads as an item the rules gave nothing"""
    matcher = ImportRuleMatcher([rule("Market", description("contains", "market"), merchant=MERCHANT_MARKET)])

    [fill] = fill_candidates(matcher, [candidate("LIBRARY FINES")], {})

    assert fill_to_saved(fill) is None
