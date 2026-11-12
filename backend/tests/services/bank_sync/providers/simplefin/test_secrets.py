"""SimpleFIN secret handling tests

A setup token's claim URL and an Access URL each open the user's bank data to whoever holds them,
so these make real requests to a local HTTPS server with every logger at DEBUG and check that
neither reaches a log, an exception or a reason, whatever the server answers
"""

import base64
import logging
import traceback
from datetime import UTC, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import pytest

from app.services.bank_sync.outbound import OutboundGuard
from app.services.bank_sync.providers.contract import ClaimRefused, FetchResult
from app.services.bank_sync.providers.simplefin.adapter import SimpleFinAdapter
from tests.services.bank_sync.local_bridge import LOOPBACK, LocalBridge, serve_local_bridge
from tests.services.bank_sync.stand_ins import FixedResolver

_FIXTURES = Path(__file__).resolve().parents[4] / "fixtures" / "simplefin"

_CLAIM_SECRET = "CLAIM-SECRET-7f3a"
_USERNAME = "ACCESS-USER-91c2"
_PASSWORD = "ACCESS-PASSWORD-5d8e"


def _adapter(bridge: LocalBridge) -> SimpleFinAdapter:
    """Return an adapter allowed to reach the local server, and nothing else"""
    guard = OutboundGuard([], bridge.origin, resolve=FixedResolver(LOOPBACK), transport=httpx.AsyncHTTPTransport(verify=bridge.client_tls))
    return SimpleFinAdapter(guard)


def _setup_token(bridge: LocalBridge) -> str:
    """Return a setup token for a claim on the local server"""
    return base64.b64encode(f"{bridge.origin}/simplefin/claim/{_CLAIM_SECRET}".encode()).decode()


def _access_url(bridge: LocalBridge) -> str:
    """Return an Access URL on the local server"""
    return f"https://{_USERNAME}:{_PASSWORD}@{bridge.host}:{bridge.port}/simplefin"


def _assert_kept_out(bridge: LocalBridge, *texts: str) -> None:
    """Assert that no text holds a secret, as sent or encoded"""
    secrets = [_CLAIM_SECRET, _setup_token(bridge), _USERNAME, _PASSWORD, base64.b64encode(f"{_USERNAME}:{_PASSWORD}".encode()).decode()]
    for text in texts:
        assert not [secret for secret in secrets if secret in text]


def _described(error: BaseException) -> list[str]:
    """Return every way an exception is usually shown: its message, its repr and its traceback"""
    return [str(error), repr(error), "".join(traceback.format_exception(error))]


async def test_claim_keeps_both_urls_out_of_every_log(tmp_path, caplog):
    """A successful claim logs neither the claim URL nor the Access URL it returns"""
    caplog.set_level(logging.DEBUG)

    def answer(_head: bytes) -> tuple[int, str, bytes]:
        """Answer the claim with an Access URL on the same server"""
        return 200, "text/plain", _access_url(bridge).encode()

    async with serve_local_bridge(tmp_path, "bridge.test", answer) as bridge:
        access_url = await _adapter(bridge).claim_setup_token(_setup_token(bridge))

    assert access_url == _access_url(bridge)
    _assert_kept_out(bridge, caplog.text)


async def test_failed_claim_keeps_the_claim_url_out_of_the_error_and_logs(tmp_path, caplog):
    """A refused claim's exception and the logs name no part of the claim URL"""
    caplog.set_level(logging.DEBUG)

    async with serve_local_bridge(tmp_path, "bridge.test", lambda _head: (403, "text/plain", b"Forbidden")) as bridge:
        with pytest.raises(ClaimRefused) as failure:
            await _adapter(bridge).claim_setup_token(_setup_token(bridge))

    _assert_kept_out(bridge, *_described(failure.value), caplog.text)


def _reasons(result: FetchResult) -> list[str]:
    """Return every reason a result gives"""
    errors = [result.request_error, *result.warnings, *result.account_errors.values(), *result.login_errors.values()]
    return [error.reason for error in errors if error]


@pytest.mark.parametrize(
    ("status", "content_type", "body"),
    [
        (200, "application/json", (_FIXTURES / "accounts.json").read_bytes()),
        (403, "text/plain", b"Forbidden"),
        (500, "text/plain", b"Internal Server Error"),
        (200, "text/html", b"<html><body>Maintenance</body></html>"),
    ],
    ids=["answered", "rejected", "server-error", "html"],
)
async def test_sync_keeps_the_access_url_out_of_reasons_logs_and_the_request_line(tmp_path, caplog, status, content_type, body):
    """Discovery and a fetch send the credentials only in the Authorization header, and nothing repeats them"""
    caplog.set_level(logging.DEBUG)

    async with serve_local_bridge(tmp_path, "bridge.test", lambda _head: (status, content_type, body)) as bridge:
        adapter = _adapter(bridge)
        discovered = await adapter.discover(_access_url(bridge), currency_exponents={"USD": 2})
        fetched = await adapter.fetch(
            _access_url(bridge),
            account_ids=["ACT-chequing"],
            start=datetime(2026, 7, 1, tzinfo=UTC),
            end=datetime(2026, 9, 29, tzinfo=UTC),
            include_pending=True,
            timezone=ZoneInfo("America/Los_Angeles"),
            currency_exponents={"USD": 2},
        )

    assert len(bridge.request_heads) == 2
    assert all(b"\r\nauthorization: basic " in head.lower() for head in bridge.request_heads)
    request_lines = [head.split(b"\r\n", 1)[0].decode("ascii") for head in bridge.request_heads]
    _assert_kept_out(bridge, *_reasons(discovered), *_reasons(fetched), *request_lines, caplog.text)
