"""Akahu settings tests

Guards the testing-only origin, which has to accept plain HTTP for the fake Akahu and refuse anything
beyond an origin, and the daily operation count a mistyped setting must not turn into zero
"""

import importlib

import pytest

from app.config.bank_sync import read_test_origin_setting
from app.services.bank_sync.providers.akahu import config as akahu_config


def test_akahu_test_origin_may_use_plain_http(monkeypatch):
    """The fake Akahu in development and CI is served over plain HTTP"""
    monkeypatch.setenv("BANK_SYNC_AKAHU_TEST_ORIGIN", "http://fake-akahu:8792")

    assert read_test_origin_setting(akahu_config.TEST_ORIGIN_KEY) == "http://fake-akahu:8792"


@pytest.mark.parametrize("origin", ["http://akahu.example/v1", "http://user:secret@akahu.example", "ftp://akahu.example"])
def test_akahu_test_origin_beyond_an_origin_is_refused_at_start(monkeypatch, origin):
    """The app refuses to start rather than guessing which part of the entry was meant"""
    monkeypatch.setenv("BANK_SYNC_AKAHU_TEST_ORIGIN", origin)

    with pytest.raises(RuntimeError, match="Invalid BANK_SYNC_AKAHU_TEST_ORIGIN"):
        read_test_origin_setting(akahu_config.TEST_ORIGIN_KEY)


def test_akahu_daily_operations_default_to_one_an_hour_and_zero_is_refused(monkeypatch):
    """Akahu refreshes a personal app's data once a day, so 24 is the default, and a count below 1 would hold every sync back"""
    key = "BANK_SYNC_AKAHU_DAILY_REQUESTS"
    try:
        monkeypatch.delenv(key, raising=False)
        assert importlib.reload(akahu_config).AKAHU_DAILY_REQUESTS == 24
        monkeypatch.setenv(key, "0")
        with pytest.raises(RuntimeError, match=f"Invalid {key}"):
            importlib.reload(akahu_config)
    finally:
        monkeypatch.delenv(key, raising=False)
        importlib.reload(akahu_config)
