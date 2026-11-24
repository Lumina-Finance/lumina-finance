"""Asking to delete a profile: the user is marked, signed out everywhere and their bank access given back

The data goes after the answer, in removal, since years of history can take longer to delete than a
request may run
"""

from datetime import UTC, datetime

from fastapi import BackgroundTasks
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

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

    The caller authorizes the request first. The mark, the end of every session and every bank
    connection, and the end of any emailed link that could still change the account commit together,
    so from then on nothing can sign in as the user or sync for them. Each connection's credential is
    then given back to its provider, best effort

    Args:
        db: Active database session, acting as the user
        user: The user whose profile goes
        background_tasks: Runs the deletion once the response is out
        session_factory: Opens the sessions the deletion runs in
    """
    user.deletion_requested_at = datetime.now(UTC)
    await delete_all_user_auth_sessions(db, user.id)
    await db.execute(delete(PasswordResetToken).where(PasswordResetToken.user_id == user.id))
    await db.execute(delete(EmailChangeRequest).where(EmailChangeRequest.user_id == user.id))
    credentials = await disconnect_every_connection(db, user.id)
    await db.commit()

    await release_stored_credentials(credentials)
    background_tasks.add_task(delete_profile, session_factory, user.id)
