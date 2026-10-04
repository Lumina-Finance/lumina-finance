"""SimpleFIN adapter request tests

Guards what goes over the wire to SimpleFIN Bridge: a claim that reaches only the token's own
server, and accounts requests in protocol version 2 carrying the credentials only as HTTP Basic.
Every request goes through a stand-in transport, never to the real Bridge
"""

import base64
from datetime import UTC, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import pytest

from app.services.bank_sync.providers.contract import ClaimRefused, FetchResult, ProviderUnreachable
from tests.services.bank_sync.stand_ins import RecordingBridge, answer_with, fail_with, simplefin_adapter

_FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "simplefin"
_EXPONENTS = {"USD": 2, "JPY": 0, "BHD": 3}

_CLAIM_URL = "https://beta-bridge.simplefin.org/simplefin/claim/DEMO-CLAIM"
_ACCESS_URL = "https://demo-user:demo-password@beta-bridge.simplefin.org/simplefin"

# Exactly 90 days, from 1 July to 29 September 2026
_WINDOW_START = datetime(2026, 7, 1, tzinfo=UTC)
_WINDOW_END = datetime(2026, 9, 29, tzinfo=UTC)

_SETUP_UNREADABLE_MESSAGE = "That doesn't look like a SimpleFIN setup token. Copy the whole token from SimpleFIN Bridge and try again"


def _setup_token(claim_url: str) -> str:
    """Encode a claim URL the way SimpleFIN Bridge hands out setup tokens"""
    return base64.b64encode(claim_url.encode()).decode()


def _recorded(fixture: str):
    """Return a responder answering with a recorded SimpleFIN response"""
    return answer_with(200, (_FIXTURES / fixture).read_bytes(), "application/json")


async def test_claim_posts_to_the_tokens_url_and_returns_the_access_url():
    """The claim is an empty POST to the decoded URL, and its answer is the credential to store"""
    bridge = RecordingBridge(answer_with(200, f"{_ACCESS_URL}\n".encode()))

    access_url = await simplefin_adapter(bridge).claim(_setup_token(_CLAIM_URL))

    assert access_url == _ACCESS_URL
    [request] = bridge.requests
    assert request.method == "POST"
    assert request.url.path == "/simplefin/claim/DEMO-CLAIM"
    assert request.headers["host"] == "beta-bridge.simplefin.org"
    assert request.headers["content-length"] == "0"
    assert request.headers["user-agent"].startswith("LuminaFinance")


async def test_setup_token_copied_with_line_breaks_and_no_padding_still_claims():
    """Copying a token can wrap it or drop its trailing padding, which doesn't change what it holds"""
    bridge = RecordingBridge(answer_with(200, _ACCESS_URL.encode()))
    token = _setup_token(_CLAIM_URL).rstrip("=")

    await simplefin_adapter(bridge).claim(f"{token[:20]}\n{token[20:]}")

    assert bridge.requests[0].url.path == "/simplefin/claim/DEMO-CLAIM"


@pytest.mark.parametrize(
    "setup_token",
    [
        "not a setup token",
        _setup_token("not a url"),
        _setup_token("http://beta-bridge.simplefin.org/simplefin/claim/DEMO-CLAIM"),
        _setup_token("https://someone:secret@beta-bridge.simplefin.org/simplefin/claim/DEMO-CLAIM"),
    ],
    ids=["not-base64", "not-a-url", "plain-http", "user-info"],
)
async def test_setup_token_that_is_not_a_claim_url_is_refused_before_anything_is_sent(setup_token):
    """Anything but an HTTPS claim URL is refused with the link flow's message"""
    bridge = RecordingBridge()

    with pytest.raises(ClaimRefused) as refusal:
        await simplefin_adapter(bridge).claim(setup_token)

    assert str(refusal.value) == _SETUP_UNREADABLE_MESSAGE
    assert bridge.requests == []


async def test_setup_token_for_a_server_not_added_names_its_host():
    """A token pointing at a server the operator hasn't added is refused before anything is sent"""
    bridge = RecordingBridge()

    with pytest.raises(ClaimRefused) as refusal:
        await simplefin_adapter(bridge).claim(_setup_token("https://intranet.example/simplefin/claim/DEMO-CLAIM"))

    assert str(refusal.value) == "This setup token points to intranet.example, which this Lumina Finance server is not set up to contact"
    assert bridge.requests == []


async def test_setup_token_for_a_host_resolving_privately_is_refused():
    """An allowed host whose name resolves to a private address is refused like one not added"""
    bridge = RecordingBridge()

    with pytest.raises(ClaimRefused) as refusal:
        await simplefin_adapter(bridge, "10.0.4.2").claim(_setup_token(_CLAIM_URL))

    assert str(refusal.value) == (
        "This setup token points to beta-bridge.simplefin.org, which this Lumina Finance server is not set up to contact"
    )
    assert bridge.requests == []


async def test_used_setup_token_is_refused():
    """SimpleFIN answers a used or unknown token with a plain 403"""
    bridge = RecordingBridge(answer_with(403, b"Forbidden"))

    with pytest.raises(ClaimRefused) as refusal:
        await simplefin_adapter(bridge).claim(_setup_token(_CLAIM_URL))

    assert str(refusal.value) == "This setup token has already been used. Create a new one in SimpleFIN Bridge"


