"""Queueing bank sync jobs"""

import uuid
from datetime import datetime

from sqlalchemy import case, func, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank_sync_job import CLAIM_RANK, BankSyncJob, BankSyncJobKind, BankSyncJobStatus


def _priority(kind):
    """Return a SQL expression ranking a job kind in claim order, lowest first"""
    return case(CLAIM_RANK, value=kind)


async def enqueue_bank_sync_job(
    db: AsyncSession,
    *,
    owner_id: uuid.UUID,
    connection_id: uuid.UUID,
    kind: BankSyncJobKind,
    discover: bool = False,
    run_after: datetime | None = None,
) -> None:
    """Queue a sync of a connection, merging into the job already queued for it

    A connection has at most one queued job. New work for it merges in: the higher-priority kind
    wins, a request to rediscover the bank accounts is kept once either asks, and the job runs at
    the earlier of the two times. A running job is left alone, so the queued one runs after it.
    The caller commits

    Args:
        db: Session of the connection's owner
        owner_id: The connection's owner
        connection_id: The connection to sync
        kind: Why the sync is wanted
        discover: Whether to list the connection's bank accounts again first
        run_after: When the job may run, or now when not given
    """
    queued = insert(BankSyncJob).values(
        owner_id=owner_id,
        connection_id=connection_id,
        kind=kind,
        discover=discover,
        status=BankSyncJobStatus.QUEUED,
        run_after=run_after if run_after is not None else func.now(),
    )
    await db.execute(
        queued.on_conflict_do_update(
            index_elements=[BankSyncJob.connection_id],
            # Written out rather than bound, since Postgres matches it to the partial index while planning
            index_where=text("status = 'queued'"),
            set_={
                "kind": case(
                    (_priority(queued.excluded.kind) < _priority(BankSyncJob.kind), queued.excluded.kind),
                    else_=BankSyncJob.kind,
                ),
                "discover": BankSyncJob.discover | queued.excluded.discover,
                "run_after": func.least(BankSyncJob.run_after, queued.excluded.run_after),
            },
        )
    )
