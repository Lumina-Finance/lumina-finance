"""Listing every user in batches, for code built on the app"""

import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import Uuid, bindparam, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.database import async_session
from app.db.rls.functions import LIST_USERS

# Users one call returns. One batch is a single indexed read that ends well within the statement time
# limit, matching the batches a profile deletion runs in
USER_LIST_BATCH_SIZE = 1000


@dataclass(frozen=True)
class UserSummary:
    """One listed user

    Attributes:
        user_id: The user's id
        email: The address the user signs in with and gets email at
        signed_up_at: When the user confirmed their sign-up and the account was created
        last_signed_in_at: When the user last signed in or renewed a session, or None when the app
            holds no record of it, as for a user whose every session ended before the app kept one
    """

    user_id: uuid.UUID
    email: str
    signed_up_at: datetime
    last_signed_in_at: datetime | None


async def list_users(after: uuid.UUID | None = None, session_factory: async_sessionmaker[AsyncSession] = async_session) -> list[UserSummary]:
    """Return the next batch of users in id order, leaving out users whose profile is being deleted

    A batch holds at most USER_LIST_BATCH_SIZE users. Pass the last user_id of one batch as after to get
    the next, and a batch shorter than the size, or empty, is the last

    Args:
        after: The user_id the previous batch ended with, or None for the first batch
        session_factory: Opens the session the read runs in, with no request identity

    Returns:
        The batch of users
    """
    statement = text(f"SELECT * FROM {LIST_USERS}(:after, :limit)").bindparams(bindparam("after", type_=Uuid()))  # noqa: S608
    async with session_factory() as session:
        rows = (await session.execute(statement, {"after": after, "limit": USER_LIST_BATCH_SIZE})).all()
    return [UserSummary(user_id=row.id, email=row.email, signed_up_at=row.created_at, last_signed_in_at=row.last_signed_in_at) for row in rows]