@pytest.mark.parametrize(
    "respond",
    [
        answer_with(403, b"<!DOCTYPE html><title>Access denied</title>", "text/html"),
        answer_with(502, b"Bad gateway"),
        answer_with(200, b"<html><body>Maintenance</body></html>", "text/html"),
        answer_with(200, b"OK"),
        fail_with(httpx.ReadTimeout),
        fail_with(httpx.ConnectError),
    ],
    ids=["html-403", "5xx", "html-200", "not-an-access-url", "timeout", "connection-failed"],
)
async def test_claim_without_a_usable_answer_reports_the_bridge_unreachable(respond):
    """An edge error page, a server error, a timeout or a body that isn't an Access URL can't be claimed"""
    with pytest.raises(ProviderUnreachable):
        await simplefin_adapter(RecordingBridge(respond)).claim(_setup_token(_CLAIM_URL))


async def test_access_url_for_a_server_not_added_is_refused():
    """A claim answering with an Access URL elsewhere is refused, since no request could follow it"""
    bridge = RecordingBridge(answer_with(200, b"https://user:pass@intranet.example/simplefin"))

    with pytest.raises(ClaimRefused) as refusal:
        await simplefin_adapter(bridge).claim(_setup_token(_CLAIM_URL))

    assert str(refusal.value) == "This setup token points to intranet.example, which this Lumina Finance server is not set up to contact"


async def _fetch_window(bridge: RecordingBridge, start: datetime, end: datetime, *, include_pending: bool = True) -> FetchResult:
    """Fetch Everyday Chequing and Rewards Visa over a window for a user in Los Angeles"""
    return await simplefin_adapter(bridge).fetch(
        _ACCESS_URL,
        account_ids=["ACT-chequing", "ACT-visa"],
        start=start,
        end=end,
        include_pending=include_pending,
        timezone=ZoneInfo("America/Los_Angeles"),
        currency_exponents=_EXPONENTS,
    )


async def test_fetch_asks_for_the_window_for_chosen_accounts():
    """One request covers the window for the chosen accounts, and a past window asks for no pending records"""
    bridge = RecordingBridge(_recorded("accounts.json"))

    result = await _fetch_window(bridge, _WINDOW_START, _WINDOW_END)

    [request] = bridge.requests
    assert request.url.path == "/simplefin/accounts"
    assert request.url.params.multi_items() == [
        ("version", "2"),
        ("start-date", "1782864000"),
        ("end-date", "1790640000"),
        ("account", "ACT-chequing"),
        ("account", "ACT-visa"),
    ]
    assert result.request_error is None
    assert result.accounts[0].records[0].external_id == "TRN-coffee"


@pytest.mark.parametrize(("include_pending", "asks_for_pending"), [(True, True), (False, False)])
async def test_window_reaching_today_asks_for_pending_records_when_wanted(include_pending, asks_for_pending):
    """Only the window that ends today sends pending=1, and only when the sync wants pending records"""
    bridge = RecordingBridge(_recorded("accounts.json"))

    # Ending a minute ahead keeps the window reaching today even if midnight passes mid-test
    end = datetime.now(UTC) + timedelta(minutes=1)

    await _fetch_window(bridge, end - timedelta(days=30), end, include_pending=include_pending)

    [request] = bridge.requests
    assert (("pending", "1") in request.url.params.multi_items()) is asks_for_pending


async def test_every_accounts_request_carries_the_version_a_user_agent_and_basic_credentials():
    """Discovery and fetch both send the Access URL's user info as HTTP Basic, never in the URL"""
    bridge = RecordingBridge(_recorded("balances.json"))

    await simplefin_adapter(bridge).discover(_ACCESS_URL, currency_exponents=_EXPONENTS)
    await _fetch_window(bridge, _WINDOW_START, _WINDOW_END)

    assert len(bridge.requests) == 2
    for request in bridge.requests:
        assert request.url.params["version"] == "2"
        assert request.headers["authorization"] == "Basic " + base64.b64encode(b"demo-user:demo-password").decode()
        assert not request.url.userinfo
        assert "demo-password" not in str(request.url)
        assert request.headers["user-agent"].startswith("LuminaFinance")


async def test_discovery_asks_for_balances_only():
    """Discovery lists every account with its balance and no transactions"""
    bridge = RecordingBridge(_recorded("balances.json"))

    result = await simplefin_adapter(bridge).discover(_ACCESS_URL, currency_exponents=_EXPONENTS)

    [request] = bridge.requests
    assert request.url.params.multi_items() == [("version", "2"), ("balances-only", "1")]
    assert [(account.external_id, account.balance) for account in result.accounts] == [
        ("ACT-chequing", 251075),
        ("ACT-visa", -64012),
    ]


_TORONTO = ZoneInfo("America/Toronto")


@pytest.mark.parametrize(
    ("start", "end"),
    [
        (_WINDOW_START, _WINDOW_END + timedelta(seconds=1)),
        # 90 days on the clock, but clocks go back on 1 November, so 90 days and an hour elapse
        (datetime(2026, 9, 1, tzinfo=_TORONTO), datetime(2026, 11, 30, tzinfo=_TORONTO)),
        (_WINDOW_START, _WINDOW_START),
        (datetime(2026, 7, 1), datetime(2026, 7, 31)),
    ],
    ids=["over-90-days", "over-90-days-across-a-clock-change", "empty", "naive"],
)
async def test_window_the_bridge_would_refuse_is_refused_before_sending(start, end):
    """SimpleFIN Bridge refuses more than 90 days of elapsed time, so the adapter never asks for it"""
    bridge = RecordingBridge()

    with pytest.raises(ValueError, match="SimpleFIN window"):
        await _fetch_window(bridge, start, end)

    assert bridge.requests == []
