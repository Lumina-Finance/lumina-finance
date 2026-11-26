"""Keeping import rules in step with the merchants, categories and tags they name"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy import ColumnElement, delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.import_rule import ImportRule, ImportRuleTag


async def refuse_merchant_used_by_rule(db: AsyncSession, merchant_id: uuid.UUID) -> None:
    """Refuse deleting a merchant that a rule sets

    Args:
        db: Active database session
        merchant_id: The merchant about to be deleted

    Raises:
        HTTPException: Raised with 409 naming the first rule by position
    """
    await _refuse_when_named(db, "Merchant", ImportRule.merchant_id == merchant_id)


async def refuse_category_used_by_rule(db: AsyncSession, category_id: uuid.UUID) -> None:
    """Refuse deleting a category that a rule sets

    Args:
        db: Active database session
        category_id: The category about to be deleted

    Raises:
        HTTPException: Raised with 409 naming the first rule by position
    """
    await _refuse_when_named(db, "Category", ImportRule.category_id == category_id)


async def refuse_tag_used_by_rule(db: AsyncSession, tag_id: uuid.UUID) -> None:
    """Refuse deleting a tag that a rule adds

    Args:
        db: Active database session
        tag_id: The tag about to be deleted

    Raises:
        HTTPException: Raised with 409 naming the first rule by position
    """
    await _refuse_when_named(db, "Tag", ImportRule.id.in_(select(ImportRuleTag.import_rule_id).where(ImportRuleTag.tag_id == tag_id)))


async def _refuse_when_named(db: AsyncSession, kind: str, rule_filter: ColumnElement[bool]) -> None:
    """Refuse with the name of the first rule, by position, that the filter picks out

    Row-level security shows only the caller's own rules. That is every rule that can name what the
    caller deletes, since a rule never names a group's merchant, category or tag, and only the owner
    of a personal one deletes it
    """
    name = await db.scalar(select(ImportRule.name).where(rule_filter).order_by(ImportRule.position).limit(1))
    if name is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f'{kind} is used by the import rule "{name}"')


async def move_merchant_rules(db: AsyncSession, source_merchant_id: uuid.UUID, replacement_merchant_id: uuid.UUID) -> None:
    """Point the rules that set a merchant at the merchant replacing it

    Args:
        db: Active database session
        source_merchant_id: The merchant being merged away
        replacement_merchant_id: The merchant taking its place
    """
    await db.execute(update(ImportRule).where(ImportRule.merchant_id == source_merchant_id).values(merchant_id=replacement_merchant_id))


async def move_category_rules(db: AsyncSession, source_category_id: uuid.UUID, replacement_category_id: uuid.UUID) -> None:
    """Point the rules that set a category at the category replacing it

    Args:
        db: Active database session
        source_category_id: The category being merged away
        replacement_category_id: The category taking its place
    """
    await db.execute(update(ImportRule).where(ImportRule.category_id == source_category_id).values(category_id=replacement_category_id))


async def move_tag_rules(db: AsyncSession, source_tag_id: uuid.UUID, replacement_tag_id: uuid.UUID) -> None:
    """Point the rules that add a tag at the tag replacing it, leaving a rule that adds both with the one

    Args:
        db: Active database session
        source_tag_id: The tag being merged away
        replacement_tag_id: The tag taking its place
    """
    already_replaced = select(ImportRuleTag.import_rule_id).where(ImportRuleTag.tag_id == replacement_tag_id)
    await db.execute(delete(ImportRuleTag).where(ImportRuleTag.tag_id == source_tag_id, ImportRuleTag.import_rule_id.in_(already_replaced)))
    await db.execute(update(ImportRuleTag).where(ImportRuleTag.tag_id == source_tag_id).values(tag_id=replacement_tag_id))
