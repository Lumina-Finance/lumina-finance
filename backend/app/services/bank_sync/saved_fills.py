"""Reading the rule values saved on waiting bank items

The values were worked out when the item arrived and saved with ids only, so every read here looks
the records up as they are now, in one batched statement for each kind. A merchant, category or tag
that is gone since is dropped and the item reads as needing that value, which is ordinary: a
merchant no rule names any longer can be deleted, and a merge deletes the record it moves from. So
nothing here uses the shared load that answers 409 for an id that is gone

`is_addable` is the one test of whether what an item holds is enough to add it. The state of the
button, the press of it and the list's answer all go through it, so the button never promises what
the press refuses. A category's kind is checked against the item's direction again on every read,
since the kind isn't part of the digest of the rules
"""

import uuid
from collections.abc import AsyncIterator, Mapping, Sequence
from contextlib import aclosing
from dataclasses import dataclass
from datetime import date
from typing import Any

from sqlalchemy import ColumnElement, Select, exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.bank_transaction import BankTransaction
from app.models.user import User
from app.schemas.bank_review import (
    BankReviewRulesResponse,
    ReviewItemRuleFill,
    ReviewRuleCategory,
    ReviewRuleCategoryLeftOut,
    ReviewRuleTagsLeftOut,
)
from app.schemas.import_rule import ImportRuleGivenValue, ImportRuleReference
from app.schemas.import_run import MAX_IMPORT_TAGS_PER_ROW
from app.services.accounts.access import own_personal_account_condition
from app.services.allowance.currency import find_session_foreign_currencies_reason
from app.services.bank_sync import rule_fills
from app.services.bank_sync.review_state import AWAITING_REVIEW
from app.services.bank_sync.rule_fills import ItemFill, category_misfit
from app.services.import_rules.file_rows import FillTargets, read_fill_targets
from app.services.import_rules.loading import load_import_rules
from app.services.import_rules.matching import RuleRef, Supplied
from app.utils.date_window import get_window_error


@dataclass(frozen=True)
class SavedItem:
    """A waiting new item as the list and the press read it

    Attributes:
        id: The bank transaction's id, also its review item's
        amount: Signed amount in the account's minor units, or None when the bank's can't be stored
        date: The bank's date
        archived: Whether the account is archived
        saved: What the rules gave it, as saved, or None when they gave it nothing
    """

    id: uuid.UUID
    amount: int | None
    date: date
    archived: bool
    saved: dict[str, Any] | None


def saved_item_of(record: BankTransaction, archived: bool) -> SavedItem:
    """Return a new item's bank transaction as the list and the press read it"""
    return SavedItem(record.id, record.observed_amount, record.observed_date, archived, record.rule_fill)


async def read_saved_targets(db: AsyncSession, user_id: uuid.UUID, items: Sequence[SavedItem]) -> FillTargets:
    """Read the merchants, categories and tags the items' saved values name as they are now, one statement for each kind

    A tag or category the item left out is never read, since nothing shows it by name

    Args:
        db: Active database session
        user_id: The person the items belong to
        items: The items whose saved values are about to be read

    Returns:
        The records found by id, leaving out each one that is gone
    """
    saved = [item.saved for item in items if item.saved]
    return await read_fill_targets(
        db,
        user_id,
        merchant_ids={_id(entry["merchant"]) for entry in saved if "merchant" in entry},
        category_ids={_id(entry[key]) for entry in saved for key in ("category", "category_left_out") if key in entry},
        tag_ids={_id(tag) for entry in saved for tag in entry.get("tags", [])},
    )


def _id(value: Mapping[str, Any]) -> uuid.UUID:
    """Return the id of a saved value"""
    return uuid.UUID(value["id"])


def _supplied(value: Mapping[str, Any]) -> Supplied:
    """Return a saved value as what a rule supplied"""
    return Supplied(_id(value), RuleRef(uuid.UUID(value["rule"]["id"]), value["rule"]["name"]))


