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


# Prints the passkey prompt's name from the real registration options, the From header of a message
# the real SMTP sender builds, the text of a reset email, the text of a Bank sign-in needed email,
# and the update check setting. Stubs stand in only for the database and the mail delivery, and
# the session stub answers every query with its given rows and single value
_SERVICE_NAME_SCRIPT = """
import asyncio
import json
import uuid
from types import SimpleNamespace
import app.main
from app.services import app_version
from app.services.auth.webauthn import build_passkey_registration_options
from app.services.bank_sync.action_needed import flag_signin_needed
from app.services.email import RenderedEmail, render_reset_email, senders

class Result:
    def __init__(self, rows):
        self.rows = rows

    def __iter__(self):
        return iter(self.rows)

    def scalars(self):
        return iter(())

    def all(self):
        return []

class Session:
    def __init__(self, rows, value):
        self.rows, self.value = rows, value

    async def execute(self, statement):
        return Result(self.rows)

    async def scalars(self, statement):
        return Result(())

    async def scalar(self, statement):
        return self.value

    def add(self, row):
        pass

    async def commit(self):
        pass

delivered = []

async def record(message, **kwargs):
    delivered.append(message)

async def main():
    options = await build_passkey_registration_options(Session([], 0), uuid.uuid4(), "user@example.test")
    await senders.SmtpEmailSender().send("user@example.test", RenderedEmail(subject="Hi", text_body="Body"))
    connection = SimpleNamespace(id=uuid.uuid4(), provider="fake", owner_id=uuid.uuid4())
    link = SimpleNamespace(id=uuid.uuid4(), signin_needed_since=None)
    session = Session([("login", "Example Bank", "Everyday")], "user@example.test")
    [signin_email] = await flag_signin_needed(session, connection, [link], at=None)
    return json.loads(options)["rp"]["name"], signin_email.message.text_body

senders.aiosmtplib.send = record
passkey_name, signin_email_text = asyncio.run(main())
print(json.dumps([
    passkey_name,
    delivered[0]["From"],
    render_reset_email("https://app.example.test/reset", 15).html_body,
    signin_email_text,
    app_version.UPDATE_CHECKS_ENABLED,
]))
"""


def test_runtime_and_service_name_settings_are_ignored():
    """An install setting RUNTIME, or any variable naming another service, starts as usual with the fixed names

    No variable reaches the service name, since users trust a mail's sender name. The passkey
    prompt and the mail keep their fixed names, and update checks follow UPDATE_CHECKS_ENABLED alone
    """
    settings = {
        # Passkey options need an app address to name the relying party
        "APP_URL": "https://app.example.test",
        "RUNTIME": "other",
        "WEBAUTHN_RP_NAME": "Another Service",
        "EMAIL_SENDER_NAME": "Another Service",
        "SERVICE_NAME": "Another Service",
        "APP_NAME": "Another Service",
        "MAIL_FROM": "no-reply@example.test",
        "UPDATE_CHECKS_ENABLED": "false",
    }

    passkey_name, from_header, reset_email_html, signin_email_text, are_update_checks_enabled = _output(
        _start_app(_SERVICE_NAME_SCRIPT, settings)
    )

    assert passkey_name == "Lumina Finance Self-Hosted"
    assert from_header == '"Lumina Finance (Self-Hosted)" <no-reply@example.test>'
    assert ">Lumina Finance (Self-Hosted)</td>" in reset_email_html
    assert "Another Service" not in reset_email_html
    assert signin_email_text.endswith("\n\nLumina Finance checks each day and resumes syncing after you sign in again.")
    assert "Another Service" not in signin_email_text
    assert are_update_checks_enabled is False


_LOGGING_BACKEND_WARNING_LINE = "WARNING app.main: EMAIL_BACKEND is set to logging"


@pytest.mark.parametrize(
    ("settings", "is_warned"),
    [
        ({"EMAIL_BACKEND": "logging", "LOG_LEVEL": "INFO"}, True),
        ({"EMAIL_BACKEND": "smtp", "SMTP_HOST": "mail.example.test", "LOG_LEVEL": "INFO"}, False),
    ],
)
def test_start_warns_when_emails_go_to_the_log(settings, is_warned):
    """Starting with the logging backend, the default, warns that sign-up and reset links are written to the log"""
    completed = _start_app("import app.main", settings)

    assert completed.returncode == 0, completed.stderr
    assert (_LOGGING_BACKEND_WARNING_LINE in completed.stderr) is is_warned


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
