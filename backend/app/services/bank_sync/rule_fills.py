"""What the user's import rules fill in on the bank items waiting for review

A bank item stores nothing about the rules. Its fill is worked out when the review list loads and
again when the rules are applied, from the same shared loader, matcher and fill a file import uses.
Every item is first turned into the facts the matcher compares, then given the rules' answer, and
`is_addable` is the one test of whether that answer is enough to add the item: both the state of the
button and the press go through it, so the button never promises what the press refuses
"""

import asyncio
import uuid
from collections.abc import AsyncIterator, Mapping, Sequence
from contextlib import aclosing
from dataclasses import dataclass
from datetime import date
from typing import Any

from sqlalchemy import ColumnElement, Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.bank_transaction import BankTransaction
from app.models.base import CategoryKind
from app.schemas.bank_review import (
    BankReviewRulesResponse,
    CategoryLeftOutReason,
    ReviewItemRuleFill,
    ReviewRuleCategory,
    ReviewRuleCategoryLeftOut,
    ReviewRuleTagsLeftOut,
)
from app.schemas.import_rule import ImportRuleGivenValue, ImportRuleReference
from app.schemas.import_run import MAX_IMPORT_TAGS_PER_ROW
from app.services.bank_sync.review_state import AWAITING_REVIEW
from app.services.import_rules.file_rows import FileRow, FileRowFill, FillTargets, fill_rows, load_fill_targets
from app.services.import_rules.loading import load_import_rules
from app.services.import_rules.matching import ImportRuleMatcher, MatchCandidate, RuleRef, Supplied, SuppliedTag
from app.utils.date_window import get_window_error

# How many waiting items a scan reads and matches at a time, so thousands of them never sit in memory at once
SCAN_CHUNK_SIZE = 500


@dataclass(frozen=True)
class WaitingItem:
    """The facts of one waiting new item that the rules and `is_addable` read

    Attributes:
        id: The bank transaction's id, also its review item's
        description: The bank's text
        note: The bank's own note about the payment, which the rules' Note condition reads
        amount: Signed amount in the account's minor units, or None when the bank's can't be stored
        date: The bank's date
        account_id: The account it waits on
        currency: The account's currency
        archived: Whether the account is archived
    """

    id: uuid.UUID
    description: str | None
    note: str | None
    amount: int | None
    date: date
    account_id: uuid.UUID
    currency: str
    archived: bool


@dataclass(frozen=True)
class ItemFill:
    """What the rules give one item, with the category held to the item's direction

    Attributes:
        merchant: The merchant the highest matching rule sets
        category: The category the highest matching rule sets, only when its kind fits the item
        category_left_out: The rule's category that doesn't fit, and why
        tags: The tags the matching rules add, none when they pass what a transaction carries
        tags_left_out: The tags that were left out for passing it
        matched: Whether any rule gave the item something
    """

    merchant: Supplied | None
    category: Supplied | None
    category_left_out: tuple[Supplied, CategoryLeftOutReason] | None
    tags: tuple[SuppliedTag, ...]
    tags_left_out: tuple[SuppliedTag, ...]
    matched: bool


@dataclass(frozen=True)
class RuleFacts:
    """Two yes-or-no facts over every waiting new item in scope"""

    any_matches: bool
    any_addable: bool


@dataclass(frozen=True)
class RuleFillContext:
    """A person's rules read for one request

    Attributes:
        version: The digest of the rules, which differs whenever they or what they name change
        matcher: The matcher over the rules, empty for a person with none
        targets: The merchants, categories and tags every rule names, by id
        category_kinds: The kind of each category a rule names
    """

    version: str
    matcher: ImportRuleMatcher
    targets: FillTargets
    category_kinds: Mapping[uuid.UUID, str]
    has_rules: bool


