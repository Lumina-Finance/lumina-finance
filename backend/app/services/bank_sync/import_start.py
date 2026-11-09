"""Starting a linked account's queued import now, instead of waiting for the user's other accounts to join it

Linking an account queues its import a couple of minutes ahead, so the accounts linked in a row
share one import, as the links module describes. The user can start it at once from the account's
Bank link section or the link flow. The import is the connection's queued one, so it starts for
every account waiting on it, and the request is refused once nothing waits, such as after a worker
started it or in another window
"""

import uuid
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank_connection import BankAccountLink
from app.models.bank_sync_job import BankSyncJob, BankSyncJobKind, BankSyncJobStatus
from app.models.user import User
from app.schemas.bank_sync import BankLinkResponse
from app.services.accounts.access import get_own_personal_account
from app.services.bank_sync.account_link import describe_links
from app.services.bank_sync.availability import LINK_NOT_OWN_DETAIL, LIVE_LINK
from app.services.bank_sync.connections import get_own_connection
from app.services.bank_sync.links import ACCOUNT_NOT_LINKED
from app.services.bank_sync.status import read_link_statuses
from app.services.cache_state import mark_user_status_changed

IMPORT_NOT_WAITING = "The import has already started"


async def start_import_now(db: AsyncSession, user: User, account_id: uuid.UUID) -> BankLinkResponse:
    """Make the import queued for one of the user's linked accounts due at once

    Args:
        db: Active database session
        user: The account's owner
        account_id: The linked account

    Returns:
        The link. Its status no longer says the import waits to start

    Raises:
        HTTPException 403: The account is visible but isn't the user's own personal account
        HTTPException 404: The user can't see the account, or it isn't linked
        HTTPException 409: No import waits to start on the account
    """
    account = await get_own_personal_account(db, account_id, user.id, not_own_detail=LINK_NOT_OWN_DETAIL)
    link = await db.scalar(select(BankAccountLink).where(BankAccountLink.account_id == account.id, LIVE_LINK))
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ACCOUNT_NOT_LINKED)

    # Shared, so a disconnect waits until the import is moved and then deletes it with the connection
    connection = await get_own_connection(db, user.id, link.connection_id, lock={"read": True, "key_share": True})
    [link_status] = (await read_link_statuses(db, [link], now=datetime.now(UTC))).values()
    if link_status.sync.import_starts_at is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=IMPORT_NOT_WAITING)
    await db.execute(
        update(BankSyncJob)
        .where(
            BankSyncJob.connection_id == connection.id,
            BankSyncJob.status == BankSyncJobStatus.QUEUED,
            BankSyncJob.kind == BankSyncJobKind.INITIAL,
        )
        .values(run_after=func.now())
    )

    # The link now reads as importing with nothing waiting. That changes none of the user's data
    await mark_user_status_changed(db, user.id)
    await db.commit()
    [described] = await describe_links(db, user, [link], now=datetime.now(UTC))
    return described
