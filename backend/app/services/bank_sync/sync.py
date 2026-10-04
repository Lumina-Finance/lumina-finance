"""Running one claimed bank sync job"""

from app.database import async_session
from app.services.bank_sync.jobs import ClaimedJob, finish_job, lock_job_for_finish


async def run_sync_job(job: ClaimedJob) -> None:
    """Run a claimed job as its owner and record it as finished

    The worker has already set the owner's identity, so every session opened here works under
    row-level security as that user. A job holds no database connection while it waits on a
    provider, and writes what it found in one finishing transaction that lock_job_for_finish
    fences. The job covers no links and calls no provider, so it finishes as soon as it runs

    Args:
        job: The job as claimed

    Raises:
        JobNotHeld: A later attempt holds the job, so nothing was written
    """
    async with async_session() as db:
        await lock_job_for_finish(db, job, links=())
        await finish_job(db, job)
        await db.commit()
