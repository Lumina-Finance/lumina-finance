"""A link's date range import: starting it, the window it fetches next, and ending it

The user asks for a date range at linking, or later from the account's Bank link section. A sync
fetches it once its routine windows are done, one window of at most the provider's longest fetch a
job, from the range's next day through its last. The next day moves on only over a window that
started on it, so no day is skipped and a window fetched for a range since ended or replaced stores
nothing. The range ends once its last day is stored. Days that fell behind the provider's history
limit by the time their window runs are left out, and the link says so. While a range runs its link
counts as importing, so the review pause and the balance match wait for it to end
"""

from dataclasses import dataclass
from datetime import date
from zoneinfo import ZoneInfo

from app.models.bank_connection import BankAccountLink
from app.schemas.bank_sync import BankRangeImportResponse
from app.services.bank_sync.windows import LinkNeed, SyncWindow, plan_window
from app.utils.dates import format_day

# Why a range's earliest days weren't fetched, as the Bank link section says it
_LEFT_OUT = "Transactions before {day} weren't imported: {provider} reaches back {months} months"

# Why a range stopped when the provider refused even a short window of it
_REFUSED = "The date range import stopped: {provider} refused the dates asked for"


@dataclass(frozen=True)
class RangeImport:
    """A link's date range import as it stood when read"""

    first_day: date
    last_day: date
    next_day: date
    restores_dismissed: bool

    def same_request(self, other: RangeImport | None) -> bool:
        """Return whether another reading is still the same request, whatever days it has stored since"""
        return other is not None and (other.first_day, other.last_day, other.restores_dismissed) == (
            self.first_day,
            self.last_day,
            self.restores_dismissed,
        )


def read_range(link: BankAccountLink) -> RangeImport | None:
    """Return the link's date range import, or None while none runs"""
    if link.range_next_day is None:
        return None
    return RangeImport(link.range_first_day, link.range_last_day, link.range_next_day, link.range_restores_dismissed)


def describe_range(link: BankAccountLink) -> BankRangeImportResponse | None:
    """Return the link's date range import as the app shows it, or None while none runs"""
    running = read_range(link)
    if running is None:
        return None
    return BankRangeImportResponse(
        first_day=running.first_day,
        last_day=running.last_day,
        next_day=running.next_day,
        restores_dismissed=running.restores_dismissed,
    )


def brings_in(link: BankAccountLink, day: date, running: RangeImport | None) -> bool:
    """Return whether a delivery brings in a new record dated on a day

    A routine window brings in what is dated from the link's import start on, and a range's window
    only what is dated inside the range, so the days between a range and the import start stay as
    the ledger has them
    """
    if running is None:
        return day >= link.import_start
    return running.first_day <= day <= running.last_day


def start_range(link: BankAccountLink, first_day: date, last_day: date, *, restores_dismissed: bool) -> None:
    """Set a locked link importing a date range from its first day, forgetting how the last one ended"""
    link.range_first_day = first_day
    link.range_last_day = last_day
    link.range_next_day = first_day
    link.range_restores_dismissed = restores_dismissed
    link.range_outcome = None
    link.importing = True


def end_range(link: BankAccountLink) -> None:
    """Clear a locked link's date range import, keeping what the link says about how it ended"""
    link.range_first_day = None
    link.range_last_day = None
    link.range_next_day = None
    link.range_restores_dismissed = None


def forget_range(link: BankAccountLink) -> None:
    """Clear a locked link's date range import and how the last one ended, for a link ending or starting over"""
    end_range(link)
    link.range_outcome = None


def refuse_range(link: BankAccountLink, provider_name: str) -> None:
    """End a locked link's date range import that the provider refused, saying so"""
    end_range(link)
    link.range_outcome = _REFUSED.format(provider=provider_name)


def range_start(running: RangeImport, provider_limit: date) -> date:
    """Return the day a range's next window starts: its next day, or the provider's limit once the next day falls behind it"""
    return max(running.next_day, provider_limit)


def plan_range_window(
    link: BankAccountLink,
    running: RangeImport,
    *,
    provider_limit: date,
    timezone: ZoneInfo,
    max_days: int,
) -> SyncWindow | None:
    """Return the window a link's date range import fetches next, or None when every day left fell behind the provider's limit

    Args:
        link: The link
        running: Its range, as read with it
        provider_limit: The first day the provider's history reaches today
        timezone: The profile timezone
        max_days: The most days one request may span, in elapsed time
    """
    start = range_start(running, provider_limit)
    if start > running.last_day:
        return None
    return plan_window([LinkNeed(link, start)], today=running.last_day, timezone=timezone, max_days=max_days)


def note_left_out(link: BankAccountLink, running: RangeImport, *, provider_limit: date, provider_name: str, history_months: int) -> None:
    """Say on a locked link that its range's days before the provider's limit weren't fetched, when some were"""
    if running.next_day < provider_limit:
        link.range_outcome = _LEFT_OUT.format(day=format_day(provider_limit), provider=provider_name, months=history_months)