async def load_rule_fill_context(db: AsyncSession, user_id: uuid.UUID) -> RuleFillContext:
    """Read the person's rules and what they name, in a few statements however many items are asked about

    Args:
        db: Active database session
        user_id: The person the rules belong to

    Returns:
        The rules ready to match, and the records they name

    Raises:
        HTTPException: Raised with 409 when a rule names a record that is gone, which is a rule
            changed at that moment
    """
    loaded = await load_import_rules(db, user_id)
    if not loaded.rules:
        return RuleFillContext(loaded.version, loaded.build_matcher(), FillTargets({}, {}, {}), {}, has_rules=False)

    # One answer per rule holding what it gives, so the shared read finds every record in three statements
    gives = []
    for rule in loaded.rules:
        ref = RuleRef(rule.id, rule.name)
        gives.append(
            FileRowFill(
                merchant=None if rule.merchant_id is None else Supplied(rule.merchant_id, ref),
                category=None if rule.category_id is None else Supplied(rule.category_id, ref),
                tags=tuple(SuppliedTag(tag.id, ref, tag.key) for tag in rule.tags),
            )
        )
    targets = await load_fill_targets(db, user_id, gives)
    kinds = {category_id: category.kind for category_id, category in targets.categories.items()}
    return RuleFillContext(loaded.version, loaded.build_matcher(), targets, kinds, has_rules=True)


def waiting_item_of(record: BankTransaction, currency: str, archived: bool) -> WaitingItem:
    """Return a new item's bank transaction as the facts the rules read"""
    return WaitingItem(
        record.id, record.description, record.note, record.observed_amount, record.observed_date, record.account_id, currency, archived
    )


def waiting_items_query(scope: Sequence[ColumnElement[bool]]) -> Select:
    """Return the one statement that reads the facts of every waiting new item in a scope

    Args:
        scope: The conditions limiting the items to the accounts in scope, which join Account
    """
    return (
        select(
            BankTransaction.id,
            BankTransaction.description,
            BankTransaction.note,
            BankTransaction.observed_amount,
            BankTransaction.observed_date,
            BankTransaction.account_id,
            Account.currency,
            Account.is_archived,
        )
        .join(Account, Account.id == BankTransaction.account_id)
        .where(AWAITING_REVIEW, *scope)
    )


async def stream_waiting_items(
    db: AsyncSession, scope: Sequence[ColumnElement[bool]], *, newest_first: bool
) -> AsyncIterator[list[WaitingItem]]:
    """Yield the facts of every waiting new item in a scope a chunk at a time, from one statement

    A caller that stops early closes this, which closes the statement's cursor

    Args:
        db: Active database session
        scope: The conditions limiting the items to the accounts in scope
        newest_first: Whether to read by the bank's date, newest first, rather than in any order
    """
    query = waiting_items_query(scope)
    if newest_first:
        query = query.order_by(BankTransaction.observed_date.desc(), BankTransaction.id.desc())
    result = await db.stream(query.execution_options(yield_per=SCAN_CHUNK_SIZE))
    try:
        async for rows in result.partitions():
            yield [WaitingItem(*row) for row in rows]
    finally:
        await result.close()


def _category_misfit(kind: str, amount: int | None) -> CategoryLeftOutReason | None:
    """Return why a category of this kind can't fill an item with this amount, or None when it fits

    A category fits exactly when it is income for money in and expense for money out, so a transfer
    category and the kind of the other direction never do. The form would turn the bank's amount
    around if it took one of those
    """
    if kind == CategoryKind.TRANSFER:
        return "transfer"
    if not amount:
        return "no_direction"
    if amount > 0:
        return None if kind == CategoryKind.INCOME else "expense_for_money_in"
    return None if kind == CategoryKind.EXPENSE else "income_for_money_out"


def read_item_fill(amount: int | None, fill: FileRowFill, category_kinds: Mapping[uuid.UUID, str]) -> ItemFill:
    """Hold what the rules give an item to what a transaction takes: a category of the item's direction and at most 32 tags

    Args:
        amount: The item's signed amount in minor units, or None when the bank's can't be stored
        fill: What the shared fill gave the item
        category_kinds: The kind of each category the rules name

    Returns:
        What the item is filled with, and what was left out
    """
    category = fill.category
    category_left_out = None
    if category is not None:
        reason = _category_misfit(category_kinds[category.value], amount)
        if reason is not None:
            category, category_left_out = None, (category, reason)

    # Nothing is cut: tags past what a transaction carries are all left out
    tags, tags_left_out = fill.tags, ()
    if fill.tag_count > MAX_IMPORT_TAGS_PER_ROW:
        tags, tags_left_out = (), fill.tags
    return ItemFill(
        merchant=fill.merchant,
        category=category,
        category_left_out=category_left_out,
        tags=tags,
        tags_left_out=tags_left_out,
        matched=fill.merchant is not None or fill.category is not None or bool(fill.tags),
    )


