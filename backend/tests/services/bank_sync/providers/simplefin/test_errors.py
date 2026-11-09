"""SimpleFIN error mapping tests

Guards which accounts stop, retry or carry on when SimpleFIN Bridge reports a problem. A wrong
mapping either stops a working connection or keeps sending requests Bridge has refused. That can
get the user's token disabled. The fake SimpleFIN Bridge produces each problem it can, and a recording
stand-in answers the rest
"""

import asyncio
import json
import logging
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

import httpx
import pytest

from app.http_client import MAX_RESPONSE_BYTES
from app.services.bank_sync import outbound
from app.services.bank_sync.outbound import IpAddress, OutboundGuard
from app.services.bank_sync.provider_requests import is_quota_spent
from app.services.bank_sync.providers.contract import FetchResult, ProviderError, ProviderErrorKind
from app.services.bank_sync.providers.simplefin.adapter import SimpleFinAdapter
from tests.fake_simplefin_bridge import FakeBridgeTransport
from tests.services.bank_sync.providers.simplefin.stand_ins import ACCESS_URL, SIMPLEFIN_BRIDGE_ORIGIN, FakeBridgeScenario, simplefin_adapter
from tests.services.bank_sync.stand_ins import RecordingBridge, Responder, answer_with, fail_with

_ALL_ACCOUNTS = ("ACT-chequing", "ACT-savings", "ACT-visa")

_CREDENTIAL_REJECTED = ProviderErrorKind.CREDENTIAL_REJECTED
_BANK_LOGIN_NEEDED = ProviderErrorKind.BANK_LOGIN_NEEDED
_RATE_LIMITED = ProviderErrorKind.RATE_LIMITED
_TEMPORARY = ProviderErrorKind.TEMPORARY
_UNKNOWN = ProviderErrorKind.UNKNOWN

_UNREACHABLE = "SimpleFIN Bridge couldn't be reached"
_UNREADABLE = "SimpleFIN Bridge sent a response Lumina Finance couldn't read"

# The fake Bridge's quota warning. It repeats it in other words in the older errors list
_FAKE_QUOTA_WARNING = "You are making too many requests. Make fewer requests or this access token may be disabled"


async def _fetch(adapter: SimpleFinAdapter, access_url: str = ACCESS_URL) -> FetchResult:
    """Fetch every Harbour account once through the adapter"""
    return await adapter.fetch(
        access_url,
        account_ids=_ALL_ACCOUNTS,
        start=datetime(2026, 9, 1, tzinfo=UTC),
        end=datetime(2026, 10, 1, tzinfo=UTC),
        include_pending=True,
        timezone=ZoneInfo("America/Toronto"),
        currency_exponents={"USD": 2},
    )


async def _fetch_from(scenario: FakeBridgeScenario, *problems: dict[str, Any], fault: str | None = None) -> FetchResult:
    """Claim the scenario, give every response the problems and fault, and fetch every Harbour account once"""
    adapter = simplefin_adapter(FakeBridgeTransport())
    access_url = await adapter.claim_setup_token(scenario.setup_token)
    for problem in problems:
        await scenario.change("POST", "/errors", problem)
    if fault:
        await scenario.change("PUT", "/fault", {"kind": fault})
    return await _fetch(adapter, access_url)


@pytest.mark.parametrize(
    ("fault", "error"),
    [
        ("html_error", ProviderError(_TEMPORARY, _UNREACHABLE)),
        ("timeout", ProviderError(_TEMPORARY, "SimpleFIN Bridge did not respond in time")),
        ("rate_limited", ProviderError(_RATE_LIMITED, "SimpleFIN Bridge asked Lumina Finance to make fewer requests")),
        ("payment_required", ProviderError(ProviderErrorKind.PAYMENT_REQUIRED, "SimpleFIN Bridge reports a payment problem")),
    ],
    ids=["403-html", "timeout", "429", "402"],
)
async def test_bridge_fault_fails_every_account_with_its_typed_error(scenario: FakeBridgeScenario, monkeypatch, fault, error):
    """An edge error page, no answer in time, a 429 or a 402 fails the whole request, keeping nothing from it"""
    # Short enough that the timeout fault doesn't hold the test for the full read timeout
    monkeypatch.setattr(outbound, "REQUEST_TIMEOUT", httpx.Timeout(1.0, connect=5.0))
    await scenario.add_harbour_accounts()

    result = await _fetch_from(scenario, fault=fault)

    assert result.request_error == error
    assert result.accounts == ()