def read_saved_fill(item: SavedItem, targets: FillTargets) -> ItemFill:
    """Rebuild what the rules gave an item from its saved values and the records as they are now

    A value whose record is gone is left out. A category is held to the item's direction again

    Args:
        item: The item with its saved values
        targets: The records the values name, as read now
    """
    saved = item.saved or {}
    merchant = _supplied(saved["merchant"]) if "merchant" in saved and _id(saved["merchant"]) in targets.merchants else None
    category = _supplied(saved["category"]) if "category" in saved and _id(saved["category"]) in targets.categories else None
    category_left_out = None
    if category is not None:
        reason = category_misfit(targets.categories[category.value].kind, item.amount)
        if reason is not None:
            category, category_left_out = None, (category, reason)
    elif "category_left_out" in saved and _id(saved["category_left_out"]) in targets.categories:
        category_left_out = (_supplied(saved["category_left_out"]), saved["category_left_out"]["reason"])
    tags = tuple(_supplied(tag) for tag in saved.get("tags", []) if _id(tag) in targets.tags)
    tags_left_out = tuple(_supplied(tag) for tag in saved.get("tags_left_out", []))
    return ItemFill(
        merchant=merchant,
        category=category,
        category_left_out=category_left_out,
        tags=tags,
        tags_left_out=tags_left_out,
        matched=any((merchant, category, category_left_out, tags, tags_left_out)),
    )


def is_addable(item: SavedItem, fill: ItemFill) -> bool:
    """Return whether an item holds all it needs to be added to the ledger, and nothing a write refuses for a known reason

    It needs a merchant and a category of the item's direction, an amount that can be read, an
    account that isn't archived, a date a transaction accepts, and no more tags than a transaction carries
    """
    return (
        fill.merchant is not None
        and fill.category is not None
        and item.amount is not None
        and not item.archived
        and get_window_error(item.date) is None
        and not fill.tags_left_out
    )


async def keep_addable(db: AsyncSession, user_id: uuid.UUID, items: Sequence[SavedItem]) -> list[SavedItem]:
    """Return the items that can be added, rebuilt from their saved values and the records as they are now, in the order given"""
    targets = await read_saved_targets(db, user_id, items)
    return [item for item in items if is_addable(item, read_saved_fill(item, targets))]


def candidates_query(scope: Sequence[ColumnElement[bool]]) -> Select:
    """Return the one statement reading the waiting new items of a scope whose saved values hold a merchant and a category

    Args:
        scope: The conditions limiting the items to the accounts in scope, which join Account
    """
    return (
        select(
            BankTransaction.id, BankTransaction.observed_amount, BankTransaction.observed_date, Account.is_archived, BankTransaction.rule_fill
        )
        .join(Account, Account.id == BankTransaction.account_id)
        .where(AWAITING_REVIEW, BankTransaction.rule_fill.has_key("merchant"), BankTransaction.rule_fill.has_key("category"), *scope)
    )


async def writable_accounts_scope(db: AsyncSession, user: User) -> list[ColumnElement[bool]]:
    """Return the condition keeping out the accounts the installed check holds read-only, or none when it holds none

    Nothing can be added to a read-only account, so approving all leaves its items waiting and the button
    doesn't count them. The check is asked only when the user holds an account in another currency, as
    every other read of read-only records does

    Args:
        db: Active database session
        user: The user reviewing
    """
    holds_other_currency = await db.scalar(
        select(
            exists().where(own_personal_account_condition(user.id), Account.currency != user.base_currency)
        )
    )
    if not holds_other_currency or await find_session_foreign_currencies_reason(db, user.id) is None:
        return []

    # The review list and the press reach only the user's own personal accounts. The check reaches those by currency alone
    return [Account.currency == user.base_currency]


async def stream_candidates(db: AsyncSession, scope: Sequence[ColumnElement[bool]], *, newest_first: bool) -> AsyncIterator[list[SavedItem]]:
    """Yield the candidates of a scope a chunk at a time from one statement, so thousands never sit in memory at once

    A caller that stops early closes this, which closes the statement's cursor
    """
    query = candidates_query(scope)
    if newest_first:
        query = query.order_by(BankTransaction.observed_date.desc(), BankTransaction.id.desc())
    result = await db.stream(query.execution_options(yield_per=rule_fills.SCAN_CHUNK_SIZE))
    try:
        async for rows in result.partitions():
            yield [SavedItem(*row) for row in rows]
    finally:
        await result.close()


