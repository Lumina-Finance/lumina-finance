"""Cache state status query service"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import Select

from app.dependencies import get_current_session_id
from app.models.cache_state import GroupCacheState, UserCacheState
from app.models.group import GroupMember


@dataclass(frozen=True)
class ScopeCacheStatus:
    """Cache timestamp for one visible scope"""

    changed_at: datetime | None
    last_change_from_current_session: bool


@dataclass(frozen=True)
class VisibleCacheStatus:
    """Cache status visible to one user"""

    changed_at: datetime | None
    personal: ScopeCacheStatus
    groups: dict[uuid.UUID, ScopeCacheStatus]


async def get_visible_cache_changed_at(db: AsyncSession, user_id: uuid.UUID) -> datetime | None:
    """Return the latest change timestamp visible to a user

    Args:
        db: Active database session
        user_id: User whose visible cache timestamp should be loaded

    Returns:
        Latest visible cache timestamp, or None when no visible scope changed
    """
    return (await get_visible_cache_status(db, user_id)).changed_at


async def get_visible_cache_status(db: AsyncSession, user_id: uuid.UUID) -> VisibleCacheStatus:
    """Return personal and group cache status visible to a user

    Args:
        db: Active database session
        user_id: User whose visible cache status should be loaded

    Returns:
        Personal, group, and combined cache status visible to the user
    """
    current_session_id = get_current_session_id()

    # Fetch the user's personal cache state for the top-level personal scope
    personal_state = await db.get(UserCacheState, user_id)
    personal = _scope_status(personal_state, current_session_id)

    # Fetch cache states for every group the user belongs to
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
    """Build the group ID query for all groups a user belongs to

    Args:
        user_id: User whose group memberships should be selected

    Returns:
        SQLAlchemy query selecting group identifiers for the user
    """
    return sa.select(GroupMember.group_id).where(GroupMember.user_id == user_id)


def _as_utc(value: datetime) -> datetime:
    """Return a timestamp normalized to UTC

    Args:
        value: Timestamp to normalize

    Returns:
        UTC-aware timestamp
    """
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _scope_status(
    state: UserCacheState | GroupCacheState | None,
    current_session_id: uuid.UUID | None,
) -> ScopeCacheStatus:
    """Return cache status for one personal or group scope

    Args:
        state: Persisted cache state row for the scope
        current_session_id: Request session identifier used to classify local changes

    Returns:
        Cache status for the scope
    """
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
