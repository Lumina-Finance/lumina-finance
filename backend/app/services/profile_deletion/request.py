"""Starting a profile deletion: the user is marked, signed out everywhere and their bank access given back

The data goes afterwards, in removal, since years of history can take longer to delete than a
request may run. A person's own request and code built on the app start a deletion the same way
"""

import uuid
from datetime import UTC, datetime

from fastapi import BackgroundTasks
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.database import acting_as, async_session
from app.models.auth import EmailChangeRequest, PasswordResetToken
from app.models.user import User
from app.services.auth.sessions import delete_all_user_auth_sessions
from app.services.bank_sync.links import disconnect_every_connection
from app.services.bank_sync.release import release_stored_credentials
from app.services.profile_deletion.removal import delete_profile


async def request_profile_deletion(
    db: AsyncSession,
    user: User,
    background_tasks: BackgroundTasks,
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    """Mark a user's profile for deletion as one unit of work, then delete it once the answer is out

    The caller authorizes the request first

    Args:
        db: Active database session, acting as the user
        user: The user whose profile goes
        background_tasks: Runs the deletion once the response is out
        session_factory: Opens the sessions the deletion runs in
    """
    credentials = await _mark_for_deletion(db, user)
    await db.commit()

    await release_stored_credentials(credentials)
    background_tasks.add_task(delete_profile, session_factory, user.id)


async def delete_user(user_id: uuid.UUID, session_factory: async_sessionmaker[AsyncSession] = async_session) -> bool:
    """Delete a user and everything they hold, the way a person's own Delete profile does, and wait for it

    Observers registered with observe_profile_deletions hear of it as they do of any deletion. A user
    whose deletion is already under way is deleted the same way, and an id with no user is left as it is

    Args:
        user_id: The user to delete
        session_factory: Opens the sessions the deletion runs in, with no request identity

    Returns:
        Whether no user with this id remains. False means a step failed after the user was marked, so
        they can no longer sign in and the next cleanup pass finishes the deletion
    """
    with acting_as(user_id):
        async with session_factory() as db:
            user = await db.get(User, user_id)
            if user is None:
                return True
            credentials = await _mark_for_deletion(db, user)
            await db.commit()
        await release_stored_credentials(credentials)

        await delete_profile(session_factory, user_id)
        async with session_factory() as db:
            return await db.get(User, user_id) is None


async def _mark_for_deletion(db: AsyncSession, user: User) -> list[tuple[str, str]]:
    """Mark the user and end everything that could still act for them, returning the credentials to give back

    The mark, the end of every session and every bank connection, and the end of any emailed link that
    could still change the account commit together in the caller's unit of work, so from then on nothing
    can sign in as the user or sync for them. Each credential returned goes back to its provider after
    the commit, best effort
    """
    user.deletion_requested_at = datetime.now(UTC)
    await delete_all_user_auth_sessions(db, user.id)
    await db.execute(delete(PasswordResetToken).where(PasswordResetToken.user_id == user.id))
    await db.execute(delete(EmailChangeRequest).where(EmailChangeRequest.user_id == user.id))
    return await disconnect_every_connection(db, user.id)
