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
    "RUNTIME": "server",
    "APP_URL": "",
    "ALLOWED_ORIGINS": "",
    "EMAIL_BACKEND": "logging",
}

_LAMBDA_SETTINGS = {"RUNTIME": "lambda", "APP_URL": "https://app.example.test", "EMAIL_BACKEND": "smtp"}

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


def test_lambda_without_app_url_refuses_to_start():
    """RUNTIME=lambda stops start-up without APP_URL, even when ALLOWED_ORIGINS lists an origin"""
    completed = _start_app(
        "import app.main",
        {**_LAMBDA_SETTINGS, "APP_URL": "", "ALLOWED_ORIGINS": "https://extra.example.test"},
    )

    assert completed.returncode != 0
    assert "Missing required environment variable: APP_URL" in completed.stderr


@pytest.mark.parametrize("runtime_settings", [{}, _LAMBDA_SETTINGS], ids=["server", "lambda"])
def test_api_docs_paths_answer_404_in_every_runtime(runtime_settings):
    """The API docs paths are never served, even with the retired API_DOCS_ENABLED set to true"""
    settings = {**runtime_settings, "API_DOCS_ENABLED": "true"}

    assert _output(_start_app(_DOCS_STATUS_SCRIPT, settings)) == [404, 404, 404]


def test_lambda_with_the_logging_email_backend_refuses_to_start():
    """RUNTIME=lambda stops start-up with the logging email backend, which writes reset links to the log"""
    completed = _start_app("import app.main", {**_LAMBDA_SETTINGS, "EMAIL_BACKEND": "logging"})

    assert completed.returncode != 0
    assert "Invalid EMAIL_BACKEND='logging'. RUNTIME=lambda requires smtp" in completed.stderr


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