async def test_revoked_access_needs_reconnecting(scenario: FakeBridgeScenario):
    """The Bridge's plain 403 for a revoked Access URL means only a new connection can sync"""
    await scenario.add_harbour_accounts()
    adapter = simplefin_adapter(FakeBridgeTransport())
    access_url = await adapter.claim_setup_token(scenario.setup_token)
    await scenario.change("POST", "/revoke")

    result = await _fetch(adapter, access_url)

    assert result.request_error == ProviderError(_CREDENTIAL_REJECTED, "SimpleFIN Bridge rejected the stored access credential")
    assert result.accounts == ()


def _account_set_answer(*, conn_id: str = "CON-harbour", balance_date: int = 1791115200) -> Responder:
    """Return a responder answering with Everyday Chequing under a login that may not be listed, at a balance time"""
    account = {
        "id": "ACT-chequing",
        "name": "Everyday Chequing",
        "conn_id": conn_id,
        "currency": "USD",
        "balance": "2510.75",
        "balance-date": balance_date,
    }
    body = {"errlist": [], "connections": [{"conn_id": "CON-harbour", "name": "Harbour Bank", "org_id": "ORG-harbour"}], "accounts": [account]}
    return _json_answer(body)


def _json_answer(body: dict[str, Any]) -> Responder:
    """Return a responder answering every request with the body as JSON"""
    return answer_with(200, json.dumps(body).encode(), "application/json")


@pytest.mark.parametrize(
    ("respond", "error"),
    [
        (answer_with(503, b"Service Unavailable"), ProviderError(_TEMPORARY, _UNREACHABLE)),
        (fail_with(httpx.ConnectError), ProviderError(_TEMPORARY, _UNREACHABLE)),
        (answer_with(200, b"Service temporarily unavailable"), ProviderError(_TEMPORARY, _UNREADABLE)),
        (answer_with(200, b"x" * (MAX_RESPONSE_BYTES + 1)), ProviderError(_TEMPORARY, _UNREADABLE)),
        (answer_with(404, b"Not Found"), ProviderError(_UNKNOWN, _UNREADABLE)),
        (answer_with(302, b""), ProviderError(_UNKNOWN, _UNREADABLE)),
        (_account_set_answer(conn_id="CON-not-listed"), ProviderError(_TEMPORARY, _UNREADABLE)),
        (_account_set_answer(balance_date=10**20), ProviderError(_TEMPORARY, _UNREADABLE)),
    ],
    ids=["5xx", "connection-failed", "not-json", "too-large", "other-status", "redirect", "unlisted-login", "stamp-out-of-range"],
)
async def test_failed_request_fails_every_account_with_its_typed_error(respond, error):
    """A server error, a transport failure, an unusable body or an unexpected status keeps nothing from the response"""
    result = await _fetch(simplefin_adapter(RecordingBridge(respond).transport))

    assert result.request_error == error
    assert result.accounts == ()


async def test_access_url_on_a_server_no_longer_allowed_fails_without_reading_as_rejected():
    """The environment no longer allows the connection's server, or a development instance allows only its fake Bridge

    Nothing is sent, and the failure isn't a rejected credential. That would stop the connection
    and email its owner to reconnect, a real user included on a development instance restored from
    production
    """
    bridge = RecordingBridge()

    result = await _fetch(simplefin_adapter(bridge.transport), "https://user:pass@intranet.example/simplefin")

    assert result.request_error == ProviderError(_UNKNOWN, "This Lumina Finance server is not set up to contact intranet.example")
    assert bridge.requests == []


async def test_bridge_whose_name_never_resolves_couldnt_be_reached(monkeypatch):
    """A lookup that runs out of time never reached the Bridge, so it reads as unreachable rather than slow"""
    monkeypatch.setattr(outbound, "REQUEST_TIMEOUT", httpx.Timeout(30.0, connect=0.05))

    async def hang(host: str, port: int) -> list[IpAddress]:
        """Never answer, as a resolver whose server has gone quiet"""
        await asyncio.Event().wait()
        return []

    bridge = RecordingBridge()
    adapter = SimpleFinAdapter(OutboundGuard([SIMPLEFIN_BRIDGE_ORIGIN], resolve=hang, transport=bridge.transport))

    # Bounded, so a lookup left unlimited fails the test rather than hanging it
    async with asyncio.timeout(5):
        result = await _fetch(adapter)

    assert result.request_error == ProviderError(_TEMPORARY, _UNREACHABLE)
    assert bridge.requests == []


