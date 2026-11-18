"""Start-up settings that refuse unsafe defaults, exercised by importing the app in a clean interpreter

Settings are read once at import, so each case starts its own interpreter with the settings it
needs. Every setting these tests vary is written out for each child, because the parent carries
the test environment and the app's load_dotenv never overrides a key already present
"""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

_BACKEND_DIR = Path(__file__).resolve().parents[1]

_BASE_SETTINGS = {
    "APP_URL": "",
    "ALLOWED_ORIGINS": "",
    "EMAIL_BACKEND": "logging",
}

# Prints the CORS headers a credentialed request from an unconfigured origin gets back. The
# client is never entered as a context manager, so the lifespan and its database checks never run
_CORS_HEADERS_SCRIPT = (
    "import json;"
    "from fastapi.testclient import TestClient;"
    "from app.main import app;"
    "response = TestClient(app).get('/health', headers={"
    "'Origin': 'https://other.example.test', 'Cookie': 'refresh_token=value'});"
    "print(json.dumps({key: value for key, value in response.headers.items()"
    " if key.startswith('access-control-')}))"
)

# Prints the status of each API docs path
_DOCS_STATUS_SCRIPT = (
    "import json;"
    "from fastapi.testclient import TestClient;"
    "from app.main import app;"
    "client = TestClient(app);"
    "print(json.dumps([client.get(path).status_code for path in ('/docs', '/redoc', '/openapi.json')]))"
)


def _start_app(script: str, settings: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    """Run the script in a clean interpreter with the base settings and the given overrides"""
    return subprocess.run(  # noqa: S603
        [sys.executable, "-c", script],
        cwd=_BACKEND_DIR,
        env={**os.environ, **_BASE_SETTINGS, **(settings or {})},
        check=False,
        capture_output=True,
        text=True,
    )


def _output(completed: subprocess.CompletedProcess[str]):
    """Return the child's printed JSON, failing with its output when it did not start"""
    assert completed.returncode == 0, completed.stdout + completed.stderr
    return json.loads(completed.stdout)


def test_cors_without_a_configured_origin_sends_no_cors_headers():
    """With no origin configured, a credentialed request from another origin gets no CORS headers"""
    assert _output(_start_app(_CORS_HEADERS_SCRIPT)) == {}


# Prints the passkey prompt's name and whether update checks run, as the started app holds them
_RETIRED_SETTINGS_SCRIPT = (
    "import json;"
    "import app.main;"
    "from app.services import app_version;"
    "from app.services.auth import webauthn;"
    "print(json.dumps([webauthn.WEBAUTHN_RP_NAME, app_version.UPDATE_CHECKS_ENABLED]))"
)


def test_retired_runtime_and_passkey_name_settings_are_ignored():
    """An install still setting RUNTIME, to any value, or WEBAUTHN_RP_NAME starts as usual

    The passkey prompt keeps its fixed name, and update checks follow UPDATE_CHECKS_ENABLED alone
    """
    settings = {"RUNTIME": "other", "WEBAUTHN_RP_NAME": "Custom Name", "UPDATE_CHECKS_ENABLED": "false"}

    assert _output(_start_app(_RETIRED_SETTINGS_SCRIPT, settings)) == ["Lumina Finance Self-Hosted", False]


def test_api_docs_paths_answer_404():
    """The API docs paths are never served, even with the retired API_DOCS_ENABLED set to true"""
    assert _output(_start_app(_DOCS_STATUS_SCRIPT, {"API_DOCS_ENABLED": "true"})) == [404, 404, 404]


# Answers one request on purpose with a 503 and one with a 200, then writes one abuse line and prints
# the level the database library's lines are held to
_LOG_LEVEL_SCRIPT = """
import logging
from fastapi import HTTPException
from fastapi.testclient import TestClient
from app.abuse_log import log_source_address
from app.main import app
from app.request_hook import RequestRecord

@app.get("/test/unavailable")
async def unavailable():
    raise HTTPException(status_code=503)

client = TestClient(app)
client.get("/test/unavailable")
client.get("/health?secret=query-value")
log_source_address(RequestRecord({"client": ("203.0.113.9", 1)}, "POST", "/auth/login", 401, 0.01))
print(logging.getLevelName(logging.getLogger("sqlalchemy.engine").getEffectiveLevel()))
"""

_ERROR_LINE = "ERROR app.request_log: GET /test/unavailable answered 503 in"
_DEBUG_LINE = "DEBUG app.request_log: GET /health answered 200 in"
_ABUSE_LINE = '"ip":"203.0.113.9"'


@pytest.mark.parametrize(
    ("configured", "is_debug_line_written", "is_abuse_line_written"),
    [
        ("debug", True, True),
        ("", False, True),
        ("INFO", False, True),
        ("WARNING", False, False),
        ("ERROR", False, False),
    ],
)
def test_log_level_decides_which_lines_are_written(configured, is_debug_line_written, is_abuse_line_written):
    """Server errors show at every level, request lines at debug only, and fail2ban's lines from info down"""
    completed = _start_app(_LOG_LEVEL_SCRIPT, {"LOG_LEVEL": configured})

    assert completed.returncode == 0, completed.stderr
    assert _ERROR_LINE in completed.stderr
    assert (_DEBUG_LINE in completed.stderr) is is_debug_line_written
    assert (_ABUSE_LINE in completed.stdout) is is_abuse_line_written
    assert "query-value" not in completed.stderr + completed.stdout


def test_debug_level_stops_at_the_app_so_outside_libraries_write_no_values():
    """The database library's lines hold statement values, so debug never reaches them"""
    completed = _start_app(_LOG_LEVEL_SCRIPT, {"LOG_LEVEL": "DEBUG"})

    assert completed.stdout.strip().endswith("WARNING")


def test_an_unknown_log_level_refuses_to_start():
    """A mistyped level stops start-up and names the accepted values"""
    completed = _start_app("import app.main", {"LOG_LEVEL": "verbose"})

    assert completed.returncode != 0
    assert "Invalid LOG_LEVEL='verbose'. Must be one of: DEBUG, INFO, WARNING, ERROR" in completed.stderr
