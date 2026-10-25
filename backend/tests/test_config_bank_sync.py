"""Bank sync settings tests

Guards the origins SimpleFIN requests may reach: a server set in the environment must add to
SimpleFIN Bridge rather than replace it, which would leave every Bridge connection needing a
reconnect, and an entry that also carried credentials, a path or plain HTTP would widen what the
outbound guard lets through. Also guards the counts the environment sets, such as the daily request
cap and how many jobs the worker runs at once, which share one reader
"""

import importlib

import pytest

from app.config import bank_sync as bank_sync_config
from app.config.bank_sync import read_count_setting, read_simplefin_origins, read_simplefin_test_origin

_BRIDGE_ORIGINS = ["https://beta-bridge.simplefin.org", "https://bridge.simplefin.org"]


def test_simplefin_origins_unset_allows_only_simplefin_bridge(monkeypatch):
    """A deployment that adds nothing reaches only SimpleFIN Bridge's two servers"""
    monkeypatch.delenv("BANK_SYNC_SIMPLEFIN_ORIGINS", raising=False)

    assert read_simplefin_origins() == _BRIDGE_ORIGINS


def test_simplefin_origins_added_keep_simplefin_bridge(monkeypatch):
    """Servers set in the environment, with or without a port, are allowed beside SimpleFIN Bridge"""
    monkeypatch.setenv("BANK_SYNC_SIMPLEFIN_ORIGINS", "https://simplefin.example:8443, https://sfin.example/")

    assert read_simplefin_origins() == [*_BRIDGE_ORIGINS, "https://simplefin.example:8443", "https://sfin.example/"]


@pytest.mark.parametrize(
    "origin",
    [
        "http://simplefin.example",
        "https://user:secret@simplefin.example",
        "https://simplefin.example/simplefin",
        "https://simplefin.example?next=internal",
        "https://simplefin.example#accounts",
        "https://",
    ],
    ids=["plain-http", "user-info", "path", "query", "fragment", "no-host"],
)
def test_simplefin_origins_entry_beyond_an_origin_is_refused_at_start(monkeypatch, origin):
    """The app refuses to start rather than guessing which part of the entry was meant"""
    monkeypatch.setenv("BANK_SYNC_SIMPLEFIN_ORIGINS", origin)

    with pytest.raises(RuntimeError, match="Invalid BANK_SYNC_SIMPLEFIN_ORIGINS entry"):
        read_simplefin_origins()


def test_simplefin_test_origin_may_use_plain_http(monkeypatch):
    """The fake SimpleFIN Bridge in development and CI is served over plain HTTP"""
    monkeypatch.setenv("BANK_SYNC_SIMPLEFIN_TEST_ORIGIN", "http://fake-bridge:8080")

    assert read_simplefin_test_origin() == "http://fake-bridge:8080"


def test_count_setting_reads_a_whole_number(monkeypatch):
    """The environment may lower the daily request cap"""
    monkeypatch.setenv("BANK_SYNC_SIMPLEFIN_DAILY_REQUESTS", "12")

    assert read_count_setting("BANK_SYNC_SIMPLEFIN_DAILY_REQUESTS", 20) == 12


@pytest.mark.parametrize("value", ["0", "-3", "1.5", "twelve"])
def test_count_setting_below_one_or_not_whole_is_refused_at_start(monkeypatch, value):
    """A cap of 0 would stop every request for good, or a worker run no jobs, so the app or worker refuses to start"""
    monkeypatch.setenv("BANK_SYNC_SIMPLEFIN_DAILY_REQUESTS", value)

    with pytest.raises(RuntimeError, match="Invalid BANK_SYNC_SIMPLEFIN_DAILY_REQUESTS"):
        read_count_setting("BANK_SYNC_SIMPLEFIN_DAILY_REQUESTS", 20)


def test_count_setting_above_its_maximum_is_refused_at_start(monkeypatch):
    """SimpleFIN Bridge expects 24 requests a day at most and can disable a token past it, so a higher cap stops the app or worker starting"""
    monkeypatch.setenv("BANK_SYNC_SIMPLEFIN_DAILY_REQUESTS", "25")

    with pytest.raises(RuntimeError, match="Invalid BANK_SYNC_SIMPLEFIN_DAILY_REQUESTS"):
        read_count_setting("BANK_SYNC_SIMPLEFIN_DAILY_REQUESTS", 20, maximum=24)

    monkeypatch.setenv("BANK_SYNC_SIMPLEFIN_DAILY_REQUESTS", "24")
    assert read_count_setting("BANK_SYNC_SIMPLEFIN_DAILY_REQUESTS", 20, maximum=24) == 24


def test_the_daily_request_cap_the_app_reads_is_refused_over_24(monkeypatch):
    """The cap the sync actually uses is read from the environment with that maximum, so 25 stops the app starting and 24 is kept"""
    key = "BANK_SYNC_SIMPLEFIN_DAILY_REQUESTS"
    try:
        monkeypatch.setenv(key, "25")
        with pytest.raises(RuntimeError, match=f"Invalid {key}"):
            importlib.reload(bank_sync_config)
        monkeypatch.setenv(key, "24")
        assert importlib.reload(bank_sync_config).BANK_SYNC_SIMPLEFIN_DAILY_REQUESTS == 24
    finally:
        monkeypatch.delenv(key, raising=False)
        importlib.reload(bank_sync_config)