async def test_bridge_resolving_privately_is_a_temporary_failure_logged_by_host(caplog):
    """A private DNS answer is refused and retried later, with a warning naming only the host"""
    bridge = RecordingBridge()

    result = await _fetch(simplefin_adapter(bridge.transport, "10.0.4.2"))

    assert result.request_error == ProviderError(_TEMPORARY, _UNREACHABLE)
    assert bridge.requests == []
    [warning] = [record for record in caplog.records if record.levelno == logging.WARNING]
    assert "beta-bridge.simplefin.org" in warning.getMessage()


@pytest.mark.parametrize(
    ("problem", "error"),
    [
        (
            {"code": "gen.auth", "msg": "Your access token is no longer valid. Create a new setup token to reconnect."},
            ProviderError(_CREDENTIAL_REJECTED, "Your access token is no longer valid. Create a new setup token to reconnect."),
        ),
        (
            {"code": "gen.api", "msg": "SimpleFIN Bridge is having trouble right now. Try again later."},
            ProviderError(_TEMPORARY, "SimpleFIN Bridge is having trouble right now. Try again later."),
        ),
        ({"code": "con.auth", "msg": ""}, ProviderError(_BANK_LOGIN_NEEDED, "SimpleFIN Bridge says your bank needs you to sign in again")),
        ({"code": "act.sync", "msg": "An account couldn't be updated."}, ProviderError(_TEMPORARY, "An account couldn't be updated.")),
        (
            {"code": "org.unsupported", "msg": "Harbour Bank is no longer supported."},
            ProviderError(_UNKNOWN, "Harbour Bank is no longer supported."),
        ),
    ],
    ids=["gen-auth", "gen-api", "con-naming-no-login", "act-naming-no-account", "unknown-prefix"],
)
async def test_problem_affecting_the_whole_request_fails_every_account(scenario: FakeBridgeScenario, problem, error):
    """Bridge's own message becomes the reason, or a general one when it sends none"""
    await scenario.add_harbour_accounts()

    result = await _fetch_from(scenario, problem)

    assert result.request_error == error
    assert result.accounts == ()


async def test_most_serious_of_competing_problems_fails_the_request(scenario: FakeBridgeScenario):
    """A rejected credential outranks a Bridge error that came first, since retrying can't fix it"""
    await scenario.add_harbour_accounts()

    result = await _fetch_from(
        scenario,
        {"code": "gen.api", "msg": "SimpleFIN Bridge is having trouble right now. Try again later."},
        {"code": "gen.auth", "msg": "Your access token is no longer valid. Create a new setup token to reconnect."},
    )

    assert result.request_error == ProviderError(
        _CREDENTIAL_REJECTED, "Your access token is no longer valid. Create a new setup token to reconnect."
    )


async def test_problem_without_account_data_fails_every_account(scenario: FakeBridgeScenario):
    """An unknown general code with no accounts beside it is an unknown failure"""
    result = await _fetch_from(scenario, {"code": "gen.maintenance", "msg": "SimpleFIN Bridge is down for maintenance until 02:00 UTC."})

    assert result.request_error == ProviderError(_UNKNOWN, "SimpleFIN Bridge is down for maintenance until 02:00 UTC.")


async def test_quota_warning_without_account_data_is_rate_limited(scenario: FakeBridgeScenario):
    """A quota warning that comes back alone keeps nothing, and the day's requests count as spent"""
    await scenario.add_harbour_accounts()

    result = await _fetch_from(scenario, fault="quota_warning_without_data")

    assert result.request_error == ProviderError(_RATE_LIMITED, _FAKE_QUOTA_WARNING)
    assert result.accounts == ()


@pytest.mark.parametrize("names_an_account", [False, True], ids=["naming-the-login", "naming-the-login-and-an-account"])
async def test_bank_login_problem_stops_only_that_logins_accounts(scenario: FakeBridgeScenario, names_an_account):
    """con.auth for the Harbour Bank login stops Everyday Chequing and Online Savings, even when it names one, while Rewards Visa syncs"""
    await scenario.add_harbour_accounts()
    visa = {"id": "TRN-streaming", "posted": "2026-09-15", "amount": "-15.99", "description": "STREAMFLIX.COM"}
    await scenario.change("POST", "/accounts/ACT-visa/transactions", {"transactions": [visa]})
    problem = {"code": "con.auth", "msg": "Harbour Bank needs you to sign in again.", "conn_id": "CON-harbour"}

    result = await _fetch_from(scenario, problem | ({"account_id": "ACT-chequing"} if names_an_account else {}))

    assert result.request_error is None
    assert result.login_errors == {"CON-harbour": ProviderError(_BANK_LOGIN_NEEDED, "Harbour Bank needs you to sign in again.")}
    assert result.account_errors == {}
    # The fake Bridge repeats the problem in other words in the older errors list, and errlist replaces that
    assert result.warnings == ()
    assert {account.external_id: account.login_key for account in result.accounts} == {
        "ACT-chequing": "CON-harbour",
        "ACT-savings": "CON-harbour",
        "ACT-visa": "CON-harbourline",
    }
    assert [record.external_id for record in result.accounts[2].records] == ["TRN-streaming"]


