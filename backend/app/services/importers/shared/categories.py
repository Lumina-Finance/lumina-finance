"""Transaction import category mapping"""
import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import CategoryKind
from app.models.category import Category
from app.models.group import GroupMember
from app.models.user import User
from app.schemas.transaction import TransactionImportCategoryMapping, TransactionImportCreateCategory
from app.services.importers.shared.stats import ImportStats
from app.services.importers.shared.validation_helpers import strip_import_text_or_raise


async def get_or_create_import_categories_by_source(
    db: AsyncSession,
    user: User,
    mappings: list[TransactionImportCategoryMapping],
    stats: ImportStats,
) -> dict[str, Category]:
    """Return category rows keyed by import source

    Existing category mappings are checked against user-visible categories,
    while create mappings reuse a matching personal or system category before
    creating a new personal category

    Args:
        db: Active database session
        user: Authenticated user running the import
        mappings: Category source mappings from the import payload
        stats: Import summary counters updated while categories are matched or created

    Returns:
        Category rows keyed by trimmed category source
    """
    categories_by_source: dict[str, Category] = {}

    # Build each declared category source once so import rows can use a stable lookup map
    for mapping in mappings:
        source = strip_import_text_or_raise(mapping.source, "Category source")
        if source in categories_by_source:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"Duplicate category source: {source}")

        categories_by_source[source] = await _get_or_create_import_category_for_mapping(db, user.id, mapping, source, stats)
    return categories_by_source


async def _get_or_create_import_category_for_mapping(
    db: AsyncSession,
    user_id: uuid.UUID,
    mapping: TransactionImportCategoryMapping,
    source: str,
    stats: ImportStats,
) -> Category:
    """Return the category selected by one import category source mapping

    Args:
        db: Active database session
        user_id: Identifier for the user running the import
        mapping: Category source mapping from the import payload
        source: Trimmed category source used in validation messages
        stats: Import summary counters updated when a category is reused or created

    Returns:
        Existing or newly created category row for the import source

    Raises:
        HTTPException: Raised with 422 when the source does not map to exactly one category action
    """
    if (mapping.category_id is None) == (mapping.create is None):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Category source must map to exactly one category action: {source}",
        )

    if mapping.category_id is not None:
        category = await get_visible_import_category(db, mapping.category_id, user_id)
        stats.categories_reused += 1
        return category

    return await _get_or_create_personal_import_category(db, user_id, mapping.create, stats)


async def get_visible_import_category(db: AsyncSession, category_id: uuid.UUID, user_id: uuid.UUID) -> Category:
    """Return an existing category visible to the importing user

    Args:
        db: Active database session
        category_id: Existing category ID selected for an import source
        user_id: Identifier for the user running the import

    Returns:
        Category row visible to the importing user

    Raises:
        HTTPException: Raised with 422 when the category is not visible
    """
    group_ids = select(GroupMember.group_id).where(GroupMember.user_id == user_id).scalar_subquery()

    # Fetch the selected category only if it is system, personal, or in one of the user's groups
    result = await db.execute(
        select(Category).where(
            Category.id == category_id,
            Category.is_system.is_(True)
            | ((Category.owner_id == user_id) & (Category.group_id.is_(None)))
            | (Category.group_id.in_(group_ids)),
        ),
    )
    category = result.scalar_one_or_none()
    if category is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Category not found")
    return category


async def _get_or_create_personal_import_category(
    db: AsyncSession,
    user_id: uuid.UUID,
    create: TransactionImportCreateCategory,
    stats: ImportStats,
) -> Category:
    """Return a matching category or create a personal import category

    Args:
        db: Active database session
        user_id: Identifier for the user running the import
        create: New category fields from the import mapping
        stats: Import summary counters updated when a category is reused or created

    Returns:
        Existing or newly created category row
    """
    kind = parse_import_category_kind(create.kind)
    name = strip_import_text_or_raise(create.name, "Category name")

    # Reuse a same-named system or personal category before inserting a new personal category
    result = await db.execute(
        select(Category)
        .where(
            Category.name == name,
            Category.is_system.is_(True) | ((Category.owner_id == user_id) & (Category.group_id.is_(None))),
        )
        .order_by(Category.is_system.asc())
        .limit(1),
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        if existing.kind != kind:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Category with this name already exists with a different type: {name}",
            )
        stats.categories_reused += 1
        return existing

    category = Category(
        owner_id=user_id,
        group_id=None,
        name=name,
        kind=kind,
        icon=create.icon,
    )
    db.add(category)
    await db.flush()
    stats.categories_created += 1
    stats.created_category_ids.append(category.id)
    return category


def parse_import_category_kind(value: str) -> CategoryKind:
    """Return a category kind enum for an import-created category

    Args:
        value: Raw category kind value from the import payload

    Returns:
        Parsed category kind enum

    Raises:
        HTTPException: Raised with 422 when the category kind is unsupported
    """
    try:
        return CategoryKind(value)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid category kind") from exc
