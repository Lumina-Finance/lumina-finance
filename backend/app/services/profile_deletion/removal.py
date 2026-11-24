"""Deleting a marked profile's data in batches, and then the user row

Each table holding a user's rows is emptied of them in small batches, children before the rows they
name, every batch acting as the user, so row-level security still applies to each statement and no
one statement runs past the statement time limit. The tables come from the models, so a table added
later is covered without a change here. The user row goes last, and its foreign keys delete anything a
batch missed

The cleanup's passes finish any profile a restart left part-way, so a deletion never stops for good
"""

import logging
import uuid
from datetime import UTC, datetime
from functools import cache

from sqlalchemy import ColumnElement, Table, bindparam, delete, or_, select, text, tuple_
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.database import acting_as
from app.db.rls.functions import LIST_PROFILES_TO_DELETE
from app.models import import_all_models
from app.models.base import Base
from app.models.user import User
from app.profile_deletion_hook import ProfileDeletion, notify_profile_deletion
from app.services.bank_sync.links import disconnect_every_connection
from app.services.bank_sync.release import release_stored_credentials

logger = logging.getLogger(__name__)

# Rows deleted per statement. Small enough that a batch of the largest rows, with whatever their own
# foreign keys delete, finishes in well under the statement time limit on a personal server
DELETION_BATCH_SIZE = 1000

# The user whose rows a batch deletes, bound when the batch runs
_USER_ID = bindparam("user_id", type_=User.__table__.c.id.type)


async def delete_marked_profiles(session_factory: async_sessionmaker[AsyncSession]) -> None:
    """Finish deleting every profile marked for deletion, one at a time

    A profile that fails is logged and waits for the next pass, and the rest still run

    Args:
        session_factory: Opens the sessions the passes run in, with no request identity
    """
    async with session_factory() as session:
        user_ids = list(await session.scalars(text(f"SELECT {LIST_PROFILES_TO_DELETE}()")))
    for user_id in user_ids:
        await delete_profile(session_factory, user_id)


async def delete_profile(session_factory: async_sessionmaker[AsyncSession], user_id: uuid.UUID) -> None:
    """Delete everything a marked user holds and then the user row, and tell the observers once

    Two passes over one profile can run at once, such as the one a request starts and the cleanup's.
    Each batch locks the user row first, so they take turns, and only the pass whose delete returned
    the user row tells the observers

    Args:
        session_factory: Opens the sessions the deletion runs in
        user_id: The user whose profile goes. Nothing happens unless the user is marked
    """
    try:
        with acting_as(user_id):
            deleted_at = await _delete_profile(session_factory, user_id)
    except Exception:
        # Best-effort: the profile stays marked, so its owner still can't sign in, and the next cleanup pass
        # carries on from what this one deleted
        logger.warning("A profile could not be deleted yet", exc_info=True)
        return
    if deleted_at is not None:
        notify_profile_deletion(ProfileDeletion(user_id=user_id, deleted_at=deleted_at))


async def _delete_profile(session_factory: async_sessionmaker[AsyncSession], user_id: uuid.UUID) -> datetime | None:
    """Delete the profile acting as its user, returning when the user row went, or None when another pass took it"""
    # A connection still here would be deleted by the user row's foreign keys without its credential
    # going back to the provider, so any left go the way the request ends them first
    async with session_factory() as db:
        if not await _lock_marked_user(db, user_id):
            return None
        credentials = await disconnect_every_connection(db, user_id)
        await db.commit()
    await release_stored_credentials(credentials)

    for table, owned in _deletion_steps():
        statement = delete(table).where(
            tuple_(*table.primary_key.columns).in_(select(*table.primary_key.columns).where(owned).limit(DELETION_BATCH_SIZE))
        )
        while True:
            async with session_factory() as db:
                if not await _lock_marked_user(db, user_id):
                    return None
                deleted = (await db.execute(statement, {"user_id": user_id})).rowcount
                await db.commit()
            if deleted < DELETION_BATCH_SIZE:
                break

    return await _delete_user_row(session_factory, user_id)


async def _delete_user_row(session_factory: async_sessionmaker[AsyncSession], user_id: uuid.UUID) -> datetime | None:
    """Delete the marked user row, returning when, or None when another pass already did"""
    async with session_factory() as db:
        gone = await db.scalar(delete(User).where(User.id == user_id, User.deletion_requested_at.is_not(None)).returning(User.id))
        await db.commit()
    return datetime.now(UTC) if gone is not None else None


async def _lock_marked_user(db: AsyncSession, user_id: uuid.UUID) -> bool:
    """Lock the user row until the caller commits, returning whether it is still there and still marked"""
    locked = await db.scalar(select(User.id).where(User.id == user_id, User.deletion_requested_at.is_not(None)).with_for_update())
    return locked is not None


@cache
def _deletion_steps() -> tuple[tuple[Table, ColumnElement[bool]], ...]:
    """Every table holding rows a user owns, children first, each with the test for the user's rows

    A row is the user's when a column names the user, or names a row of another table that is the
    user's. Tables reached only through rows the user doesn't own, such as the shared list of
    institutions, keep their rows
    """
    import_all_models()
    users = User.__table__
    owned: dict[str, ColumnElement[bool] | None] = {}

    def owned_rows(table: Table) -> ColumnElement[bool] | None:
        if table.name in owned:
            return owned[table.name]
        # Marked first, so a chain of foreign keys that comes back to this table ends here
        owned[table.name] = None
        tests = []
        for foreign_key in sorted(table.foreign_keys, key=lambda key: key.parent.name):
            target = foreign_key.column.table
            if target is users:
                tests.append(foreign_key.parent == _USER_ID)
            elif target is not table and (parent := owned_rows(target)) is not None:
                tests.append(foreign_key.parent.in_(select(foreign_key.column).where(parent)))
        owned[table.name] = or_(*tests) if tests else None
        return owned[table.name]

    steps = []
    for table in reversed(Base.metadata.sorted_tables):
        if table is users:
            continue
        test = owned_rows(table)
        if test is not None:
            steps.append((table, test))
    return tuple(steps)
