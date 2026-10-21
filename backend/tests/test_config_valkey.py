"""The ValKey address is read once at import, so each case starts its own interpreter

The child gets VALKEY_URL set or removed explicitly, because the parent carries the test environment
and the app's load_dotenv never overrides a key already present
"""

import os
import subprocess
import sys
from pathlib import Path

import pytest

_BACKEND_DIR = Path(__file__).resolve().parents[1]

_PRINT_URL_SCRIPT = "from app.config.valkey import VALKEY_URL; print(repr(VALKEY_URL))"

_PASSWORD = "s3cret-password"


def _read_url_setting(value: str | None) -> subprocess.CompletedProcess[str]:
    """Import the setting in a clean interpreter, with VALKEY_URL removed when the value is None"""
    environment = {key: setting for key, setting in os.environ.items() if key != "VALKEY_URL"}
    if value is not None:
        environment["VALKEY_URL"] = value

    return subprocess.run(  # noqa: S603
        [sys.executable, "-c", _PRINT_URL_SCRIPT],
        cwd=_BACKEND_DIR,
        env=environment,
        check=False,
        capture_output=True,
        text=True,
    )


@pytest.mark.parametrize("value", [None, "", "   "], ids=["unset", "blank", "spaces"])
def test_valkey_url_unset_or_blank_runs_without_a_cache(value):
    """Leaving the address out, or clearing it in Compose, turns the cache off instead of failing start-up"""
    completed = _read_url_setting(value)

    assert completed.returncode == 0, completed.stderr
    assert completed.stdout.strip() == "None"


@pytest.mark.parametrize(
    "value",
    [
        "valkeys://cache.example.test:6380/3",
        "valkey://valkey",
        "unix:///var/run/valkey.sock",
        "  valkey://valkey:6379  ",
    ],
    ids=["port-and-database", "no-port", "socket", "spaces"],
)
def test_valkey_url_accepts_the_addresses_the_client_connects_to(value):
    """Each form the client's URL parser takes starts the server, with the surrounding spaces dropped"""
    completed = _read_url_setting(value)

    assert completed.returncode == 0, completed.stderr
    assert completed.stdout.strip() == repr(value.strip())


@pytest.mark.parametrize(
    "value",
    [
        "http://valkey:6379",
        "valkey:6379",
        "valkey://",
        "valkey://valkey:0",
        "valkey://valkey:70000",
        "valkey://valkey:port",
        "valkey://valkey:6379/cache",
        "valkey://valkey:6379/0?socket_timeout=60",
        "valkey://valkey:6379/0#fragment",
        "unix://",
    ],
)
def test_valkey_url_refuses_an_address_the_client_cannot_use(value):
    """A mistyped address stops start-up at once instead of silently running without the cache"""
    completed = _read_url_setting(value)

    assert completed.returncode != 0
    assert "Invalid VALKEY_URL" in completed.stderr


def test_valkey_url_error_never_prints_the_password():
    """A refused address that carries a password does not leak it into the start-up log"""
    completed = _read_url_setting(f"http://:{_PASSWORD}@valkey:6379")

    assert completed.returncode != 0
    assert "Invalid VALKEY_URL" in completed.stderr
    assert _PASSWORD not in completed.stderr
    assert _PASSWORD not in completed.stdout
