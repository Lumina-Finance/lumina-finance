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
