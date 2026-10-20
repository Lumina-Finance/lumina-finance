"""Database connection URL tests"""

import json
import subprocess
import sys
import traceback
from pathlib import Path

import pytest
from sqlalchemy.engine import make_url

from app.config.database import admin_database_url, app_database_url, migration_database_url

_BACKEND_DIR = Path(__file__).resolve().parents[1]

# The first migration, which renders without a connection unlike the later data migrations
_INITIAL_REVISION = "12adf8266729"

# Runs alembic's own env.py in offline and online mode and prints the URL each path reads from
# its configuration, stopping before any connection. The offline path hands it to
# context.configure and the online path to async_engine_from_config
_URL_PROBE = """
import json
import sys
import sqlalchemy.ext.asyncio as asyncio_extension
from alembic import command
from alembic.config import Config
from alembic.runtime.environment import EnvironmentContext


class Stop(Exception):
    pass


seen = {}


def capture_offline(self, *args, **kwargs):
    seen["offline"] = kwargs["url"]
    raise Stop


def capture_online(section, **kwargs):
    seen["online"] = section["sqlalchemy.url"]
    raise Stop


EnvironmentContext.configure = capture_offline
asyncio_extension.async_engine_from_config = capture_online
for kwargs in ({"revision": "base:" + sys.argv[1], "sql": True}, {"revision": "head"}):
    try:
        command.upgrade(Config("alembic.ini"), **kwargs)
    except Stop:
        pass
print(json.dumps(seen))
"""


@pytest.mark.parametrize(
    ("build_url", "password_variable", "password"),
    [
        (admin_database_url, "DB_PASSWORD", "p@ss/w:rd"),
        (migration_database_url, "MIGRATOR_DB_PASSWORD", "50%41off"),
        (app_database_url, "APP_DB_PASSWORD", "abc#def?ghi"),
    ],
)
def test_url_with_reserved_characters_in_the_password_decodes_to_that_password(
    monkeypatch, build_url, password_variable, password,
):
    """A password holding URL delimiters or a percent sign reaches the driver unchanged"""
    monkeypatch.setenv(password_variable, password)

    assert make_url(build_url()).password == password


def test_migrations_with_a_percent_sign_in_the_password_read_the_unchanged_url(monkeypatch):
    """Alembic interpolates percent signs in its configuration, so both paths must still read the built URL"""
    monkeypatch.setenv("MIGRATOR_DB_PASSWORD", "50%41off")

    # A subprocess keeps env.py's logging setup away from the other tests. The probe is a fixed constant
    completed = subprocess.run(  # noqa: S603
        [sys.executable, "-c", _URL_PROBE, _INITIAL_REVISION], cwd=_BACKEND_DIR,
        check=False, capture_output=True, text=True,
    )

    assert completed.returncode == 0, completed.stdout + completed.stderr
    urls = json.loads(completed.stdout.splitlines()[-1])
    assert urls == {"offline": migration_database_url(), "online": migration_database_url()}
    assert make_url(urls["online"]).password == "50%41off"


def _failure_text(error: BaseException) -> str:
    """Return everything a log line or traceback would show for an error, causes included"""
    return "".join(traceback.format_exception(error))


def test_url_with_an_unencodable_password_fails_without_the_password(monkeypatch):
    """A byte the environment cannot decode, which Python keeps as a lone surrogate, is not echoed back"""
    monkeypatch.setenv("DB_PASSWORD", "hunter\udcff2")

    with pytest.raises(ValueError) as raised:
        admin_database_url()

    failure = _failure_text(raised.value)
    assert "hunter" not in failure
    assert "udcff" not in failure
