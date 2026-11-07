"""Lunch Flow settings tests

Guards the testing-only origin so it accepts plain HTTP for the fake Lunch Flow but refuses
anything beyond an origin, and the daily operation count so a mistyped setting doesn't turn into zero
"""

import importlib

import pytest

from app.config.bank_sync import read_test_origin_setting
from app.services.bank_sync.providers.lunchflow import config as lunchflow_config


def test_lunchflow_test_origin_may_use_plain_http(monkeypatch):
    """The fake Lunch Flow in development and CI is served over plain HTTP"""
    monkeypatch.setenv("BANK_SYNC_LUNCHFLOW_TEST_ORIGIN", "http://fake-lunchflow:8791")

    assert read_test_origin_setting(lunchflow_config.TEST_ORIGIN_KEY) == "http://fake-lunchflow:8791"


@pytest.mark.parametrize("origin", ["http://lunchflow.example/api", "http://user:secret@lunchflow.example", "ftp://lunchflow.example"])
def test_lunchflow_test_origin_beyond_an_origin_is_refused_at_start(monkeypatch, origin):
    """The app refuses to start rather than guessing which part of the entry was meant"""
    monkeypatch.setenv("BANK_SYNC_LUNCHFLOW_TEST_ORIGIN", origin)

    with pytest.raises(RuntimeError, match="Invalid BANK_SYNC_LUNCHFLOW_TEST_ORIGIN"):
        read_test_origin_setting(lunchflow_config.TEST_ORIGIN_KEY)


def test_lunchflow_daily_operations_default_is_generous_and_zero_is_refused(monkeypatch):
    """Lunch Flow publishes no limit so 100 is the default, and a count below 1 would hold every sync back"""
    key = "BANK_SYNC_LUNCHFLOW_DAILY_REQUESTS"
    try:
        monkeypatch.delenv(key, raising=False)
        assert importlib.reload(lunchflow_config).LUNCHFLOW_DAILY_REQUESTS == 100
        monkeypatch.setenv(key, "0")
        with pytest.raises(RuntimeError, match=f"Invalid {key}"):
            importlib.reload(lunchflow_config)
    finally:
        monkeypatch.delenv(key, raising=False)
        importlib.reload(lunchflow_config)