def is_addable(item: WaitingItem, fill: ItemFill) -> bool:
    """Return whether the rules give an item all it needs to be added to the ledger, and nothing a write refuses for a known reason

    The state of the button and the press both ask this. It needs a merchant and a category of the
    item's direction, an amount that can be read, an account that isn't archived, a date a
    transaction accepts, and no more tags than a transaction carries

    Args:
        item: The item's facts
        fill: What the item is filled with
    """
    return (
        fill.merchant is not None
        and fill.category is not None
        and item.amount is not None
        and not item.archived
        and get_window_error(item.date) is None
        and not fill.tags_left_out
    )


def fill_waiting_items(matcher: ImportRuleMatcher, items: Sequence[WaitingItem], category_kinds: Mapping[uuid.UUID, str]) -> list[ItemFill]:
    """Ask the rules about each item and hold the answer to what a transaction takes

    Pure, so it can run off the event loop. Nothing here is the matcher's own work written again: the
    items go through the shared `fill_rows`

    Args:
        matcher: The person's rules
        items: The items' facts
        category_kinds: The kind of each category the rules name

    Returns:
        One answer per item, in the same order
    """
    candidates = [MatchCandidate(item.description, item.note, item.amount, item.currency, item.account_id, is_transfer=False) for item in items]
    return fill_candidates(matcher, candidates, category_kinds)


def fill_candidates(
    matcher: ImportRuleMatcher, candidates: Sequence[MatchCandidate], category_kinds: Mapping[uuid.UUID, str]
) -> list[ItemFill]:
    """Ask the rules about each candidate and hold the answer to what a transaction takes, through the shared `fill_rows`

    Pure, so it can run off the event loop

    Args:
        matcher: The person's rules
        candidates: The facts the rules compare, one per item
        category_kinds: The kind of each category the rules name

    Returns:
        One answer per candidate, in the same order
    """
    fills = fill_rows(matcher, [FileRow(candidate) for candidate in candidates])
    return [read_item_fill(candidate.amount, fill, category_kinds) for candidate, fill in zip(candidates, fills, strict=True)]


def _saved_value(supplied: Supplied) -> dict[str, Any]:
    """Return a value a rule gives as it is saved: its id and the rule behind it, never a name of the record"""
    return {"id": str(supplied.value), "rule": {"id": str(supplied.rule.id), "name": supplied.rule.name}}


def fill_to_saved(fill: ItemFill) -> dict[str, Any] | None:
    """Return what the rules gave an item as it is saved on the item, or None when they gave it nothing

    Only what is present is saved. A category left out is saved with the reason, and tags left out
    for passing what a transaction carries are saved so the item can say why none is filled
    """
    if not fill.matched:
        return None
    saved: dict[str, Any] = {}
    if fill.merchant is not None:
        saved["merchant"] = _saved_value(fill.merchant)
    if fill.category is not None:
        saved["category"] = _saved_value(fill.category)
    if fill.category_left_out is not None:
        supplied, reason = fill.category_left_out
        saved["category_left_out"] = _saved_value(supplied) | {"reason": reason}
    if fill.tags:
        saved["tags"] = [_saved_value(tag) for tag in fill.tags]
    if fill.tags_left_out:
        saved["tags_left_out"] = [_saved_value(tag) for tag in fill.tags_left_out]
    return saved


async def fill_items(context: RuleFillContext, items: Sequence[WaitingItem]) -> list[ItemFill]:
    """Ask the rules about each item off the event loop, as a file import does"""
    return await asyncio.to_thread(fill_waiting_items, context.matcher, items, context.category_kinds)


async def read_rule_facts(chunks: AsyncIterator[list[WaitingItem]], context: RuleFillContext) -> RuleFacts:
    """Say whether any item the chunks hold matches a rule and whether any is addable, reading no more than it takes

    Args:
        chunks: The waiting items, a chunk at a time
        context: The rules

    Returns:
        The two facts, both false when nothing matches
    """
    any_matches = any_addable = False
    async with aclosing(chunks):
        async for items in chunks:
            for item, fill in zip(items, await fill_items(context, items), strict=True):
                any_matches = any_matches or fill.matched
                any_addable = any_addable or is_addable(item, fill)
            if any_matches and any_addable:
                break
    return RuleFacts(any_matches, any_addable)


