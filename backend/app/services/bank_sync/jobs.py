"""Bank sync jobs: queueing, claiming, and the fence around a job's finishing step"""

import uuid
from collections.abc import Collection, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import DateTime, case, func, literal_column, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.rls.functions import CLAIM_BANK_SYNC_JOBS, PRUNE_FINISHED_BANK_SYNC_JOBS
from app.models.bank_connection import BankAccountLink, BankLinkState
from app.models.bank_sync_job import CLAIM_RANK, BankSyncJob, BankSyncJobKind, BankSyncJobStatus
from app.services.bank_sync.providers.contract import ProviderError


async def delete_finished_bank_sync_jobs(db: AsyncSession) -> None:
    """Delete every user's jobs that finished more than 30 days ago

    Jobs are secured to their owner, so the rule lives in a SECURITY DEFINER helper that reaches
    every user's rows. The retention is written into it

    Args:
        db: Active database session
    """
    await db.execute(text(f"SELECT {PRUNE_FINISHED_BANK_SYNC_JOBS}()"))


_CLAIM_ONE = text(f"SELECT job_id, owner_id, connection_id, kind, discover, attempt FROM {CLAIM_BANK_SYNC_JOBS}(1)")  # noqa: S608


@dataclass(frozen=True)
class ClaimedJob:
    """A job as its claim handed it to a runner

    The attempt number is what the runner holds the job by: a later claim of the same job moves it
    """

    id: uuid.UUID
    owner_id: uuid.UUID
    connection_id: uuid.UUID
    kind: BankSyncJobKind
    discover: bool
    attempt: int


class JobNotHeld(Exception):
    """The runner no longer holds the job, so nothing it found may be written

    A later attempt claimed the job after this runner's lease ran out, or it already finished
    """


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
    deferred_link_ids: Collection[uuid.UUID] = (),
    requested_link_ids: Collection[uuid.UUID] = (),
) -> None:
    """Queue a sync of a connection, merging into the job already queued for it

    A connection has at most one queued job. New work for it merges in: the higher-priority kind
    wins, a request to rediscover the bank accounts is kept once either asks, a link either plans
    last stays last, a link either was asked to sync now stays asked, and the job runs at the
    earlier of the two times. A running job is left alone, so the queued one runs after it. The
    caller commits

    A time is kept as the same wait from the database's clock, and the claim compares it with that
    clock, so a database clock running ahead of the app's can't have a job claimed before the app
    counts it due. Claimed early, it would fetch every link due then and queue itself for the same
    time again

    Args:
        db: Session of the connection's owner
        owner_id: The connection's owner
        connection_id: The connection to sync
        kind: Why the sync is wanted
        discover: Whether to list the connection's bank accounts again first
        run_after: When the job may run by the app's clock, or now when not given
        deferred_link_ids: The links to sync only once no other link is due, since a job just
            failed to bring them back whole
        requested_link_ids: The links the user asked to sync now, whatever their next daily time
    """
    when = func.now()
    if run_after is not None:
        when = func.clock_timestamp(type_=DateTime(timezone=True)) + (run_after - datetime.now(UTC))
    queued = insert(BankSyncJob).values(
        owner_id=owner_id,
        connection_id=connection_id,
        kind=kind,
        discover=discover,
        status=BankSyncJobStatus.QUEUED,
        run_after=when,
        deferred_link_ids=list(deferred_link_ids),
        requested_link_ids=list(requested_link_ids),
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
                # Each link once, whichever job deferred it
                "deferred_link_ids": literal_column(
                    "ARRAY(SELECT DISTINCT unnest(bank_sync_jobs.deferred_link_ids || excluded.deferred_link_ids))"
                ),
                "requested_link_ids": literal_column(
                    "ARRAY(SELECT DISTINCT unnest(bank_sync_jobs.requested_link_ids || excluded.requested_link_ids))"
                ),
            },
        )
    )


async def claim_bank_sync_job(db: AsyncSession) -> ClaimedJob | None:
    """Claim the next due job across every user, or return None when none is due

    Runs as the worker, with no request identity, since only the claim sees across users. The
    caller commits before running the job, so no database connection is held while it runs

    Args:
        db: Session with no request identity
    """
    row = (await db.execute(_CLAIM_ONE)).one_or_none()
    if row is None:
        return None
    return ClaimedJob(
        id=row.job_id,
        owner_id=row.owner_id,
        connection_id=row.connection_id,
        kind=BankSyncJobKind(row.kind),
        discover=row.discover,
        attempt=row.attempt,
    )


async def lock_held_job(db: AsyncSession, job: ClaimedJob) -> None:
    """Start a job's finishing step by locking the job while its runner still holds it

    A job writes what it found in one transaction that this opens, and only while its runner
    still holds the job, so a runner that outlived its lease writes nothing. The job stays locked
    until the caller commits. A step that writes for links locks them with lock_covered_links next,
    after any bank accounts it writes, the order a listing takes them in

    Args:
        db: The job owner's session, in which the results are then written
        job: The job as claimed

    Raises:
        JobNotHeld: A later attempt holds the job, or it already finished
    """
    held = await db.scalar(
        select(BankSyncJob.id)
        .where(
            BankSyncJob.id == job.id,
            BankSyncJob.status == BankSyncJobStatus.RUNNING,
            BankSyncJob.attempt == job.attempt,
        )
        .with_for_update()
    )
    if held is None:
        raise JobNotHeld(f"Attempt {job.attempt} no longer holds bank sync job {job.id}")


async def lock_covered_links(db: AsyncSession, links: Sequence[BankAccountLink]) -> list[BankAccountLink]:
    """Lock and return the links a held job may still write for

    Of the links the job set out to sync, only those still active on the same bank account of the
    same connection are returned, so a link unlinked, waiting for its bank account to be chosen
    again, or moved to another bank account while the job fetched gets none of its results. The
    caller locked the job with lock_held_job in this transaction, and those links stay locked
    until it commits

    Args:
        db: The job owner's session
        links: The links the job syncs, as they stood when it started

    Returns:
        The links still covered, freshly read and locked, in id order
    """
    if not links:
        return []

    started_on = {link.id: (link.connection_id, link.external_account_id) for link in links}
    current = await db.scalars(select(BankAccountLink).where(BankAccountLink.id.in_(started_on)).order_by(BankAccountLink.id).with_for_update())
    return [
        link for link in current if link.state == BankLinkState.ACTIVE and (link.connection_id, link.external_account_id) == started_on[link.id]
    ]


async def finish_job(db: AsyncSession, job: ClaimedJob, error: ProviderError | None = None) -> None:
    """Record a job as finished, failed when given the error that stopped it

    The caller locked the job with lock_held_job in this transaction, and commits

    Args:
        db: The job owner's session
        job: The job as claimed
        error: What stopped the job, or None when it succeeded
    """
    finished = {"status": BankSyncJobStatus.SUCCEEDED, "finished_at": func.now()}
    if error is not None:
        finished |= {"status": BankSyncJobStatus.FAILED, "last_error_kind": error.kind, "last_error_reason": error.reason}
    await db.execute(update(BankSyncJob).where(BankSyncJob.id == job.id).values(finished))
