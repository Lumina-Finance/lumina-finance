"""Putting the bank items a sync writes through the owner's import rules, so the values are saved as the items arrive

The fill must never fail a sync, which holds its links and rows locked in one transaction. So
everything it reads sits in a savepoint, a failure of any kind rolls that savepoint back alone, and
the items the sync writes are then saved unfilled, with no digest, for the owner to be offered the
rules for them. The rules, the accounts' currencies and the categories' kinds are read once for the
whole call however many items it writes
"""

import asyncio
import logging
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.services.bank_sync.rule_fills import fill_candidates, fill_to_saved, load_rule_fill_context
from app.services.import_rules.matching import MatchCandidate

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ArrivingItem:
    """The facts of one item a sync writes as waiting that the rules read

    Attributes:
        account_id: The account it waits on
        description: The bank's text
        note: The bank's own note about the payment
        amount: Signed amount in the account's minor units, or None when the bank's can't be stored
    """

    account_id: uuid.UUID
    description: str | None
    note: str | None
    amount: int | None


@dataclass(frozen=True)
class SavedFill:
    """What an item is saved with: the rules' values and the digest of the rules that gave them

    Both are None when the item was put through no rules, and the values alone are None when the
    rules gave it nothing
    """

    rule_fill: dict[str, Any] | None
    rules_version: str | None


# Saved on an item the rules couldn't be read for. The owner is then offered the rules for it
UNFILLED = SavedFill(None, None)


async def fill_arriving_items(db: AsyncSession, user_id: uuid.UUID, items: Sequence[ArrivingItem]) -> list[SavedFill]:
    """Put the items through the owner's rules and return what each is saved with, never raising

    A person with no rules still gets the digest of that empty set, so a rule they create later is
    told apart from items never put through any

    Args:
        db: The sync's session, with its transaction open and the items not yet flushed
        user_id: The owner of the rules
        items: The items the call writes as waiting

    Returns:
        One saved fill per item, in the same order
    """
    try:
        async with db.begin_nested():
            context = await load_rule_fill_context(db, user_id)
            if not context.has_rules:
                return [SavedFill(None, context.version)] * len(items)
            currencies = dict(
                (await db.execute(select(Account.id, Account.currency).where(Account.id.in_({item.account_id for item in items})))).all()
            )
            candidates = [
                MatchCandidate(item.description, item.note, item.amount, currencies[item.account_id], item.account_id, is_transfer=False)
                for item in items
            ]
            fills = await asyncio.to_thread(fill_candidates, context.matcher, candidates, context.category_kinds)
            return [SavedFill(fill_to_saved(fill), context.version) for fill in fills]
    except Exception:
        # Best effort: a rule that can't be read or matched must never fail the sync that holds the locks
        logger.exception("Import rules couldn't be applied to %d new bank items, which are saved unfilled", len(items))
        return [UNFILLED] * len(items)