async def pick_addable(chunks: AsyncIterator[list[WaitingItem]], context: RuleFillContext, limit: int) -> tuple[list[uuid.UUID], bool]:
    """Pick the first items the chunks hold that are addable, and say whether more are left

    Args:
        chunks: The waiting items, newest first, a chunk at a time
        context: The rules
        limit: The most items to pick

    Returns:
        The ids picked in the order the chunks gave them, and whether more than the limit were addable
    """
    picked: list[uuid.UUID] = []
    async with aclosing(chunks):
        async for items in chunks:
            fills = await fill_items(context, items)
            picked.extend(item.id for item, fill in zip(items, fills, strict=True) if is_addable(item, fill))

            # One past the limit is enough to know more are left
            if len(picked) > limit:
                break
    return picked[:limit], len(picked) > limit


def _reference(supplied: Supplied) -> ImportRuleReference:
    """Return the rule behind a value"""
    return ImportRuleReference(id=supplied.rule.id, name=supplied.rule.name)


def _given(supplied: Supplied, name: str) -> ImportRuleGivenValue:
    """Return a value a rule gives, with its name and the rule behind it"""
    return ImportRuleGivenValue(id=supplied.value, name=name, rule=_reference(supplied))


def build_rule_fill(fill: ItemFill, targets: FillTargets) -> ReviewItemRuleFill | None:
    """Return what the rules fill in for an item as the list carries it, or None when no rule gave it anything"""
    if not fill.matched:
        return None
    merchant = None if fill.merchant is None else _given(fill.merchant, targets.merchants[fill.merchant.value].name)
    category = None
    if fill.category is not None:
        record = targets.categories[fill.category.value]
        category = ReviewRuleCategory(id=fill.category.value, name=record.name, rule=_reference(fill.category), kind=record.kind)
    category_left_out = None
    if fill.category_left_out is not None:
        supplied, reason = fill.category_left_out
        record = targets.categories[supplied.value]
        category_left_out = ReviewRuleCategoryLeftOut(
            id=supplied.value, name=record.name, rule=_reference(supplied), kind=record.kind, reason=reason
        )
    tags_left_out = None
    if fill.tags_left_out:
        rules = {tag.rule.id: _reference(tag) for tag in fill.tags_left_out}
        tags_left_out = ReviewRuleTagsLeftOut(
            rules=list(rules.values()), count=len(fill.tags_left_out), limit=MAX_IMPORT_TAGS_PER_ROW, reason="too_many"
        )
    return ReviewItemRuleFill(
        merchant=merchant,
        category=category,
        tags=[_given(tag, targets.tags[tag.value].name) for tag in fill.tags],
        category_left_out=category_left_out,
        tags_left_out=tags_left_out,
    )


@dataclass(frozen=True)
class PageRules:
    """What the rules give a page of the list

    Attributes:
        fills: What the rules fill in for each item of the page one of them matched, by item id
        rules: The rules' version and the two facts over every waiting item, for the first page, else None
    """

    fills: dict[uuid.UUID, ReviewItemRuleFill]
    rules: BankReviewRulesResponse | None


async def read_page_rules(
    db: AsyncSession, user_id: uuid.UUID, scope: Sequence[ColumnElement[bool]], items: Sequence[WaitingItem], *, first_page: bool
) -> PageRules:
    """Read the rules and what they fill in for the new items of a page, with the two facts over the whole scope for the first

    A person with no rules costs no scan, and the scan is one statement that stops once both facts are known

    Args:
        db: Active database session
        user_id: The user reviewing
        scope: The conditions limiting the list to the accounts shown
        items: The new items of the page
        first_page: Whether the page is the first, which answers the facts

    Returns:
        The fills, and the facts and the rules' version on the first page

    Raises:
        HTTPException: Raised with 409 when a rule names a record that is gone
    """
    context = await load_rule_fill_context(db, user_id)
    if not context.has_rules:
        return PageRules({}, BankReviewRulesResponse(version=context.version, any_matches=False, any_addable=False) if first_page else None)

    fills = {}
    for item, fill in zip(items, await fill_items(context, items), strict=True):
        rule_fill = build_rule_fill(fill, context.targets)
        if rule_fill is not None:
            fills[item.id] = rule_fill
    rules = None
    if first_page:
        facts = await read_rule_facts(stream_waiting_items(db, scope, newest_first=False), context)
        rules = BankReviewRulesResponse(version=context.version, any_matches=facts.any_matches, any_addable=facts.any_addable)
    return PageRules(fills, rules)
