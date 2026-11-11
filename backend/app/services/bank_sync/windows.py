"""Planning the days each sync of a connection fetches, and the links it fetches them for

Each link due to sync needs data from its own start. A link importing or catching up after a gap
carries on from the day after its checkpoint, and a link already synced through the day its
checkpoint was set re-reads the provider's revisit overlap before it, to see what posted late or was
corrected, never before its import start. One request per connection fetches a window from the
earliest need among the links due, at most as long as the provider allows, for every link whose need
begins in it, so imports, routine syncs and catch-ups after any gap are one mechanism. Days are
calendar days in the user's profile timezone. When each link is next due is worked out here for the
schedule and the planner alike, so the two agree on it. A link the user asked to sync now is due at
once, whatever its next attempt, and so is every other link that has nothing holding it back, since
the request costs the same however many bank accounts it covers
"""

import uuid
from collections.abc import Collection, Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.models.bank_connection import BankAccountLink, BankLinkState
from app.services.bank_sync.retries import is_waiting_to_retry
from app.services.bank_sync.review_pause import is_paused_for_review

# A sync takes in every link due within this long, so the links on one connection converge on one
# daily request rather than each spending a request of its own
DUE_WITHIN = timedelta(hours=12)

_ONE_DAY = timedelta(days=1)


@dataclass(frozen=True)
class LinkNeed:
    """A link due to sync, and the first day it needs"""

    link: BankAccountLink
    start: date


