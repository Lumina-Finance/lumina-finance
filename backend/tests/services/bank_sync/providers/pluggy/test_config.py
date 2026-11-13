"""Pluggy settings tests

Guards the testing-only origin, so it accepts plain HTTP for the fake Pluggy and refuses anything
beyond an origin, and the daily operation count, so a mistyped setting can't turn it into zero
"""

import importlib

import pytest

from app.config.bank_sync import read_test_origin_setting
from app.services.bank_sync.providers.pluggy import config as pluggy_config


def test_pluggy_test_origin_may_use_plain_http(monkeypatch):
    """The fake Pluggy in development and CI is served over plain HTTP"""
    monkeypatch.setenv("BANK_SYNC_PLUGGY_TEST_ORIGIN", "http://fake-pluggy:8793")

    assert read_test_origin_setting(pluggy_config.TEST_ORIGIN_KEY) == "http://fake-pluggy:8793"


@pytest.mark.parametrize("origin", ["http://pluggy.example/auth", "http://user:secret@pluggy.example", "ftp://pluggy.example"])
def test_pluggy_test_origin_beyond_an_origin_is_refused_at_start(monkeypatch, origin):
    """The app refuses to start rather than guessing which part of the entry was meant"""
    monkeypatch.setenv("BANK_SYNC_PLUGGY_TEST_ORIGIN", origin)

    with pytest.raises(RuntimeError, match="Invalid BANK_SYNC_PLUGGY_TEST_ORIGIN"):
        read_test_origin_setting(pluggy_config.TEST_ORIGIN_KEY)


def test_pluggy_daily_operations_default_is_generous_and_zero_is_refused(monkeypatch):
    """Pluggy limits a minute and not a day, so 100 is the default, and a count below 1 would hold every sync back"""
    key = "BANK_SYNC_PLUGGY_DAILY_REQUESTS"
    try:
        monkeypatch.delenv(key, raising=False)
        assert importlib.reload(pluggy_config).PLUGGY_DAILY_REQUESTS == 100
        monkeypatch.setenv(key, "0")
        with pytest.raises(RuntimeError, match=f"Invalid {key}"):
            importlib.reload(pluggy_config)
    finally:
        monkeypatch.delenv(key, raising=False)
        importlib.reload(pluggy_config)