async def test_bank_login_problem_with_no_accounts_beside_it_still_needs_signing_in(scenario: FakeBridgeScenario):
    """con.auth for Harbour Bank with nothing listed asks for its sign-in, however the older errors list words it"""
    problem = {"code": "con.auth", "msg": "Harbour Bank needs you to sign in again.", "conn_id": "CON-harbour"}

    result = await _fetch_from(scenario, problem)

    assert result.request_error is None
    assert result.login_errors == {"CON-harbour": ProviderError(_BANK_LOGIN_NEEDED, "Harbour Bank needs you to sign in again.")}
    assert result.warnings == ()


async def test_account_problem_fails_only_that_account(scenario: FakeBridgeScenario):
    """An act error for Rewards Visa fails it, and the other accounts sync"""
    await scenario.add_harbour_accounts()
    problem = {"code": "act.sync", "msg": "Rewards Visa couldn't be updated.", "conn_id": "CON-harbourline", "account_id": "ACT-visa"}

    result = await _fetch_from(scenario, problem)

    assert result.request_error is None
    assert result.account_errors == {"ACT-visa": ProviderError(_TEMPORARY, "Rewards Visa couldn't be updated.")}
    assert result.login_errors == {}
    assert len(result.accounts) == 3


async def test_unknown_subcode_takes_its_prefixs_meaning(scenario: FakeBridgeScenario):
    """An unfamiliar con code still needs the bank sign-in, and an unfamiliar act code still fails its account"""
    await scenario.add_harbour_accounts()

    result = await _fetch_from(
        scenario,
        {"code": "con.security_code", "msg": "Harbour Bank wants a security code.", "conn_id": "CON-harbour"},
        {"code": "act.closing", "msg": "Rewards Visa is being closed.", "conn_id": "CON-harbourline", "account_id": "ACT-visa"},
    )

    assert result.login_errors == {"CON-harbour": ProviderError(_BANK_LOGIN_NEEDED, "Harbour Bank wants a security code.")}
    assert result.account_errors == {"ACT-visa": ProviderError(_TEMPORARY, "Rewards Visa is being closed.")}


@pytest.mark.parametrize(
    ("problem", "fault", "warnings"),
    [
        (
            {"code": "gen.maintenance", "msg": "Some banks may be slow to update tonight."},
            None,
            (ProviderError(_UNKNOWN, "Some banks may be slow to update tonight."),),
        ),
        # SimpleFIN's own demo Bridge answers a request over 45 days with the whole history and this note
        (
            {"code": "gen.api", "msg": "Requested date range exceeds recommended range of 45 days. In the future, this may be capped."},
            None,
            (ProviderError(_TEMPORARY, "Requested date range exceeds recommended range of 45 days. In the future, this may be capped."),),
        ),
        # The quota warning is read from both lists, since the older one may be the only one that has it
        (
            None,
            "quota_warning",
            (ProviderError(_RATE_LIMITED, _FAKE_QUOTA_WARNING), ProviderError(_RATE_LIMITED, f"gen.: {_FAKE_QUOTA_WARNING}")),
        ),
    ],
    ids=["unknown-general-code", "range-over-recommended", "quota-warning"],
)
async def test_general_warning_beside_data_keeps_the_data(scenario: FakeBridgeScenario, problem, fault, warnings):
    """An unknown general code, a note about the date range or a quota warning that arrives with accounts is recorded, and they sync"""
    await scenario.add_harbour_accounts()

    result = await _fetch_from(scenario, *([problem] if problem else []), fault=fault)

    assert result.request_error is None
    assert result.warnings == warnings
    assert result.account_errors == {}
    assert result.login_errors == {}
    assert [account.external_id for account in result.accounts] == list(_ALL_ACCOUNTS)


