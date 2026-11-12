"""Bank sync settings tests

Guards the readers every bank provider reads its settings through: the counts the environment sets,
such as a daily request cap or how many jobs the worker runs at once, and each provider's switches
"""

import pytest

from app.config.bank_sync import ProviderSettings, read_count_setting, read_provider_settings


def test_count_setting_reads_a_whole_number(monkeypatch):
    """The environment may lower a count"""
    monkeypatch.setenv("BANK_SYNC_LUNAR_BANK_DAILY_REQUESTS", "12")

    assert read_count_setting("BANK_SYNC_LUNAR_BANK_DAILY_REQUESTS", 20) == 12


@pytest.mark.parametrize("value", ["0", "-3", "1.5", "twelve"])
def test_count_setting_below_one_or_not_whole_is_refused_at_start(monkeypatch, value):
    """A cap of 0 would stop every request for good, or a worker run no jobs, so the app or worker refuses to start"""
    monkeypatch.setenv("BANK_SYNC_LUNAR_BANK_DAILY_REQUESTS", value)

    with pytest.raises(RuntimeError, match="Invalid BANK_SYNC_LUNAR_BANK_DAILY_REQUESTS"):
        read_count_setting("BANK_SYNC_LUNAR_BANK_DAILY_REQUESTS", 20)


def test_count_setting_above_its_maximum_is_refused_at_start(monkeypatch):
    """A count over its maximum stops the app or worker starting, and the maximum itself is kept"""
    monkeypatch.setenv("BANK_SYNC_LUNAR_BANK_DAILY_REQUESTS", "25")

    with pytest.raises(RuntimeError, match="Invalid BANK_SYNC_LUNAR_BANK_DAILY_REQUESTS"):
        read_count_setting("BANK_SYNC_LUNAR_BANK_DAILY_REQUESTS", 20, maximum=24)

    monkeypatch.setenv("BANK_SYNC_LUNAR_BANK_DAILY_REQUESTS", "24")
    assert read_count_setting("BANK_SYNC_LUNAR_BANK_DAILY_REQUESTS", 20, maximum=24) == 24


def test_provider_switches_are_on_unless_the_environment_turns_them_off(monkeypatch):
    """A provider with nothing set is on and offered, and each switch reads from its own variable"""
    monkeypatch.delenv("BANK_SYNC_LUNAR_BANK_ENABLED", raising=False)
    monkeypatch.delenv("BANK_SYNC_LUNAR_BANK_OFFERED", raising=False)
    assert read_provider_settings("lunar_bank") == ProviderSettings(enabled=True, offered=True)

    monkeypatch.setenv("BANK_SYNC_LUNAR_BANK_OFFERED", "false")
    assert read_provider_settings("lunar_bank") == ProviderSettings(enabled=True, offered=False)
