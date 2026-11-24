"""Shared test builders for import rules on waiting bank items: a user with the records a rule names, and items holding saved values"""

import asyncio
import uuid
from collections.abc import Coroutine
from dataclasses import dataclass

from app.services.import_rules.loading import load_import_rules
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import _commit_review_item, _new_account, _sign_up
from tests.routes.support.import_rule_helpers import _create_rule_ok, _description_contains, _make_category, _make_merchant
from tests.routes.support.lock_helpers import _wait_until_waiting_on


@dataclass(frozen=True)
class _RulesInbox:
    """A signed-up user's Everyday and Savings accounts, the Harbour Coffee merchant and the Coffee expense category"""

    headers: dict
    user_id: uuid.UUID
    everyday_id: str
    savings_id: str
    merchant_id: str
    category_id: str


async def _rules_inbox(client) -> _RulesInbox:
    """Sign up with empty Everyday and Savings accounts in CAD, a Harbour Coffee merchant and a Coffee expense category"""
    headers, user_id = await _sign_up(client)
    everyday_id = await _new_account(client, headers, "Everyday")
    savings_id = await _new_account(client, headers, "Savings")
    merchant_id = await _make_merchant(client, headers, "Harbour Coffee")
    category_id = await _make_category(client, headers, "Coffee")
    return _RulesInbox(headers, user_id, everyday_id, savings_id, merchant_id, category_id)


async def _coffee_rule(client, inbox: _RulesInbox, text: str = "harbour", **overrides) -> dict:
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


def _saved_value(record_id: str, rule: dict) -> dict:
    """Return a value as an item saves it: the record's id and the rule behind it"""
    return {"id": record_id, "rule": {"id": rule["id"], "name": rule["name"]}}


def _saved(rule: dict, *, merchant_id: str | None = None, category_id: str | None = None, tag_ids: tuple[str, ...] = ()) -> dict:
    """Return the values a rule gave an item as the item saves them, leaving out each one not given"""
    saved = {}
    if merchant_id is not None:
        saved["merchant"] = _saved_value(merchant_id, rule)
    if category_id is not None:
        saved["category"] = _saved_value(category_id, rule)
    if tag_ids:
        saved["tags"] = [_saved_value(tag_id, rule) for tag_id in tag_ids]
    return saved


async def _current_digest(inbox: _RulesInbox) -> str:
    """Return the digest of the user's rules as they stand"""
    async with TestSession() as session:
        return (await load_import_rules(session, inbox.user_id)).version


async def _commit_filled_item(
    inbox: _RulesInbox,
    saved: dict | None,
    external_id: str = "TRN-1001",
    *,
    account_id: str | None = None,
    rules_version: str | None = None,
    **values,
) -> uuid.UUID:
    """Commit a waiting item holding saved rule values, put through the rules as they stand now unless given another digest"""
    digest = rules_version or await _current_digest(inbox)
    return await _commit_review_item(account_id or inbox.everyday_id, external_id, rule_fill=saved, rules_version=digest, **values)


async def _queue_in_order(blocker_pid: int, first: Coroutine, second: Coroutine) -> tuple[asyncio.Task, asyncio.Task]:
    """Start two requests so the first queues behind the blocker's row lock before the second does, and return their tasks

    A lock is granted in the order requests queued for it, so which request goes first is the test's choice and not the scheduler's
    """
    first_task = asyncio.create_task(first)
    await _wait_until_waiting_on(blocker_pid, first_task)
    second_task = asyncio.create_task(second)
    await _wait_until_waiting_on(blocker_pid, asyncio.gather(first_task, second_task), waiters=2)
    return first_task, second_task
