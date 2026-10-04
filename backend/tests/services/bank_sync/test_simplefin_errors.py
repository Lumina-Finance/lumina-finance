"""SimpleFIN error mapping tests

Guards which accounts stop, retry or carry on when SimpleFIN Bridge reports a problem. A wrong
mapping either stops a working connection or keeps sending requests Bridge has refused, which can
get the user's token disabled
"""

import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import pytest

from app.http_client import MAX_RESPONSE_BYTES
from app.services.bank_sync.providers.contract import FetchResult, ProviderError, ProviderErrorKind
from app.services.bank_sync.providers.simplefin.adapter import SimpleFinAdapter
from tests.services.bank_sync.stand_ins import RecordingBridge, Responder, answer_with, fail_with, simplefin_adapter

_RECORDED = json.loads((Path(__file__).resolve().parents[2] / "fixtures" / "simplefin" / "errors.json").read_text())
_ACCESS_URL = "https://demo-user:demo-password@beta-bridge.simplefin.org/simplefin"
_ALL_ACCOUNTS = ("ACT-chequing", "ACT-savings", "ACT-visa")

_CREDENTIAL_REJECTED = ProviderErrorKind.CREDENTIAL_REJECTED
_BANK_LOGIN_NEEDED = ProviderErrorKind.BANK_LOGIN_NEEDED
_RATE_LIMITED = ProviderErrorKind.RATE_LIMITED
_TEMPORARY = ProviderErrorKind.TEMPORARY
_UNKNOWN = ProviderErrorKind.UNKNOWN

_UNREACHABLE = "SimpleFIN Bridge couldn't be reached"
_UNREADABLE = "SimpleFIN Bridge sent a response Lumina Finance couldn't read"


def _recorded(case: str) -> Responder:
    """Return a responder answering with one of the recorded error responses"""
    return answer_with(200, json.dumps(_RECORDED[case]).encode(), "application/json")


async def _fetch(respond: Responder) -> FetchResult:
    """Fetch every account once from a stand-in answering with the responder"""
    return await _fetch_with(simplefin_adapter(RecordingBridge(respond)))


async def _fetch_with(adapter: SimpleFinAdapter, access_url: str = _ACCESS_URL) -> FetchResult:
    """Fetch every account once through the adapter"""
    return await adapter.fetch(
        access_url,
        account_ids=_ALL_ACCOUNTS,
        start=datetime(2026, 9, 1, tzinfo=UTC),
        end=datetime(2026, 10, 1, tzinfo=UTC),
        include_pending=True,
        timezone=ZoneInfo("America/Toronto"),
        currency_exponents={"USD": 2},
    )


@pytest.mark.parametrize(
    ("respond", "error"),
    [
        (answer_with(403, b"Forbidden"), ProviderError(_CREDENTIAL_REJECTED, "SimpleFIN Bridge rejected the stored access credential")),
        (answer_with(403, b"<!DOCTYPE html><title>Access denied</title>", "text/html"), ProviderError(_TEMPORARY, _UNREACHABLE)),
        (answer_with(503, b"Service Unavailable"), ProviderError(_TEMPORARY, _UNREACHABLE)),
        (fail_with(httpx.ReadTimeout), ProviderError(_TEMPORARY, "SimpleFIN Bridge did not respond in time")),
        (fail_with(httpx.ConnectError), ProviderError(_TEMPORARY, _UNREACHABLE)),
        (answer_with(200, b"Service temporarily unavailable"), ProviderError(_TEMPORARY, _UNREADABLE)),
        (answer_with(200, b"x" * (MAX_RESPONSE_BYTES + 1)), ProviderError(_TEMPORARY, _UNREADABLE)),
        (
            answer_with(429, json.dumps(_RECORDED["account-missing"]).encode(), "application/json"),
            ProviderError(_RATE_LIMITED, "SimpleFIN Bridge asked Lumina Finance to make fewer requests"),
        ),
        (answer_with(402, b"Payment Required"), ProviderError(_TEMPORARY, "SimpleFIN Bridge reports a payment problem")),
        (answer_with(404, b"Not Found"), ProviderError(_UNKNOWN, _UNREADABLE)),
        (answer_with(302, b""), ProviderError(_UNKNOWN, _UNREADABLE)),
    ],
    ids=[
        "403-text",
        "403-html",
        "5xx",
        "timeout",
        "connection-failed",
        "not-json",
        "too-large",
        "429",
        "402",
        "other-status",
        "redirect",
    ],
)
async def test_failed_request_fails_every_account_with_its_typed_error(respond, error):
    """A status, a transport failure or an unusable body fails the whole request, keeping nothing from it"""
    result = await _fetch(respond)

    assert result.request_error == error
    assert result.accounts == ()


