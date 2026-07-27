import pytest

from app.config.env import optional_bool_env
from app.config.runtime import is_update_check_enabled


@pytest.mark.parametrize("value", ["true", "TRUE"])
def test_optional_bool_env_parses_true_values(monkeypatch, value):
    """Boolean env parsing accepts true values"""
    monkeypatch.setenv("UPDATE_CHECKS_ENABLED", value)

    assert optional_bool_env("UPDATE_CHECKS_ENABLED", default=False) is True


@pytest.mark.parametrize("value", ["false", "FALSE"])
def test_optional_bool_env_parses_false_values(monkeypatch, value):
    """Boolean env parsing accepts false values"""
    monkeypatch.setenv("UPDATE_CHECKS_ENABLED", value)

    assert optional_bool_env("UPDATE_CHECKS_ENABLED", default=True) is False


def test_optional_bool_env_uses_default_for_missing_value(monkeypatch):
    """Boolean env parsing uses the default when missing"""
    monkeypatch.delenv("UPDATE_CHECKS_ENABLED", raising=False)

    assert optional_bool_env("UPDATE_CHECKS_ENABLED", default=True) is True


def test_optional_bool_env_uses_default_for_blank_value(monkeypatch):
    """Boolean env parsing uses the default when blank"""
    monkeypatch.setenv("UPDATE_CHECKS_ENABLED", " ")

    assert optional_bool_env("UPDATE_CHECKS_ENABLED", default=True) is True


@pytest.mark.parametrize("value", ["1", "0", "yes", "no", "on", "off", "maybe"])
def test_optional_bool_env_rejects_invalid_value(monkeypatch, value):
    """Boolean env parsing rejects ambiguous values"""
    monkeypatch.setenv("UPDATE_CHECKS_ENABLED", value)

    with pytest.raises(RuntimeError, match="Invalid UPDATE_CHECKS_ENABLED"):
        optional_bool_env("UPDATE_CHECKS_ENABLED", default=False)


@pytest.mark.parametrize(
    ("runtime", "configured_enabled", "expected"),
    [
        ("server", True, True),
        ("server", False, False),
        ("lambda", True, False),
        ("lambda", False, False),
    ],
)
def test_update_check_runtime_gate(runtime, configured_enabled, expected):
    """Update checks only run when the server runtime allows them"""
    assert is_update_check_enabled(runtime, configured_enabled) is expected
