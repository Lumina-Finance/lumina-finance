"""Filling a file import's rows in from the user's import rules"""

import asyncio
import uuid
from dataclasses import replace

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import CategoryKind
from app.schemas.import_run import MAX_IMPORT_TAGS_PER_ROW
from app.services.import_rules.file_rows import NO_KEYS, FileRow, fill_rows, load_fill_targets
from app.services.import_rules.loading import load_import_rules, tag_key
from app.services.import_rules.matching import MatchCandidate
from app.services.importers.shared.stats import ImportStats
from app.services.importers.shared.transaction_writer import ImportedTransaction


def too_many_tags_detail(count: int) -> str:
    """Return how a row past what a transaction carries is refused"""
    return f"There are {count} tags, and a transaction carries up to {MAX_IMPORT_TAGS_PER_ROW}."


async def apply_import_rules(
    db: AsyncSession,
    user_id: uuid.UUID,
    transactions: list[ImportedTransaction],
    stats: ImportStats,
) -> list[ImportedTransaction]:
    """Return the rows with the merchant, category and tags the user's rules give them

    A rule's merchant and category stand in for the file's, and its tags join the file's. A row filed
    as a transfer is left as the file has it. The rules are read when the save runs, so a rule changed
    since the preview changes the save, and the matching runs off the event loop

    Args:
        db: Active database session
        user_id: Authenticated user running the import
        transactions: The rows to be written, in file order
        stats: Import summary counters, which count the records the rules used as reused

    Returns:
        The rows in the same order, unchanged where no rule gives anything

    Raises:
        HTTPException: Raised with 422 when a row's tags and its rules' tags together pass the most a
            transaction carries, and with 409 when a rule changed under the save
    """
    loaded = await load_import_rules(db, user_id)
    if not loaded.rules:
        return transactions

    rows = [
        FileRow(
            MatchCandidate(
                description=transaction.merchant_name,
                note=transaction.notes,
                amount=transaction.amount,
                currency=transaction.account.currency,
                account_id=transaction.account.id,
                is_transfer=transaction.category.kind == CategoryKind.TRANSFER,
            ),
            frozenset(tag_key(name) for name in transaction.tag_names if name.strip()) if transaction.tag_names else NO_KEYS,
        )
        for transaction in transactions
    ]
    fills = await asyncio.to_thread(fill_rows, loaded.build_matcher(), rows)
    for fill in fills:
        if fill.tag_count > MAX_IMPORT_TAGS_PER_ROW:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=too_many_tags_detail(fill.tag_count))

    targets = await load_fill_targets(db, user_id, fills)
    stats.reused_merchant_ids.update(targets.merchants)
    stats.reused_category_ids.update(targets.categories)
    stats.reused_tag_ids.update(targets.tags)
    return [
        transaction
        if fill.merchant is None and fill.category is None and not fill.tags
        else replace(
            transaction,
            category=transaction.category if fill.category is None else targets.categories[fill.category.value],
            rule_merchant=None if fill.merchant is None else targets.merchants[fill.merchant.value],
            rule_tags=tuple(targets.tags[tag.value] for tag in fill.tags),
        )
        for transaction, fill in zip(transactions, fills, strict=True)
    ]
