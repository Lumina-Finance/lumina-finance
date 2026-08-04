"""Cache state update service"""

import uuid

import sqlalchemy as sa
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.rls.functions import BUMP_GROUP_MEMBER_CACHE
from app.dependencies import get_current_session_id
from app.models.cache_state import GroupCacheState, UserCacheState


async def mark_user_cache_changed(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Record a personal-scope app-data change

    Args:
        db: Active database session
        user_id: User scope that changed

    Returns:
        None
    """
    await _upsert_cache_state(db, UserCacheState, "user_id", user_id)


async def mark_group_member_cache_changed(
    db: AsyncSession,
    user_id: uuid.UUID,
    group_id: uuid.UUID,
) -> None:
    """Record a personal-scope change for a member of a group the caller administers

    Removing a member from a group must invalidate that member's cache, which the
    per-user write policy blocks when an admin removes someone else, so this routes
    through a security-definer helper that bypasses the per-user scoping. The helper
    refuses unless the caller is the member or an admin of the group given here

    Args:
        db: Active database session
        user_id: User scope that changed
        group_id: Group whose admin is making the change

    Returns:
        None

    Raises:
        ProgrammingError: The caller is neither the member nor an admin of the group
    """
    await db.execute(
        text(f"SELECT {BUMP_GROUP_MEMBER_CACHE}(:user_id, :group_id)"),
        {"user_id": user_id, "group_id": group_id},
    )


async def mark_group_cache_changed(db: AsyncSession, group_id: uuid.UUID) -> None:
    """Record a group-scope app-data change

    Args:
        db: Active database session
        group_id: Group scope that changed

    Returns:
        None
    """
    await _upsert_cache_state(db, GroupCacheState, "group_id", group_id)


async def mark_cache_changed_for_scope(
    db: AsyncSession,
    *,
    user_id: uuid.UUID | None,
    group_id: uuid.UUID | None,
) -> None:
    """Record a cache change for a personal or group-owned resource

    Args:
        db: Active database session
        user_id: Personal scope owner when the resource is not group-owned
        group_id: Group scope owner when the resource is group-owned

    Returns:
        None
    """
    if group_id is not None:
        await mark_group_cache_changed(db, group_id)
        return
    if user_id is not None:
        await mark_user_cache_changed(db, user_id)


async def _upsert_cache_state(
    db: AsyncSession,
    model: type[UserCacheState] | type[GroupCacheState],
    id_column_name: str,
    id_value: uuid.UUID,
) -> None:
    """Insert or update one cache state row

    Args:
        db: Active database session
        model: Cache state model being updated
        id_column_name: Scope identifier column name
        id_value: Scope identifier value

    Returns:
        None
    """
    changed_at = sa.func.clock_timestamp()
    session_id = get_current_session_id()
    stmt = insert(model).values({
        id_column_name: id_value,
        "changed_at": changed_at,
        "last_changed_session_id": session_id,
    })

    # Upsert the scope cache timestamp so repeated writes refresh the same row
    await db.execute(
        stmt.on_conflict_do_update(
            index_elements=[getattr(model, id_column_name)],
            set_={
                "changed_at": changed_at,
                "last_changed_session_id": session_id,
            },
        ),
    )