async def any_addable(db: AsyncSession, user_id: uuid.UUID, scope: Sequence[ColumnElement[bool]]) -> bool:
    """Say whether any waiting new item of the scope can be added, reading chunks of candidates until one counts"""
    async with aclosing(stream_candidates(db, scope, newest_first=False)) as chunks:
        async for items in chunks:
            if await keep_addable(db, user_id, items):
                return True
    return False


async def rules_changed(db: AsyncSession, user_id: uuid.UUID) -> bool:
    """Say whether the rules changed since a waiting new item was put through them, over every one the person has

    True when a waiting new item in the person's own personal accounts, whatever the list is
    filtered to, holds another digest than the rules have now. A person with no rules is offered
    nothing unless an item still holds values from a rule since deleted
    """
    waiting = select(BankTransaction.id).join(Account, Account.id == BankTransaction.account_id)
    waiting = waiting.where(AWAITING_REVIEW, own_personal_account_condition(user_id))
    if not await db.scalar(select(exists(waiting))):
        return False
    loaded = await load_import_rules(db, user_id)
    stale = BankTransaction.rules_version.is_distinct_from(loaded.version)
    if not loaded.rules:
        stale &= BankTransaction.rule_fill.is_not(None)
    return bool(await db.scalar(select(exists(waiting.where(stale)))))


def _reference(supplied: Supplied) -> ImportRuleReference:
    """Return the rule behind a value"""
    return ImportRuleReference(id=supplied.rule.id, name=supplied.rule.name)


def _given(supplied: Supplied, name: str) -> ImportRuleGivenValue:
    """Return a value a rule gives, with its name and the rule behind it"""
    return ImportRuleGivenValue(id=supplied.value, name=name, rule=_reference(supplied))


def build_rule_fill(fill: ItemFill, targets: FillTargets) -> ReviewItemRuleFill | None:
    """Return what the rules fill in for an item as the list carries it, or None when nothing is left of what they gave it"""
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
        fills: What the saved values read as now for each new item of the page that holds any, by item id
        rules: The two facts over every waiting item for the first page, else None
    """

    fills: dict[uuid.UUID, ReviewItemRuleFill]
    rules: BankReviewRulesResponse | None


async def read_page_rules(
    db: AsyncSession,
    user_id: uuid.UUID,
    scope: Sequence[ColumnElement[bool]],
    items: Sequence[SavedItem],
    *,
    first_page: bool,
    any_waiting: bool,
    writable: Sequence[ColumnElement[bool]] = (),
) -> PageRules:
    """Read what the saved values of a page's new items say now, with the facts over the whole scope for the first page

    Args:
        db: Active database session
        user_id: The user reviewing
        scope: The conditions limiting the list to the accounts shown
        items: The new items of the page
        first_page: Whether the page is the first, which answers the facts
        any_waiting: Whether any new item waits in the scope, since `any_addable` is false for none and costs nothing then.
            `changed` covers the person's own accounts whatever the scope, so it is always read
        writable: The condition keeping out read-only accounts, from `writable_accounts_scope`, for the first page
    """
    fills: dict[uuid.UUID, ReviewItemRuleFill] = {}
    if any(item.saved for item in items):
        targets = await read_saved_targets(db, user_id, items)
        for item in items:
            rule_fill = build_rule_fill(read_saved_fill(item, targets), targets)
            if rule_fill is not None:
                fills[item.id] = rule_fill
    rules = None
    if first_page:
        addable = any_waiting and await any_addable(db, user_id, [*scope, *writable])

        # An item ready to add in a read-only account would otherwise leave Approve all saying no item holds
        # a merchant and a category, so the check's own sentence says why instead
        read_only_reason = None
        if any_waiting and not addable and writable and await any_addable(db, user_id, scope):
            read_only_reason = await find_session_foreign_currencies_reason(db, user_id)
        rules = BankReviewRulesResponse(
            any_addable=addable, changed=await rules_changed(db, user_id), read_only_reason=read_only_reason
        )
    return PageRules(fills, rules)
