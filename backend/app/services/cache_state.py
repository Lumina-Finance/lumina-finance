import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import Select

from app.dependencies import get_current_session_id
from app.models.cache_state import GroupCacheState, UserCacheState
from app.models.group import GroupMember


@dataclass(frozen=True)
class ScopeCacheStatus:
    """Cache timestamp for one visible scope."""

    changed_at: datetime | None
    last_change_from_current_session: bool


@dataclass(frozen=True)
class VisibleCacheStatus:
    """Cache status visible to one user."""

    changed_at: datetime | None
    personal: ScopeCacheStatus
    groups: dict[uuid.UUID, ScopeCacheStatus]


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
    return (await get_visible_cache_status(db, user_id)).changed_at


async def get_visible_cache_status(db: AsyncSession, user_id: uuid.UUID) -> VisibleCacheStatus:
    """Return personal and group cache status visible to a user."""
    current_session_id = get_current_session_id()
    personal_state = await db.get(UserCacheState, user_id)
    personal = _scope_status(personal_state, current_session_id)

    group_result = await db.execute(
        sa.select(GroupCacheState).where(GroupCacheState.group_id.in_(select_user_group_ids(user_id))),
    )
    groups = {
        state.group_id: _scope_status(state, current_session_id)
        for state in group_result.scalars().all()
    }

    values = [personal.changed_at, *(group.changed_at for group in groups.values())]
    changed_values = [value for value in values if value is not None]
    changed_at = max(changed_values) if changed_values else None
    return VisibleCacheStatus(changed_at=changed_at, personal=personal, groups=groups)


def select_user_group_ids(user_id: uuid.UUID) -> Select[tuple[uuid.UUID]]:
    """Build the group ID query for all groups a user belongs to."""
    return sa.select(GroupMember.group_id).where(GroupMember.user_id == user_id)


def _as_utc(value: datetime) -> datetime:
    """Normalize a timestamp to an explicit UTC-aware datetime."""
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _scope_status(
    state: UserCacheState | GroupCacheState | None,
    current_session_id: uuid.UUID | None,
) -> ScopeCacheStatus:
    if state is None:
        return ScopeCacheStatus(changed_at=None, last_change_from_current_session=False)

    return ScopeCacheStatus(
        changed_at=_as_utc(state.changed_at),
        last_change_from_current_session=(
            current_session_id is not None
            and state.last_changed_session_id is not None
            and state.last_changed_session_id == current_session_id
        ),
    )


async def _upsert_cache_state(
    db: AsyncSession,
    model: type[UserCacheState] | type[GroupCacheState],
    id_column_name: str,
    id_value: uuid.UUID,
) -> None:
    changed_at = sa.func.clock_timestamp()
    session_id = get_current_session_id()
    stmt = insert(model).values({
        id_column_name: id_value,
        "changed_at": changed_at,
        "last_changed_session_id": session_id,
    })
    await db.execute(
        stmt.on_conflict_do_update(
            index_elements=[getattr(model, id_column_name)],
            set_={
                "changed_at": changed_at,
                "last_changed_session_id": session_id,
            },
        ),
    )