@dataclass(frozen=True)
class SyncWindow:
    """The days one request fetches, first_day through last_day, and the links it fetches them for"""

    first_day: date
    last_day: date

    # Each link whose need begins on or before last_day
    needs: tuple[LinkNeed, ...]

    @property
    def days(self) -> int:
        """Return how many calendar days the window spans"""
        return (self.last_day - self.first_day).days + 1

    def bounds(self, timezone: ZoneInfo) -> tuple[datetime, datetime]:
        """Return the instant the window starts and the instant it ends before, each a midnight in the timezone"""
        return _midnight(self.first_day, timezone), _midnight(self.last_day + _ONE_DAY, timezone)

    def halves(self) -> tuple[SyncWindow, SyncWindow]:
        """Split a window of two days or more into its earlier and later halves, each for the links that need it

        Together the halves cover each day once, and the earlier one is the longer when the days are odd
        """
        middle = self.first_day + timedelta(days=(self.last_day - self.first_day).days // 2)
        earlier = SyncWindow(self.first_day, middle, tuple(need for need in self.needs if need.start <= middle))
        return earlier, SyncWindow(middle + _ONE_DAY, self.last_day, self.needs)


def is_stopped(link: BankAccountLink) -> bool:
    """Return whether a link's last attempt failed for good and it has no next attempt: only Sync now or a reconnect starts it again"""
    return link.last_failure_reason is not None and link.retry_count == 0 and link.next_attempt_at is None and link.signin_needed_since is None


def next_due_at(link: BankAccountLink, *, now: datetime, timezone: ZoneInfo, overlap_days: int) -> datetime | None:
    """Return when a link is next due to sync, or None while it can't sync

    A link syncs while it is active and not paused for review. One with an import running never is. It
    is due at its next attempt, or now when none is set, but never before the first day it needs has
    started in the profile timezone, since a sync can't fetch a day still to come

    Args:
        link: The link
        now: The current time
        timezone: The profile timezone, the one days are counted in
        overlap_days: Days before its checkpoint that a routine sync re-reads
    """
    if link.state != BankLinkState.ACTIVE or is_paused_for_review(link) or is_stopped(link):
        return None
    return max(link.next_attempt_at or now, _midnight(_need_start(link, timezone, overlap_days), timezone))


def find_due_links(
    links: Iterable[BankAccountLink],
    *,
    now: datetime,
    timezone: ZoneInfo,
    overlap_days: int,
    requested: Collection[uuid.UUID] = (),
) -> list[LinkNeed]:
    """Return the links to sync now, each with the first day it needs

    A link joins once next_due_at falls within the next 12 hours and the first day it needs has
    started. A link waiting to retry joins only once its retry is due, so it isn't fetched ahead of
    it with links due later today. A link the user asked to sync now joins whatever its next attempt,
    a retry's included, since a link that synced this morning would otherwise be skipped, though
    never while it can't sync. A request covers any number of bank accounts, so with a sync asked for
    every other link joins whatever its next attempt too, unless it waits to retry or on the user: a
    bank sign-in or a payment problem is fixed outside the app, and a fetch for it would only fail again

    Args:
        links: The connection's links
        now: The current time
        timezone: The profile timezone, the one days are counted in
        overlap_days: Days before its checkpoint that a routine sync re-reads
        requested: The links the user asked to sync now
    """
    today = now.astimezone(timezone).date()
    due = []
    for link in links:
        due_at = next_due_at(link, now=now, timezone=timezone, overlap_days=overlap_days)
        if due_at is None and link.id in requested and link.state == BankLinkState.ACTIVE and not is_paused_for_review(link):
            # A stopped link asked for starts again at once
            due_at = now
        if due_at is None or (link.id not in requested and due_at > _joins_until(link, now, sync_asked=bool(requested))):
            continue
        start = _need_start(link, timezone, overlap_days)
        if start <= today:
            due.append(LinkNeed(link, start))
    return due


def _joins_until(link: BankAccountLink, now: datetime, *, sync_asked: bool) -> datetime:
    """Return the latest time a link's next attempt may fall at and still join the sync

    A link that waits to retry joins only once its retry is due. While the user asked for a sync,
    any other link joins whenever it is next due, apart from one whose last attempt failed on
    something only the user can fix, which a retry never repeats
    """
    if is_waiting_to_retry(link):
        return now
    waits_on_user = link.last_failure_reason is not None
    return datetime.max.replace(tzinfo=UTC) if sync_asked and not waits_on_user else now + DUE_WITHIN


def plan_window(needs: Iterable[LinkNeed], *, today: date, timezone: ZoneInfo, max_days: int) -> SyncWindow | None:
    """Return the window to fetch next, or None when no link needs one

    The window starts at the earliest need and runs to today, or for max_days days when today is
    further off. A clock change can make that many days longer than max_days of elapsed time. The provider
    refuses that, so such a window ends a day sooner

    Args:
        needs: The links due, each with the first day it needs
        today: Today in the profile timezone
        timezone: The profile timezone
        max_days: The most days one request may span, in elapsed time

    Returns:
        The window, for every link whose need begins inside it
    """
    needs = tuple(needs)
    if not needs:
        return None
    first_day = min(need.start for need in needs)
    last_day = min(first_day + timedelta(days=max_days - 1), today)
    while _elapsed(first_day, last_day, timezone) > timedelta(days=max_days):
        last_day -= _ONE_DAY
    return SyncWindow(first_day, last_day, tuple(need for need in needs if need.start <= last_day))


def _need_start(link: BankAccountLink, timezone: ZoneInfo, overlap_days: int) -> date:
    """Return the first day a link needs, never before its import start

    The checkpoint is the last day the link's data is complete through, and its last successful sync
    is when a sync last moved it or reached today. A checkpoint short of the day that falls on, or a
    link never synced, means the link is importing or catching up, so it carries on from the first
    day it lacks. Otherwise the link re-reads the overlap before its checkpoint
    """
    if not is_caught_up(link, timezone):
        return first_missing_day(link)
    return max(link.checkpoint - timedelta(days=overlap_days), link.import_start)


def is_caught_up(link: BankAccountLink, timezone: ZoneInfo) -> bool:
    """Return whether a link's checkpoint has reached the day its last successful sync fell on, so no import or catch-up is under way"""
    return link.last_success_at is not None and link.checkpoint >= link.last_success_at.astimezone(timezone).date()


def first_missing_day(link: BankAccountLink) -> date:
    """Return the first day a link lacks: the day after its checkpoint, or its import start when that is later

    A sync moves a link's checkpoint only over days that start no later than this, so no day is skipped
    """
    return max(link.checkpoint + _ONE_DAY, link.import_start)


def _midnight(day: date, timezone: ZoneInfo) -> datetime:
    """Return the instant a day starts in the timezone"""
    return datetime.combine(day, time.min, tzinfo=timezone)


def _elapsed(first_day: date, last_day: date, timezone: ZoneInfo) -> timedelta:
    """Return the elapsed time from the start of the first day to the end of the last

    Measured in UTC, since subtracting two times in one zone ignores a clock change between them
    """
    return _midnight(last_day + _ONE_DAY, timezone).astimezone(UTC) - _midnight(first_day, timezone).astimezone(UTC)
