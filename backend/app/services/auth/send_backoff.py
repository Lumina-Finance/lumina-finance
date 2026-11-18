"""How long a key waits before another email may be started after its send failed"""

from collections.abc import Hashable
from dataclasses import dataclass
from time import monotonic  # By name, so a test can drive this clock

# After the first failed send a key waits this long, then twice as long after each further
# failure, and starts again from this after a send works
FIRST_FAILURE_WAIT_SECONDS = 60.0

# Longest a key waits, so a user retrying through a long outage never waits more than this once
# mail returns
MAX_FAILURE_WAIT_SECONDS = 3600.0

# Keys remembered at once. Callers can choose their keys, such as an address typed into a form, so
# without a ceiling a flood of failing keys would grow memory without end
MAX_REMEMBERED_KEYS = 10_000


@dataclass(frozen=True)
class _Backoff:
    """What failed sends have cost a key"""

    failures: int
    next_allowed: float


class SendBackoff:
    """Waits that grow with each failed send to one key and clear when a send works

    Lives in this process because the server runs as a single one, and a restart only forgets the
    waits
    """

    def __init__(self) -> None:
        """Start with no key waiting"""
        # Kept in order of each key's latest failure, so the first entry is the one to drop
        self._entries: dict[Hashable, _Backoff] = {}

    def is_waiting(self, key: Hashable) -> bool:
        """Whether the key's wait after its latest failure has not ended"""
        entry = self._entries.get(key)
        return entry is not None and monotonic() < entry.next_allowed

    def record_failed(self, key: Hashable) -> None:
        """Make the key wait twice as long as after its previous failure, up to the longest wait

        A key quiet for a full longest wait after its wait ended starts again from one failure, since
        the outage that earned the long wait is likely over
        """
        now = monotonic()
        previous = self._entries.pop(key, None)
        is_stale = previous is not None and previous.next_allowed + MAX_FAILURE_WAIT_SECONDS <= now
        failures = 1 if previous is None or is_stale else previous.failures + 1
        wait = min(FIRST_FAILURE_WAIT_SECONDS * 2 ** (failures - 1), MAX_FAILURE_WAIT_SECONDS)
        self._entries[key] = _Backoff(failures=failures, next_allowed=now + wait)
        if len(self._entries) > MAX_REMEMBERED_KEYS:
            del self._entries[next(iter(self._entries))]

    def record_succeeded(self, key: Hashable) -> None:
        """Forget the key's failures"""
        self._entries.pop(key, None)
