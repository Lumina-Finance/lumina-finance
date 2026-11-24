"""What the rules give the rows of a file import

The preview asks it of the rows the page holds and the save asks it of the rows it writes, so both
go through the same functions and a row gets the same answer in each
"""

import uuid
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.category import Category
from app.models.merchant import Merchant
from app.models.tag import Tag
from app.services.import_rules.changes import CHANGED_DETAIL
from app.services.import_rules.matching import ImportRuleMatcher, MatchCandidate, Supplied, SuppliedTag

NO_KEYS: frozenset[str] = frozenset()


@dataclass(frozen=True)
class FileRow:
    """What the fill reads of one row

    Attributes:
        candidate: The facts the rules compare
        file_tag_keys: The tags the file gives the row, as `tag_key` writes them
    """

    candidate: MatchCandidate
    file_tag_keys: frozenset[str] = NO_KEYS


@dataclass(frozen=True)
class FileRowFill:
    """What the rules give one row

    Attributes:
        merchant: The merchant the highest matching rule sets, if any
        category: The category the highest matching rule sets, if any
        tags: Every tag the matching rules add
        new_tags: The tags among them the file does not give. A tag the file gives is the file's and
            counts for no rule
        tag_count: How many tags the row ends with: the file's and the new ones
    """

    merchant: Supplied | None = None
    category: Supplied | None = None
    tags: tuple[SuppliedTag, ...] = ()
    new_tags: tuple[SuppliedTag, ...] = ()
    tag_count: int = 0

    @property
    def rule_ids(self) -> set[uuid.UUID]:
        """Return the rules that gave this row a value it ends with"""
        supplied = [self.merchant, self.category, *self.new_tags]
        return {value.rule.id for value in supplied if value is not None}


@dataclass(frozen=True)
class FillTargets:
    """The merchants, categories and tags the rules give, by id"""

    merchants: dict[uuid.UUID, Merchant]
    categories: dict[uuid.UUID, Category]
    tags: dict[uuid.UUID, Tag]


def fill_rows(matcher: ImportRuleMatcher, rows: Sequence[FileRow]) -> list[FileRowFill]:
    """Ask the rules about each row

    Pure, so it can run off the event loop

    Args:
        matcher: The person's rules
        rows: The rows' facts, in file order

    Returns:
        One answer per row, in the same order
    """
    fills = []
    for row in rows:
        match = matcher.match(row.candidate)
        if match.merchant is None and match.category is None and not match.tags:
            fills.append(FileRowFill(tag_count=len(row.file_tag_keys)))
            continue

        # A tag the file also gives is the file's, so it counts for no rule and adds nothing to the row's tags
        new_tags = tuple(tag for tag in match.tags if tag.key not in row.file_tag_keys)
        fills.append(
            FileRowFill(
                merchant=match.merchant,
                category=match.category,
                tags=match.tags,
                new_tags=new_tags,
                tag_count=len(row.file_tag_keys) + len(new_tags),
            )
        )
    return fills


def count_rows_per_rule(fills: Sequence[FileRowFill]) -> Counter[uuid.UUID]:
    """Return how many rows each rule gave a value they end with"""
    counts: Counter[uuid.UUID] = Counter()
    for fill in fills:
        counts.update(fill.rule_ids)
    return counts


async def load_fill_targets(db: AsyncSession, user_id: uuid.UUID, fills: Sequence[FileRowFill]) -> FillTargets:
    """Read the merchants, categories and tags the answers name, one statement for each kind

    Args:
        db: Active database session
        user_id: The person the rules belong to
        fills: Answers for the rows

    Returns:
        The records by id

    Raises:
        HTTPException: Raised with 409 when a rule names a record that is gone, which is a rule
            changed at that moment
    """
    merchant_ids = {fill.merchant.value for fill in fills if fill.merchant is not None}
    category_ids = {fill.category.value for fill in fills if fill.category is not None}
    tag_ids = {tag.value for fill in fills for tag in fill.tags}
    targets = await read_fill_targets(db, user_id, merchant_ids, category_ids, tag_ids)
    if not (merchant_ids <= targets.merchants.keys() and category_ids <= targets.categories.keys() and tag_ids <= targets.tags.keys()):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=CHANGED_DETAIL)
    return targets


async def read_fill_targets(
    db: AsyncSession, user_id: uuid.UUID, merchant_ids: set[uuid.UUID], category_ids: set[uuid.UUID], tag_ids: set[uuid.UUID]
) -> FillTargets:
    """Read the merchants, categories and tags named by id, one statement for each kind, leaving out any that is gone

    Args:
        db: Active database session
        user_id: The person the records belong to
        merchant_ids: The merchants to read
        category_ids: The categories to read
        tag_ids: The tags to read

    Returns:
        The records found by id, within what a person files under
    """
    # The scopes an import files rows under, written here rather than imported from the importers,
    # which import this module in turn: the user's own personal records, and for merchants and
    # categories the ones that ship with the app
    merchants: dict[uuid.UUID, Merchant] = {}
    if merchant_ids:
        usable_merchant = Merchant.is_system.is_(True) | ((Merchant.owner_id == user_id) & Merchant.group_id.is_(None))
        merchants = {
            merchant.id: merchant for merchant in await db.scalars(select(Merchant).where(Merchant.id.in_(merchant_ids), usable_merchant))
        }
    categories: dict[uuid.UUID, Category] = {}
    if category_ids:
        usable = Category.is_system.is_(True) | ((Category.owner_id == user_id) & Category.group_id.is_(None))
        categories = {category.id: category for category in await db.scalars(select(Category).where(Category.id.in_(category_ids), usable))}
    tags = (
        {tag.id: tag for tag in await db.scalars(select(Tag).where(Tag.id.in_(tag_ids), Tag.owner_id == user_id, Tag.group_id.is_(None)))}
        if tag_ids
        else {}
    )
    return FillTargets(merchants=merchants, categories=categories, tags=tags)
