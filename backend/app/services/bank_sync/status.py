"""A live link's sync status: the one state every surface shows, worked out here so they all agree

The first state that applies wins: what only the user can fix, an import, the review pause, a sync,
the review warning, a retry, and otherwise synced. An import outranks
the pause, since an import always runs to today whatever the backlog. The pause and the warning are
the review block's own, so the block and the status never disagree. A sync shows only while a worker
runs it, so a Sync now still queued leaves the state as it was and marks the sync requested
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank_connection import BankAccountLink, BankConnection, BankImportKind, BankLinkState
from app.models.bank_sync_job import BankSyncJob, BankSyncJobKind, BankSyncJobStatus
from app.schemas.bank_sync import BankImportState, BankSyncFailureResponse, BankSyncState, BankSyncStatusResponse
from app.services.bank_sync.action_needed import ActionNeededKind, read_actions_needed
from app.services.bank_sync.provider_requests import RequestBudget, read_request_budgets
from app.services.bank_sync.retries import is_waiting_to_retry
from app.services.bank_sync.review_pause import ReviewBacklog, read_review_backlogs

_ACTION_STATES: dict[ActionNeededKind, BankSyncState] = {
    ActionNeededKind.RECONNECT: "reconnect_needed",
    ActionNeededKind.BANK_LOGIN: "bank_signin_needed",
}


@dataclass(frozen=True)
class LinkStatus:
    """A live link's sync status, and where its import stands while it shows one"""

    sync: BankSyncStatusResponse

    # None while the link shows no import's progress
    import_state: BankImportState | None


def shows_import_progress(link: BankAccountLink) -> bool:
    """Return whether a live link shows its import's progress

    A link waiting for its bank account to be chosen again doesn't sync, and the catch-up after a
    reconnect doesn't record its first day, so neither has progress to show
    """
    return link.importing and link.state == BankLinkState.ACTIVE and link.import_kind != BankImportKind.RECONNECT


async def read_link_statuses(db: AsyncSession, links: Sequence[BankAccountLink], *, now: datetime) -> dict[uuid.UUID, LinkStatus]:
    """Return each live link's sync status, reading what the links need together

    Args:
        db: The owner's session
        links: Live links, each with its connection
        now: The current time that the request budgets are read at

    Returns:
        Each link's status, by link id
    """
    if not links:
        return {}
    connections = list(await db.scalars(select(BankConnection).where(BankConnection.id.in_({link.connection_id for link in links}))))
    budgets = await read_request_budgets(db, connections, now=now)
    syncing, requested = await _read_job_links(db, now=now)
    import_starts = await _read_import_starts(db, {link.connection_id for link in links})
    account_ids = [link.account_id for link in links]
    needed = await read_actions_needed(db, account_ids)
    backlogs = await read_review_backlogs(db, account_ids, actions_needed=needed)

    statuses = {}
    for link in links:
        budget = budgets[link.connection_id]
        action = needed.get(link.account_id)
        import_state = _read_import_state(link, action, budget, syncing=link.id in syncing) if shows_import_progress(link) else None
        state = _choose_state(link, action, import_state, backlogs[link.account_id], syncing=link.id in syncing)
        sync = _describe_sync(
            link,
            state,
            budget,
            backlogs[link.account_id],
            running=link.id in syncing,
            requested=link.id in requested,
            import_starts_at=import_starts.get(link.connection_id) if import_state == "running" and link.id not in syncing else None,
        )
        statuses[link.id] = LinkStatus(sync=sync, import_state=import_state)
    return statuses


def _read_import_state(link: BankAccountLink, action: ActionNeededKind | None, budget: RequestBudget, *, syncing: bool) -> BankImportState:
    """Return whether a link's import is fetching its next part or can now, or what holds it back

    A sync fetching it, a retry included, runs it. Otherwise a failed attempt waiting to retry and
    anything only the user can fix each hold it until something changes, and a spent budget until a
    request frees up
    """
    if syncing:
        return "running"
    if is_waiting_to_retry(link) or action is not None:
        return "waiting"
    return "running" if budget.available_again_at is None else "waiting_on_budget"


