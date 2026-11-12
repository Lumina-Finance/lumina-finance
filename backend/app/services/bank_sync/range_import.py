"""Importing a date range into a linked account, as the user asks from its Bank link section

Once the link's own import has ended, the user can import any days the provider's history reaches,
through today. The range is fetched after the connection's routine sync, as the range_days module
describes. Everything it brings in waits for review, and a bank transaction already brought in,
waiting or in the ledger, is never brought in again. Items dismissed before come back only when the
user asks, and only those dated inside the range. The request queues a sync of the connection
without asking for the link's own routine sync, so the range's first request isn't spent re-reading
days the link already has, and an import waiting for the user's other accounts keeps its start. It is
refused while a range already runs, and for every reason Sync now is, the request budget included,
since each of its windows counts as a request
"""

import uuid
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank_sync_job import BankSyncJobKind
from app.models.user import User
from app.schemas.bank_sync import BankLinkResponse, ImportBankRangeRequest
from app.services.bank_sync.account_link import describe_links
from app.services.bank_sync.availability import adapter_for
from app.services.bank_sync.connections import get_own_connection
from app.services.bank_sync.import_range import calculate_import_range, check_import_days
from app.services.bank_sync.jobs import enqueue_bank_sync_job
from app.services.bank_sync.links import lock_live_link
from app.services.bank_sync.range_days import start_range
from app.services.bank_sync.status import read_link_statuses
from app.services.bank_sync.sync_now import refuse_held_back_sync
from app.services.cache_state import mark_user_status_changed
from app.utils.dates import resolve_timezone

# Why a range can't start while another runs on the account
RANGE_RUNNING = "A date range import is already in progress"


async def import_bank_range(db: AsyncSession, user: User, account_id: uuid.UUID, request: ImportBankRangeRequest) -> BankLinkResponse:
    """Start importing a date range into one of the user's linked accounts, and queue its connection's sync

    Args:
        db: Active database session
        user: The account's owner
        account_id: The linked account
        request: The range's first and last days, and whether items dismissed before come back

    Returns:
        The link, importing the range

    Raises:
        HTTPException 403: The account is visible but isn't the user's own personal account
        HTTPException 404: The user can't see the account, or it isn't linked
        HTTPException 409: A range, an import or a sync already runs on the account, the provider
            rejected its connection or is no longer installed, its bank account has to be chosen
            again, or the review pause holds it
        HTTPException 422: A day is outside what the provider reaches through today, or the first
            is after the last
        HTTPException 429: The connection's request budget is spent, saying when a request frees up
    """
    _, link = await lock_live_link(db, user, account_id)
    if link.range_next_day is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=RANGE_RUNNING)

    # Locking the links held the connection too, so a disconnect waits until the sync is queued and
    # then deletes it
    connection = await get_own_connection(db, user.id, link.connection_id)
    now = datetime.now(UTC)
    [link_status] = (await read_link_statuses(db, [link], now=now)).values()
    await refuse_held_back_sync(db, connection, link_status.sync, now=now)

    # The refusal above leaves only a provider still installed
    adapter = adapter_for(connection.provider)
    today = now.astimezone(resolve_timezone(user.tz)).date()
    import_range = calculate_import_range(today=today, latest_ledger_date=None, history_months=adapter.history_limit_months)
    check_import_days(import_range, request.first_day, request.last_day)

    start_range(link, request.first_day, request.last_day, restores_dismissed=request.restores_dismissed)
    await enqueue_bank_sync_job(
        db,
        owner_id=user.id,
        connection_id=connection.id,
        kind=BankSyncJobKind.MANUAL,
        moves_queued_import_later=True,
    )

    # The link now reads as importing. That changes none of the user's data, so the data mark an
    # import's undo compares with stays where it was
    await mark_user_status_changed(db, user.id)
    await db.commit()
    [described] = await describe_links(db, user, [link], now=datetime.now(UTC))
    return described