@pytest.mark.parametrize(
    ("message", "kind"),
    [
        ("You have hit today's refresh limit for this token", _RATE_LIMITED),
        ("Rate limit reached. Please wait before refreshing", _RATE_LIMITED),
        ("Harbour Bank needs you to sign in again.", _UNKNOWN),
    ],
    ids=["refresh-limit", "rate-limit", "sign-in"],
)
async def test_message_only_in_the_older_errors_list_is_a_warning_beside_the_data(message, kind):
    """Servers that send only plain messages have their quota warnings and other problems kept beside the data"""
    body = {
        "errors": [message],
        "connections": [{"conn_id": "CON-harbour", "name": "Harbour Bank", "org_id": "ORG-harbour"}],
        "accounts": [
            {
                "id": "ACT-chequing",
                "name": "Everyday Chequing",
                "conn_id": "CON-harbour",
                "currency": "USD",
                "balance": "2510.75",
                "balance-date": 1791115200,
            }
        ],
    }

    result = await _fetch(simplefin_adapter(RecordingBridge(_json_answer(body)).transport))

    assert result.warnings == (ProviderError(kind, message),)
    assert [account.external_id for account in result.accounts] == ["ACT-chequing"]


async def test_quota_warning_in_the_older_errors_list_beside_errlist_is_still_recognised():
    """A refresh-limit message only the older list carries, beside a sign-in problem for another login, counts the day as spent"""
    message = "You have hit today's refresh limit for this token"
    body = {
        "errors": [message],
        "errlist": [{"code": "con.auth", "msg": "Harbour Bank needs you to sign in again.", "conn_id": "CON-harbour"}],
        "connections": [
            {"conn_id": "CON-harbour", "name": "Harbour Bank", "org_id": "ORG-harbour"},
            {"conn_id": "CON-harbourline", "name": "Harbourline Card Services", "org_id": "ORG-harbourline"},
        ],
        "accounts": [
            {
                "id": "ACT-visa",
                "name": "Rewards Visa",
                "conn_id": "CON-harbourline",
                "currency": "USD",
                "balance": "-640.12",
                "balance-date": 1791115200,
            }
        ],
    }

    result = await _fetch(simplefin_adapter(RecordingBridge(_json_answer(body)).transport))

    assert result.warnings == (ProviderError(_RATE_LIMITED, message),)
    assert is_quota_spent(result)
    assert result.login_errors == {"CON-harbour": ProviderError(_BANK_LOGIN_NEEDED, "Harbour Bank needs you to sign in again.")}
    assert [account.external_id for account in result.accounts] == ["ACT-visa"]


@pytest.mark.parametrize(
    ("message", "kind"),
    [("Too many requests today. Please make fewer requests.", _RATE_LIMITED), ("Harbour Bank needs you to sign in again.", _UNKNOWN)],
    ids=["quota", "sign-in"],
)
async def test_message_only_in_the_older_errors_list_without_data_fails_the_request(message, kind):
    """A plain message that comes back alone keeps nothing, and a quota one counts the day's requests as spent"""
    body = {"errors": [message], "connections": [], "accounts": []}

    result = await _fetch(simplefin_adapter(RecordingBridge(_json_answer(body)).transport))

    assert result.request_error == ProviderError(kind, message)
    assert result.warnings == ()


async def test_account_left_out_of_the_response_fails(scenario: FakeBridgeScenario):
    """A requested account the response leaves out fails for this sync, while the others proceed"""
    await scenario.add_harbour_accounts()
    await scenario.change("PATCH", "/accounts/ACT-visa", {"hidden": True})

    result = await _fetch_from(scenario)

    assert result.request_error is None
    assert result.account_errors == {"ACT-visa": ProviderError(_TEMPORARY, "SimpleFIN Bridge didn't return this account")}
    assert [account.external_id for account in result.accounts] == ["ACT-chequing", "ACT-savings"]


@pytest.mark.parametrize(
    "body",
    [
        {"errlist": [{"code": "gen.auth", "msg": "x" * 100_000}], "connections": [], "accounts": []},
        {"errors": ["Too many requests. " + "x" * 100_000], "connections": [], "accounts": []},
    ],
    ids=["errlist", "older-errors-list"],
)
async def test_message_longer_than_the_reason_cap_is_cut_short_in_the_failure(body):
    """A bank's 100,000-character message is kept as a reason of 500 characters ending in an ellipsis."""
    result = await _fetch(simplefin_adapter(RecordingBridge(_json_answer(body)).transport))

    assert result.request_error is not None
    assert len(result.request_error.reason) == 500
    assert result.request_error.reason.endswith("…")
