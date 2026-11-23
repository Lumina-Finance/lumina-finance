"""What the rules give a file's rows: each rule's count, and the tags a file already gives"""

from app.services.import_rules.file_rows import FileRow, count_rows_per_rule, fill_rows
from app.services.import_rules.matching import ImportRuleMatcher, RuleTag
from tests.services.import_rules._matching_helpers import (
    CATEGORY_GROCERIES,
    MERCHANT_MARKET,
    TAG_FOOD,
    TAG_REVIEW,
    candidate,
    description,
    rule,
)


def _fill(rules, *rows):
    """Fill the rows from the rules, each row given as its facts and the tags its file gives"""
    return fill_rows(ImportRuleMatcher(rules), [FileRow(row, frozenset(file_tags)) for row, file_tags in rows])


def test_a_rules_count_is_the_rows_where_it_gave_a_value_the_row_ends_with():
    """A rule that matched but was outranked on everything it sets counts for no row, and the ones above it count for each row they won"""
    market = rule("Market", description("contains", "market"), merchant=MERCHANT_MARKET)
    outranked = rule("Outranked", description("contains", "market"), merchant=MERCHANT_MARKET)
    groceries = rule("Groceries", description("contains", "sq"), category=CATEGORY_GROCERIES)
    never = rule("Never", description("contains", "bakery"), merchant=MERCHANT_MARKET)

    fills = _fill(
        [market, outranked, groceries, never],
        (candidate(description_text="SQ *MARKET 1"), ()),
        (candidate(description_text="SQ *MARKET 2"), ()),
        (candidate(description_text="SQ *CORNER"), ()),
        (candidate(description_text="Rent"), ()),
    )

    counts = count_rows_per_rule(fills)
    assert counts[market.id] == 2, "the rule won the merchant on both rows it matched"
    assert counts[groceries.id] == 3, "the rule won the category on every row from Square"
    assert counts[outranked.id] == 0, "a rule outranked on everything it sets supplied nothing"
    assert counts[never.id] == 0


def test_a_tag_the_file_already_gives_is_the_files_and_counts_for_no_rule():
    """The rule's tag is still gathered for the row, and a rule whose only gift was that tag counts for nothing"""
    only_review = rule("Only review", description("contains", "market"), tags=[TAG_REVIEW])
    review_and_food = rule("Review and food", description("contains", "sq"), tags=[TAG_REVIEW, TAG_FOOD])

    [fill] = _fill([only_review, review_and_food], (candidate(), ("review",)))

    assert [tag.value for tag in fill.tags] == [TAG_REVIEW.id, TAG_FOOD.id]
    assert [(tag.value, tag.rule.name) for tag in fill.new_tags] == [(TAG_FOOD.id, "Review and food")]
    assert count_rows_per_rule([fill]) == {review_and_food.id: 1}
    assert fill.tag_count == 2, "the file's tag and the new one"


def test_a_row_whose_file_tags_and_rule_tags_pass_the_most_a_row_may_carry_keeps_every_one_and_says_how_many():
    """Nothing is cut: the count is what lets the preview and the save name the row"""
    file_tags = {f"tag {number}" for number in range(32)}
    adds_one = rule("Adds one", description("contains", "market"), tags=[RuleTag(TAG_REVIEW.id, "review")])

    [fill] = _fill([adds_one], (candidate(), file_tags))

    assert fill.tag_count == 33
    assert [tag.value for tag in fill.tags] == [TAG_REVIEW.id]