def _choose_state(
    link: BankAccountLink,
    action: ActionNeededKind | None,
    import_state: BankImportState | None,
    backlog: ReviewBacklog,
    *,
    syncing: bool,
) -> BankSyncState:
    """Return the first state that applies to a live link

    An import held by a retry shows the retry. The retry says when the import goes on
    """
    if action is not None:
        return _ACTION_STATES[action]
    if link.state == BankLinkState.CHOOSE_ACCOUNT:
        return "choose_account"
    if import_state == "running":
        return "importing"
    if import_state == "waiting_on_budget":
        return "import_waiting_on_budget"
    if backlog.paused:
        return "paused"
    if syncing:
        return "syncing"
    if backlog.warning:
        return "review_warning"
    if is_waiting_to_retry(link):
        return "retrying"
    return "synced"


def _describe_sync(
    link: BankAccountLink,
    state: BankSyncState,
    budget: RequestBudget,
    backlog: ReviewBacklog,
    *,
    running: bool,
    requested: bool,
    import_starts_at: datetime | None,
) -> BankSyncStatusResponse:
    """Return a link's state with the facts its Sync details and notices word"""
    available_again_at = budget.available_again_at
    next_attempt_at = available_again_at if state == "import_waiting_on_budget" else link.next_attempt_at
    return BankSyncStatusResponse(
        state=state,
        last_success_at=link.last_success_at,
        last_failure=None
        if link.last_failure_reason is None
        else BankSyncFailureResponse(at=link.last_attempt_at, reason=link.last_failure_reason),
        next_attempt_at=next_attempt_at,
        waiting_on_budget=available_again_at is not None and link.next_attempt_at is not None and link.next_attempt_at < available_again_at,
        held_by_provider=budget.held_by_provider,
        sync_running=running,
        sync_requested=requested,
        import_starts_at=import_starts_at,
        waiting_new_count=backlog.waiting_new,
        paused=backlog.paused,
        review_warning=backlog.warning,
    )


async def _read_import_starts(db: AsyncSession, connection_ids: set[uuid.UUID]) -> dict[uuid.UUID, datetime]:
    """Return when each connection's queued import starts, for those still to start later

    An import is queued ahead for the user's other accounts to join it, and the job keeps its kind
    when it waits for the request budget or a retry instead. The caller leaves those out by the
    link's import state. Read by the database's clock, as the claim reads it
    """
    rows = await db.execute(
        select(BankSyncJob.connection_id, BankSyncJob.run_after).where(
            BankSyncJob.connection_id.in_(connection_ids),
            BankSyncJob.status == BankSyncJobStatus.QUEUED,
            BankSyncJob.kind == BankSyncJobKind.INITIAL,
            BankSyncJob.run_after > func.now(),
        )
    )
    return {connection_id: run_after for connection_id, run_after in rows}


async def _read_job_links(db: AsyncSession, *, now: datetime) -> tuple[set[uuid.UUID], set[uuid.UUID]]:
    """Return the links the owner's running jobs are syncing, and those a queued job is to sync now as the user asked

    A job records the links it covers once it has planned its window, so a job still listing the
    bank accounts covers none yet, apart from those the user asked it to sync. It syncs those from
    the start. A job whose lease has run out was left by a worker that stopped, so it syncs nothing
    until a worker claims it again. A queued job syncs nothing yet, so a link the user asked to sync
    keeps its state until a worker starts the job. One waiting for the request budget to free a
    request isn't due, and its links read as not asked for until it is, so they show the budget
    holding them back rather than a sync about to start
    """
    rows = await db.execute(
        select(BankSyncJob.status, BankSyncJob.covered_link_ids, BankSyncJob.requested_link_ids).where(
            or_(
                and_(BankSyncJob.status == BankSyncJobStatus.RUNNING, BankSyncJob.lease_expires_at > now),
                # Due by the database's clock. The claim reads it by that clock
                and_(BankSyncJob.status == BankSyncJobStatus.QUEUED, BankSyncJob.run_after <= func.now()),
            )
        )
    )
    syncing: set[uuid.UUID] = set()
    requested: set[uuid.UUID] = set()
    for status, covered, asked in rows:
        if status == BankSyncJobStatus.QUEUED:
            requested.update(asked)
        else:
            syncing.update(covered or (), asked)
    return syncing, requested
