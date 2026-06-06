import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import Select

from app.models.cache_state import GroupCacheState, UserCacheState
from app.models.group import GroupMember


async def mark_user_cache_changed(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Record a personal-scope app-data change."""
    await _upsert_cache_state(db, UserCacheState, "user_id", user_id)


async def mark_group_cache_changed(db: AsyncSession, group_id: uuid.UUID) -> None:
    """Record a group-scope app-data change."""
    await _upsert_cache_state(db, GroupCacheState, "group_id", group_id)


async def mark_cache_changed_for_scope(
    db: AsyncSession,
    *,
    user_id: uuid.UUID | None,
    group_id: uuid.UUID | None,
) -> None:
    """Record a change for a personal or group-owned resource."""
    if group_id is not None:
        await mark_group_cache_changed(db, group_id)
        return
    if user_id is not None:
        await mark_user_cache_changed(db, user_id)


async def get_visible_cache_changed_at(db: AsyncSession, user_id: uuid.UUID) -> datetime | None:
    """Return the latest change timestamp visible to a user."""
    group_ids = select_user_group_ids(user_id)
    result = await db.execute(
        sa.select(sa.func.max(UserCacheState.changed_at))
        .where(UserCacheState.user_id == user_id)
        .union_all(
            sa.select(sa.func.max(GroupCacheState.changed_at))
            .where(GroupCacheState.group_id.in_(group_ids)),
        ),
    )
    values = [value for value in result.scalars().all() if value is not None]
    return max(values) if values else None


def select_user_group_ids(user_id: uuid.UUID) -> Select[tuple[uuid.UUID]]:
    """Build the group ID query for all groups a user belongs to."""
    return sa.select(GroupMember.group_id).where(GroupMember.user_id == user_id)


async def _upsert_cache_state(
    db: AsyncSession,
    model: type[UserCacheState] | type[GroupCacheState],
    id_column_name: str,
    id_value: uuid.UUID,
) -> None:
    changed_at = sa.func.clock_timestamp()
    stmt = insert(model).values({id_column_name: id_value, "changed_at": changed_at})
    await db.execute(
        stmt.on_conflict_do_update(
            index_elements=[getattr(model, id_column_name)],
            set_={"changed_at": changed_at},
        ),
    )