async def test_access_url_on_a_server_no_longer_allowed_needs_reconnecting():
    """Once the operator stops allowing the connection's server, only a new connection can sync"""
    bridge = RecordingBridge()

    result = await _fetch_with(simplefin_adapter(bridge), "https://user:pass@intranet.example/simplefin")

    assert result.request_error == ProviderError(_CREDENTIAL_REJECTED, "This Lumina Finance server is not set up to contact intranet.example")
    assert bridge.requests == []


async def test_bridge_resolving_privately_is_a_temporary_failure_logged_by_host(caplog):
    """A private DNS answer is refused and retried later, with a warning naming only the host"""
    bridge = RecordingBridge()

    result = await _fetch_with(simplefin_adapter(bridge, "10.0.4.2"))

    assert result.request_error == ProviderError(_TEMPORARY, _UNREACHABLE)
    assert bridge.requests == []
    [warning] = [record for record in caplog.records if record.levelno == logging.WARNING]
    assert "beta-bridge.simplefin.org" in warning.getMessage()


@pytest.mark.parametrize(
    ("case", "error"),
    [
        (
            "credential-rejected",
            ProviderError(_CREDENTIAL_REJECTED, "Your access token is no longer valid. Create a new setup token to reconnect."),
        ),
        ("bridge-api-error", ProviderError(_TEMPORARY, "SimpleFIN Bridge is having trouble right now. Try again later.")),
        ("bank-login-needed-naming-no-login", ProviderError(_BANK_LOGIN_NEEDED, "SimpleFIN Bridge says your bank needs you to sign in again")),
        ("unknown-general-code-without-data", ProviderError(_UNKNOWN, "SimpleFIN Bridge is down for maintenance until 02:00 UTC.")),
        ("unknown-prefix", ProviderError(_UNKNOWN, "Harbour Bank is no longer supported.")),
        ("quota-warning-without-data", ProviderError(_RATE_LIMITED, "Too many requests today. Please make fewer requests.")),
    ],
)
async def test_problem_affecting_the_whole_request_fails_every_account(case, error):
    """Bridge's own message becomes the reason, or a general one when it sends none"""
    result = await _fetch(_recorded(case))

    assert result.request_error == error
    assert result.accounts == ()


async def test_bank_login_problem_stops_only_that_logins_accounts():
    """con.auth for the Harbour Bank login stops Everyday Chequing and Online Savings, while Rewards Visa syncs"""
    result = await _fetch(_recorded("bank-login-needed"))

    assert result.request_error is None
    assert result.login_errors == {"CON-harbour": ProviderError(_BANK_LOGIN_NEEDED, "Harbour Bank needs you to sign in again.")}
    assert result.account_errors == {}
    assert {account.external_id: account.login_key for account in result.accounts} == {
        "ACT-chequing": "CON-harbour",
        "ACT-savings": "CON-harbour",
        "ACT-visa": "CON-harbourline",
    }
    assert [record.external_id for record in result.accounts[2].records] == ["TRN-streaming"]


async def test_account_problem_fails_only_that_account():
    """An act error for Rewards Visa fails it, and the other accounts sync"""
    result = await _fetch(_recorded("account-failed"))

    assert result.request_error is None
    assert result.account_errors == {"ACT-visa": ProviderError(_TEMPORARY, "Rewards Visa couldn't be updated.")}
    assert result.login_errors == {}
    assert len(result.accounts) == 3


async def test_unknown_subcode_takes_its_prefixs_meaning():
    """An unfamiliar con code still needs the bank sign-in, and an unfamiliar act code still fails its account"""
    result = await _fetch(_recorded("unknown-subcodes"))

    assert result.login_errors == {"CON-harbour": ProviderError(_BANK_LOGIN_NEEDED, "Harbour Bank wants a security code.")}
    assert result.account_errors == {"ACT-visa": ProviderError(_TEMPORARY, "Rewards Visa is being closed.")}


@pytest.mark.parametrize(
    ("case", "warning"),
    [
        ("unknown-general-code-with-data", ProviderError(_UNKNOWN, "Some banks may be slow to update tonight.")),
        (
            "quota-warning-with-data",
            ProviderError(_RATE_LIMITED, "You've reached today's refresh limit. Make fewer requests or this token may be disabled."),
        ),
    ],
)
async def test_general_warning_beside_data_keeps_the_data(case, warning):
    """An unknown general code or a quota warning that arrives with accounts is recorded once, and they sync"""
    result = await _fetch(_recorded(case))

    assert result.request_error is None
    assert result.warnings == (warning,)
    assert result.account_errors == {}
    assert result.login_errors == {}
    assert [account.external_id for account in result.accounts] == list(_ALL_ACCOUNTS)


async def test_account_left_out_of_the_response_fails():
    """A requested account the response leaves out fails for this sync, while the others proceed"""
    result = await _fetch(_recorded("account-missing"))

    assert result.request_error is None
    assert result.account_errors == {"ACT-visa": ProviderError(_TEMPORARY, "SimpleFIN Bridge didn't return this account")}
    assert [account.external_id for account in result.accounts] == ["ACT-chequing", "ACT-savings"]
