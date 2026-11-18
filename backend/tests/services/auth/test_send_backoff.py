"""Send back-off tests: when a quiet key starts over, and a flood of failing keys cannot grow memory without end"""

import pytest

from app.services.auth import send_backoff
from app.services.auth.send_backoff import SendBackoff


@pytest.mark.parametrize(
    ("quiet_seconds", "wait"),
    [(240 + 3599, 480), (240 + 3600, 60)],
    ids=["a second short of a quiet longest wait keeps doubling", "a full quiet longest wait starts over"],
)
def test_a_key_starts_over_only_after_a_full_longest_wait_of_quiet(monkeypatch, quiet_seconds, wait):
    """Three failures leave a four-minute wait, and the next failure doubles it unless a full longest wait has passed since"""
    now = [1000.0]
    monkeypatch.setattr(send_backoff, "monotonic", lambda: now[0])
    backoff = SendBackoff()
    for _ in range(3):
        backoff.record_failed("a")

    now[0] += quiet_seconds
    backoff.record_failed("a")

    now[0] += wait - 1
    assert backoff.is_waiting("a"), "still waiting a second before the wait ends"
    now[0] += 1
    assert not backoff.is_waiting("a"), "free once the wait ends"


def test_the_key_with_the_oldest_failure_is_dropped_when_too_many_are_remembered(monkeypatch):
    """A key failing again counts as newest, so the key quiet the longest is the one forgotten"""
    monkeypatch.setattr(send_backoff, "MAX_REMEMBERED_KEYS", 2)
    monkeypatch.setattr(send_backoff, "monotonic", lambda: 1000.0)
    backoff = SendBackoff()

    for key in ["a", "b", "a", "c"]:
        backoff.record_failed(key)

    assert not backoff.is_waiting("b"), "the oldest failure is dropped"
    assert backoff.is_waiting("a"), "a key that failed again stays"
    assert backoff.is_waiting("c"), "the newest failure stays"
