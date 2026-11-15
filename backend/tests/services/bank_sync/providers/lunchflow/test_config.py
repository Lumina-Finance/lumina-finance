"""Lunch Flow settings tests

Guards the testing-only origin so it accepts plain HTTP for the fake Lunch Flow but refuses
anything beyond an origin. The daily request count is read by the shared count reader, which
`tests/test_config_bank_sync.py` covers
"""

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
