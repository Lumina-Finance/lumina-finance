"""What the rules give a transaction: each condition, how a rule's items combine, and which rule a value comes from"""

import pytest

from app.services.import_rules.matching import ImportRuleMatcher
from tests.services.import_rules._matching_helpers import (
    ACCOUNT_A,
    ACCOUNT_B,
    CATEGORY_GROCERIES,
    CATEGORY_LARGE,
    MERCHANT_AMAZON,
    MERCHANT_MARKET,
    TAG_FOOD,
    TAG_REVIEW,
    account,
    amount,
    candidate,
    description,
    direction,
    group,
    note,
    rule,
)


def _holds(condition, **facts) -> bool:
    """Whether a rule holding just this condition, setting a merchant, matches the transaction"""
    return ImportRuleMatcher([rule("Only", condition, merchant=MERCHANT_MARKET)]).match(candidate(**facts)).merchant is not None


@pytest.mark.parametrize(
    ("operator", "value", "text", "expected"),
    [
        ("contains", "market", "SQ *MARKET 1", True),
        ("contains", "bakery", "SQ *MARKET 1", False),
        ("not_contains", "market", "SQ *MARKET 1", False),
        ("not_contains", "bakery", "SQ *MARKET 1", True),
        ("is", "sq *market 1", "SQ *MARKET 1", True),
        ("is", "sq *market", "SQ *MARKET 1", False),
        ("is_not", "sq *market", "SQ *MARKET 1", True),
        ("is_not", "sq *market 1", "SQ *MARKET 1", False),
        ("starts_with", "sq *", "SQ *MARKET 1", True),
        ("starts_with", "market", "SQ *MARKET 1", False),
        ("ends_with", "market 1", "SQ *MARKET 1", True),
        ("ends_with", "sq", "SQ *MARKET 1", False),
    ],
)
def test_each_text_operator_compares_the_description(operator, value, text, expected):
    """Every operator holds or fails as its name says"""
    assert _holds(description(operator, value), description_text=text) is expected


def test_text_is_compared_without_capitals_or_repeated_spaces_and_trimmed_on_both_sides():
    """A bank's padding and capitals never decide a match, and a rule's own spacing is normalised the same way"""
    padded_bank_text = "\tSQ *MARKET" + "\N{NO-BREAK SPACE}" * 2 + "1\n"
    assert _holds(description("is", "  Sq   *Market  1 "), description_text=padded_bank_text)
    assert _holds(description("starts_with", "sq *market"), description_text="   sq   *Market 2")


def test_the_note_condition_reads_the_note_and_the_description_condition_reads_the_description():
    """Each attribute reads its own field, so text in the other one never matches"""
    assert _holds(note("contains", "rent"), description_text="Landlord", note_text="April RENT")
    assert not _holds(note("contains", "rent"), description_text="Rent payment", note_text="April")
    assert not _holds(description("contains", "april"), description_text="Landlord", note_text="April")


def test_a_missing_description_or_note_reads_as_empty_text():
    """Negative operators hold for a row with nothing there, and positive ones do not"""
    assert _holds(description("not_contains", "market"), description_text=None)
    assert _holds(note("is_not", "memo"), note_text=None)
    assert not _holds(description("contains", "market"), description_text=None)
    assert not _holds(note("starts_with", "memo"), note_text=None)


@pytest.mark.parametrize(
    ("operator", "limit", "amount_minor", "expected"),
    [
        ("is", 5000, -5000, True),
        ("is", 5000, 5000, True),
        ("is", 5000, -5001, False),
        ("at_least", 5000, -5000, True),
        ("at_least", 5000, -4999, False),
        ("at_least", 5000, 90000, True),
        ("at_most", 5000, -5000, True),
        ("at_most", 5000, -5001, False),
    ],
)
def test_amount_compares_the_size_whichever_way_the_money_went(operator, limit, amount_minor, expected):
    """The sign is dropped, so money out of $50.00 is a size of 5000"""
    assert _holds(amount(operator, limit), amount_minor=amount_minor) is expected


def test_an_amount_condition_matches_only_a_transaction_in_its_currency_and_one_with_an_amount():
    """Another currency never matches, whatever the figure, and an amount that could not be read says nothing"""
    assert not _holds(amount("at_least", 100, "CAD"), amount_minor=-99999, currency="USD")
    assert not _holds(amount("at_most", 100, "CAD"), amount_minor=None)


def test_a_zero_amount_has_a_size_but_went_neither_way():
    """Zero is at most any limit, yet neither money in nor money out"""
    assert _holds(amount("at_most", 100), amount_minor=0)
    assert not _holds(direction("in"), amount_minor=0)
    assert not _holds(direction("out"), amount_minor=0)


def test_direction_reads_the_sign_and_an_unreadable_amount_has_none():
    """Above zero is money in and below zero money out"""
    assert _holds(direction("in"), amount_minor=1)
    assert not _holds(direction("in"), amount_minor=-1)
    assert _holds(direction("out"), amount_minor=-1)
    assert not _holds(direction("out"), amount_minor=None)


