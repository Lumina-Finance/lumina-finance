"""Bank sync settings tests

Guards the origins SimpleFIN requests may reach: an operator's own server must add to SimpleFIN
Bridge rather than replace it, which would leave every Bridge connection needing a reconnect, and an
entry that also carried credentials, a path or plain HTTP would widen what the outbound guard lets
through
"""

import pytest

from app.config.bank_sync import read_simplefin_origins, read_simplefin_test_origin

_BRIDGE_ORIGINS = ["https://beta-bridge.simplefin.org", "https://bridge.simplefin.org"]


def test_simplefin_origins_unset_allows_only_simplefin_bridge(monkeypatch):
    """A deployment that adds nothing reaches only SimpleFIN Bridge's two servers"""
    monkeypatch.delenv("BANK_SYNC_SIMPLEFIN_ORIGINS", raising=False)

    assert read_simplefin_origins() == _BRIDGE_ORIGINS


def test_simplefin_origins_added_keep_simplefin_bridge(monkeypatch):
    """An operator's own servers, with or without a port, are allowed beside SimpleFIN Bridge"""
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


def test_simplefin_test_origin_unset_is_none(monkeypatch):
    """The testing-only exemption exists only while it is set"""
    monkeypatch.delenv("BANK_SYNC_SIMPLEFIN_TEST_ORIGIN", raising=False)

    assert read_simplefin_test_origin() is None


def test_simplefin_test_origin_may_use_plain_http(monkeypatch):
    """The fake SimpleFIN Bridge in development and CI is served over plain HTTP"""
    monkeypatch.setenv("BANK_SYNC_SIMPLEFIN_TEST_ORIGIN", "http://fake-bridge:8080")

    assert read_simplefin_test_origin() == "http://fake-bridge:8080"
