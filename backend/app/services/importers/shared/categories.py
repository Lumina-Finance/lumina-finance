"""Transaction import category mapping"""
import uuid

from fastapi import HTTPException, status
from sqlalchemy import func, literal_column, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import CategoryKind
from app.models.category import Category
from app.models.group import GroupMember
from app.models.user import User
from app.schemas.transaction import TransactionImportCategoryMapping, TransactionImportCreateCategory
from app.services.importers.shared.insertion_helpers import insert_import_records_if_absent
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
        stats.reused_category_ids.add(category.id)
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

    existing = await _select_reusable_import_category(db, user_id, name)
    if existing is not None:
        return _reuse_import_category(existing, kind, name, stats)

    inserted = await insert_import_records_if_absent(
        db,
        Category,
        [{"owner_id": user_id, "group_id": None, "name": name, "kind": kind, "icon": create.icon}],
        index_elements=[Category.owner_id, literal_column("lower(name)")],
        index_where=text("owner_id IS NOT NULL AND group_id IS NULL"),
    )
    if inserted:
        category = inserted[0]
        stats.categories_created += 1
        stats.created_category_ids.append(category.id)
        return category

    # Nothing was written, so this name was taken between the lookup above and the insert, by
    # another import or by the user in another tab. It is reused exactly as it would have been had
    # it been there all along, the kind check included, rather than the insert failing the file
    created_elsewhere = await _select_reusable_import_category(db, user_id, name)
    if created_elsewhere is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Category could not be created or found: {name}",
        )
    return _reuse_import_category(created_elsewhere, kind, name, stats)


async def _select_reusable_import_category(db: AsyncSession, user_id: uuid.UUID, name: str) -> Category | None:
    """Return the category an import create mapping would reuse rather than write

    Args:
        db: Active database session
        user_id: Identifier for the user running the import
        name: Trimmed name the mapping asked to create

    Returns:
        The category to reuse, or None where the name is free
    """
    # Compared with capitals folded, so a file spelling it GROCERIES reuses the user's Groceries
    # rather than writing a second one the category routes would have refused. A user's own category
    # wins over one that ships with the app, which is what the ordering settles
    result = await db.execute(
        select(Category)
        .where(
            func.lower(Category.name) == name.lower(),
            Category.is_system.is_(True) | ((Category.owner_id == user_id) & (Category.group_id.is_(None))),
        )
        .order_by(Category.is_system.asc())
        .limit(1),
    )
    return result.scalar_one_or_none()


def _reuse_import_category(existing: Category, kind: CategoryKind, name: str, stats: ImportStats) -> Category:
    """Take an existing category for an import source, refusing one recording the other direction

    Args:
        existing: Category found for the name the mapping asked to create
        kind: Kind the mapping asked for
        name: Trimmed name the mapping asked to create
        stats: Import summary counters updated when a category is reused

    Returns:
        The category to file the source's rows under

    Raises:
        HTTPException: Raised with 422 when the existing category records the other direction
    """
    if existing.kind != kind:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                f"A category named {existing.name} already records {existing.kind.value}, "
                f"so this import cannot create {name} as {kind.value}. "
                f"Match this value to that category, or set its type to {existing.kind.value}."
            ),
        )
    stats.reused_category_ids.add(existing.id)
    return existing


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