def test_an_account_condition_is_or_is_not_the_transactions_account():
    """'Is' asks for the account and 'isn't' for any other"""
    assert _holds(account("is", ACCOUNT_A), account_id=ACCOUNT_A)
    assert not _holds(account("is", ACCOUNT_A), account_id=ACCOUNT_B)
    assert not _holds(account("is_not", ACCOUNT_A), account_id=ACCOUNT_A)
    assert _holds(account("is_not", ACCOUNT_A), account_id=ACCOUNT_B)


def test_an_account_the_import_is_still_to_create_is_none_of_the_named_ones():
    """The new account is not the one a rule's 'is' names, and is another account for 'isn't'"""
    assert not _holds(account("is", ACCOUNT_A), account_id=None)
    assert _holds(account("is_not", ACCOUNT_A), account_id=None)


@pytest.mark.parametrize("operator", ["is", "is_not"])
def test_a_condition_on_a_deleted_account_never_matches_whichever_operator_it_uses(operator):
    """Reading it as true of every other account would widen the rule, and dropping it would too"""
    gone = account(operator, ACCOUNT_A, exists=False)
    assert not _holds(gone, account_id=ACCOUNT_A)
    assert not _holds(gone, account_id=ACCOUNT_B)
    assert not _holds(gone, account_id=None)


def test_a_rule_needs_all_of_its_items_or_any_one_of_them():
    """The rule's own all or any, with a group counting as one item"""
    holds, fails = description("contains", "market"), description("contains", "bakery")

    def matched(match, *items):
        return ImportRuleMatcher([rule("R", *items, match=match, merchant=MERCHANT_MARKET)]).match(candidate()).merchant is not None

    assert matched("all", holds, holds)
    assert not matched("all", holds, fails)
    assert matched("any", fails, holds)
    assert not matched("any", fails, fails)
    assert matched("all", holds, group("any", fails, holds))
    assert not matched("all", holds, group("all", fails, holds))
    assert matched("any", fails, group("all", holds, holds))


def test_a_row_filed_as_a_transfer_is_left_alone_by_every_rule():
    """A transfer, a balance adjustment included, gets nothing from a rule that would match it"""
    market = rule("Market", description("contains", "market"), merchant=MERCHANT_MARKET, category=CATEGORY_GROCERIES, tags=[TAG_REVIEW])

    result = ImportRuleMatcher([market]).match(candidate(is_transfer=True))

    assert (result.merchant, result.category, result.tags) == (None, None, ())


def test_each_value_comes_from_the_highest_rule_that_sets_it_and_tags_gather_from_every_matching_rule():
    """The merchant and category come once from the top, and each tag is credited to the highest rule adding it"""
    first = rule("First", description("contains", "market"), merchant=MERCHANT_MARKET, tags=[TAG_REVIEW])
    skipped = rule("Skipped", description("contains", "bakery"), merchant=MERCHANT_AMAZON, tags=[TAG_FOOD])
    second = rule("Second", description("contains", "sq"), merchant=MERCHANT_AMAZON, category=CATEGORY_GROCERIES, tags=[TAG_REVIEW, TAG_FOOD])

    result = ImportRuleMatcher([first, skipped, second]).match(candidate())

    assert (result.merchant.value, result.merchant.rule.name) == (MERCHANT_MARKET, "First")
    assert (result.category.value, result.category.rule.name) == (CATEGORY_GROCERIES, "Second")
    assert [(tag.value, tag.rule.name) for tag in result.tags] == [(TAG_REVIEW.id, "First"), (TAG_FOOD.id, "Second")]


def test_a_matching_rule_that_sets_no_merchant_leaves_the_merchant_to_a_lower_rule():
    """A rule setting only a category does not use up the merchant"""
    top = rule("Top", description("contains", "market"), category=CATEGORY_GROCERIES)
    low = rule("Low", description("contains", "market"), merchant=MERCHANT_MARKET)

    result = ImportRuleMatcher([top, low]).match(candidate())

    assert (result.merchant.rule.name, result.category.rule.name) == ("Low", "Top")


def test_example_one_a_square_row_takes_the_markets_merchant_and_category():
    """Rule Market, Description contains 'sq *market', sets merchant Market and category Groceries"""
    market = rule("Market", description("contains", "sq *market"), merchant=MERCHANT_MARKET, category=CATEGORY_GROCERIES)

    result = ImportRuleMatcher([market]).match(candidate(description_text="SQ *MARKET 1234 TORONTO"))

    assert (result.merchant.value, result.category.value) == (MERCHANT_MARKET, CATEGORY_GROCERIES)


def test_example_two_a_large_amazon_row_takes_both_rules_and_a_small_one_only_the_first():
    """Amazon above Large purchases: $800 CAD gets merchant, category and tag, $20 gets only the merchant"""
    amazon = rule("Amazon", description("contains", "amazon"), merchant=MERCHANT_AMAZON)
    large = rule("Large", amount("at_least", 50000), category=CATEGORY_LARGE, tags=[TAG_REVIEW])
    matcher = ImportRuleMatcher([amazon, large])

    big = matcher.match(candidate(description_text="AMAZON.CA", amount_minor=-80000))
    small = matcher.match(candidate(description_text="AMAZON.CA", amount_minor=-2000))

    assert (big.merchant.value, big.category.value, [tag.value for tag in big.tags]) == (MERCHANT_AMAZON, CATEGORY_LARGE, [TAG_REVIEW.id])
    assert (small.merchant.value, small.category, small.tags) == (MERCHANT_AMAZON, None, ())
