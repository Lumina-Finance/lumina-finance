"""SimpleFIN settings tests

Guards the origins SimpleFIN requests may reach: a server set in the environment must add to
SimpleFIN Bridge rather than replace it, or every Bridge connection would need reconnecting, and an
entry carrying credentials, a path or plain HTTP would widen what the outbound guard lets through.
Also guards the daily request cap SimpleFIN Bridge expects to be kept
"""

import importlib

import pytest

from app.config.bank_sync import read_test_origin_setting
from app.services.bank_sync.providers.simplefin import config as simplefin_config
from app.services.bank_sync.providers.simplefin.config import read_simplefin_origins

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

    assert read_test_origin_setting(simplefin_config.TEST_ORIGIN_KEY) == "http://fake-bridge:8080"


def test_the_daily_request_cap_simplefin_reads_is_refused_over_24(monkeypatch):
    """SimpleFIN Bridge can disable a token past 24 requests a day, so 25 stops the app starting and 24 is kept"""
    key = "BANK_SYNC_SIMPLEFIN_DAILY_REQUESTS"
    try:
        monkeypatch.setenv(key, "25")
        with pytest.raises(RuntimeError, match=f"Invalid {key}"):
            importlib.reload(simplefin_config)
        monkeypatch.setenv(key, "24")
        assert importlib.reload(simplefin_config).SIMPLEFIN_DAILY_REQUESTS == 24
    finally:
        monkeypatch.delenv(key, raising=False)
        importlib.reload(simplefin_config)
