"""Bank sync settings tests

Guards the origins SimpleFIN requests may reach: an entry that also carried credentials, a path or
plain HTTP would widen what the outbound guard lets through
"""

import pytest

from app.config.bank_sync import _read_origin


@pytest.mark.parametrize("origin", ["https://bridge.simplefin.org", "https://simplefin.example:8443", "https://simplefin.example/"])
def test_origin_entry_with_a_scheme_host_and_port_is_accepted(origin):
    """An operator's own HTTPS server is accepted as written, with or without a port"""
    assert _read_origin("BANK_SYNC_SIMPLEFIN_ORIGINS", origin, schemes=("https",)) == origin


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
def test_origin_entry_with_anything_beyond_an_origin_is_refused_at_start(origin):
    """The app refuses to start rather than guessing which part of the entry was meant"""
    with pytest.raises(RuntimeError, match="Invalid BANK_SYNC_SIMPLEFIN_ORIGINS entry"):
        _read_origin("BANK_SYNC_SIMPLEFIN_ORIGINS", origin, schemes=("https",))


def test_testing_only_origin_may_use_plain_http():
    """The fake SimpleFIN Bridge in development and CI is served over plain HTTP"""
    origin = "http://fake-bridge:8080"

    assert _read_origin("BANK_SYNC_SIMPLEFIN_TEST_ORIGIN", origin, schemes=("http", "https")) == origin
