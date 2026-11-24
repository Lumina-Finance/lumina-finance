"""Putting a waiting bank item through the user's import rules

A sync does it as an item arrives and a press of Apply rules does it again, both from the same shared
loader, matcher and fill a file import uses. Every item is turned into the facts the matcher
compares, given the rules' answer, and held to what a transaction takes. The answer is saved on the
item as ids with the digest of the rules that gave it, and saved_fills.py reads it back
"""

import asyncio
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank_transaction import BankTransaction
from app.models.base import CategoryKind
from app.schemas.bank_review import CategoryLeftOutReason
from app.schemas.import_run import MAX_IMPORT_TAGS_PER_ROW
from app.services.import_rules.changes import CHANGED_DETAIL
from app.services.import_rules.file_rows import FileRow, FileRowFill, fill_rows, read_fill_targets
from app.services.import_rules.loading import load_import_rules
from app.services.import_rules.matching import ImportRuleMatcher, MatchCandidate, Supplied

# How many waiting items one read or press handles at a time, so thousands of them never sit in memory at once
SCAN_CHUNK_SIZE = 500


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
    tags: tuple[Supplied, ...]
    tags_left_out: tuple[Supplied, ...]
    matched: bool


@dataclass(frozen=True)
class RuleFillContext:
    """A person's rules read for one run over any number of items

    Attributes:
        version: The digest of the rules, which differs whenever they or what they name change
        matcher: The matcher over the rules, empty for a person with none
        category_kinds: The kind of each category a rule names
        has_rules: Whether the person has any rule
    """

    version: str
    matcher: ImportRuleMatcher
    category_kinds: Mapping[uuid.UUID, str]
    has_rules: bool


async def load_rule_fill_context(db: AsyncSession, user_id: uuid.UUID) -> RuleFillContext:
    """Read the person's rules and the kinds of the categories they name, in a few statements however many items are asked about

    Args:
        db: Active database session
        user_id: The person the rules belong to

    Returns:
        The rules ready to match

    Raises:
        HTTPException: Raised with 409 when a rule names a category that is gone, which is a rule
            changed at that moment
    """
    loaded = await load_import_rules(db, user_id)
    category_ids = {rule.category_id for rule in loaded.rules if rule.category_id is not None}
    targets = await read_fill_targets(db, user_id, set(), category_ids, set())
    if not category_ids <= targets.categories.keys():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=CHANGED_DETAIL)
    kinds = {category_id: category.kind for category_id, category in targets.categories.items()}
    return RuleFillContext(loaded.version, loaded.build_matcher(), kinds, has_rules=bool(loaded.rules))


def candidate_of(record: BankTransaction, currency: str) -> MatchCandidate:
    """Return a waiting bank item as the facts the rules compare

    Description is the bank's text, Note the bank's own note, Amount its size in the account's
    currency, and Direction its sign. The bank's merchant is read by nothing, and a bank item is
    never a transfer, since a transfer between two connected accounts waits on both sides as two
    ordinary items
    """
    return MatchCandidate(record.description, record.note, record.observed_amount, currency, record.account_id, is_transfer=False)


def category_misfit(kind: str, amount: int | None) -> CategoryLeftOutReason | None:
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
        reason = category_misfit(category_kinds[category.value], amount)
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


async def fill_items(context: RuleFillContext, candidates: Sequence[MatchCandidate]) -> list[ItemFill]:
    """Ask the rules about each candidate off the event loop, as a file import does"""
    return await asyncio.to_thread(fill_candidates, context.matcher, candidates, context.category_kinds)


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
