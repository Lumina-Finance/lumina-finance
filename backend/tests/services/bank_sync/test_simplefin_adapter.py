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

from app.services.bank_sync.outbound import OutboundGuard
from app.services.bank_sync.providers.contract import ClaimRefused, ProviderUnreachable
from app.services.bank_sync.providers.simplefin.adapter import SimpleFinAdapter
from tests.services.bank_sync.stand_ins import PUBLIC_ADDRESS, FixedResolver, RecordingBridge

_FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "simplefin"
_EXPONENTS = {"USD": 2, "JPY": 0, "BHD": 3}

_BRIDGE_ORIGIN = "https://beta-bridge.simplefin.org"
_CLAIM_URL = "https://beta-bridge.simplefin.org/simplefin/claim/DEMO-CLAIM"
_ACCESS_URL = "https://demo-user:demo-password@beta-bridge.simplefin.org/simplefin"

# Exactly 90 days, from 1 July to 29 September 2026
_WINDOW_START = datetime(2026, 7, 1, tzinfo=UTC)
_WINDOW_END = datetime(2026, 9, 29, tzinfo=UTC)

_SETUP_UNREADABLE_MESSAGE = "That doesn't look like a SimpleFIN setup token. Copy the whole token from SimpleFIN Bridge and try again"


def _setup_token(claim_url: str) -> str:
    """Encode a claim URL the way SimpleFIN Bridge hands out setup tokens"""
    return base64.b64encode(claim_url.encode()).decode()


def _adapter(bridge: RecordingBridge, *addresses: str) -> SimpleFinAdapter:
    """Return an adapter whose guard allows the Bridge and resolves every host to the addresses"""
    resolver = FixedResolver(*(addresses or (PUBLIC_ADDRESS,)))
    return SimpleFinAdapter(OutboundGuard([_BRIDGE_ORIGIN], resolve=resolver, transport=bridge.transport))


def _answer_with(status: int, body: bytes, content_type: str = "text/plain"):
    """Return a responder answering every request alike"""
    return lambda _request: httpx.Response(status, content=body, headers={"Content-Type": content_type})


def _recorded(fixture: str):
    """Return a responder answering with a recorded SimpleFIN response"""
    return _answer_with(200, (_FIXTURES / fixture).read_bytes(), "application/json")


async def test_claim_posts_to_the_tokens_url_and_returns_the_access_url():
    """The claim is an empty POST to the decoded URL, and its answer is the credential to store"""
    bridge = RecordingBridge(_answer_with(200, f"{_ACCESS_URL}\n".encode()))

    access_url = await _adapter(bridge).claim(_setup_token(_CLAIM_URL))

    assert access_url == _ACCESS_URL
    [request] = bridge.requests
    assert request.method == "POST"
    assert request.url.path == "/simplefin/claim/DEMO-CLAIM"
    assert request.headers["host"] == "beta-bridge.simplefin.org"
    assert request.headers["content-length"] == "0"
    assert request.headers["user-agent"].startswith("LuminaFinance")


async def test_setup_token_copied_with_line_breaks_and_no_padding_still_claims():
    """Copying a token can wrap it or drop its trailing padding, which doesn't change what it holds"""
    bridge = RecordingBridge(_answer_with(200, _ACCESS_URL.encode()))
    token = _setup_token(_CLAIM_URL).rstrip("=")

    await _adapter(bridge).claim(f"{token[:20]}\n{token[20:]}")

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
        await _adapter(bridge).claim(setup_token)

    assert str(refusal.value) == _SETUP_UNREADABLE_MESSAGE
    assert bridge.requests == []


async def test_setup_token_for_a_server_not_added_names_its_host():
    """A token pointing at a server the operator hasn't added is refused before anything is sent"""
    bridge = RecordingBridge()

    with pytest.raises(ClaimRefused) as refusal:
        await _adapter(bridge).claim(_setup_token("https://intranet.example/simplefin/claim/DEMO-CLAIM"))

    assert str(refusal.value) == "This setup token points to intranet.example, which this Lumina Finance server is not set up to contact"
    assert bridge.requests == []


async def test_setup_token_for_a_host_resolving_privately_is_refused():
    """An allowed host whose name resolves to a private address is refused like one not added"""
    bridge = RecordingBridge()

    with pytest.raises(ClaimRefused) as refusal:
        await _adapter(bridge, "10.0.4.2").claim(_setup_token(_CLAIM_URL))

    assert str(refusal.value) == (
        "This setup token points to beta-bridge.simplefin.org, which this Lumina Finance server is not set up to contact"
    )
    assert bridge.requests == []


async def test_used_setup_token_is_refused():
    """SimpleFIN answers a used or unknown token with a plain 403"""
    bridge = RecordingBridge(_answer_with(403, b"Forbidden"))

    with pytest.raises(ClaimRefused) as refusal:
        await _adapter(bridge).claim(_setup_token(_CLAIM_URL))

    assert str(refusal.value) == "This setup token has already been used. Create a new one in SimpleFIN Bridge"


def _raise(error: type[httpx.TransportError]):
    """Return a responder failing every request with a transport error"""

    def fail(request: httpx.Request) -> httpx.Response:
        """Fail the request the way the network would"""
        raise error("failed", request=request)

    return fail


@pytest.mark.parametrize(
    "respond",
    [
        _answer_with(403, b"<!DOCTYPE html><title>Access denied</title>", "text/html"),
        _answer_with(502, b"Bad gateway"),
        _answer_with(200, b"<html><body>Maintenance</body></html>", "text/html"),
        _answer_with(200, b"OK"),
        _raise(httpx.ReadTimeout),
        _raise(httpx.ConnectError),
    ],
    ids=["html-403", "5xx", "html-200", "not-an-access-url", "timeout", "connection-failed"],
)
async def test_claim_without_a_usable_answer_reports_the_bridge_unreachable(respond):
    """An edge error page, a server error, a timeout or a body that isn't an Access URL can't be claimed"""
    with pytest.raises(ProviderUnreachable):
        await _adapter(RecordingBridge(respond)).claim(_setup_token(_CLAIM_URL))


async def test_access_url_for_a_server_not_added_is_refused():
    """A claim answering with an Access URL elsewhere is refused, since no request could follow it"""
    bridge = RecordingBridge(_answer_with(200, b"https://user:pass@intranet.example/simplefin"))

    with pytest.raises(ClaimRefused) as refusal:
        await _adapter(bridge).claim(_setup_token(_CLAIM_URL))

    assert str(refusal.value) == "This setup token points to intranet.example, which this Lumina Finance server is not set up to contact"


@pytest.mark.parametrize("include_pending", [False, True])
async def test_fetch_asks_for_version_2_over_the_window_for_chosen_accounts(include_pending):
    """One request covers the window for the chosen accounts, asking for pending items only when told"""
    bridge = RecordingBridge(_recorded("accounts.json"))

    result = await _adapter(bridge).fetch(
        _ACCESS_URL,
        account_ids=["ACT-chequing", "ACT-visa"],
        start=_WINDOW_START,
        end=_WINDOW_END,
        include_pending=include_pending,
        timezone=ZoneInfo("America/Los_Angeles"),
        currency_exponents=_EXPONENTS,
    )

    [request] = bridge.requests
    assert request.url.path == "/simplefin/accounts"
    assert request.url.params.multi_items() == [
        ("version", "2"),
        ("start-date", "1782864000"),
        ("end-date", "1790640000"),
        *([("pending", "1")] if include_pending else []),
        ("account", "ACT-chequing"),
        ("account", "ACT-visa"),
    ]
    assert result.request_error is None
    assert result.accounts[0].records[0].external_id == "TRN-coffee"


async def test_requests_carry_the_credentials_only_as_http_basic():
    """The Access URL's user info is sent as an Authorization header, never in the URL"""
    bridge = RecordingBridge(_recorded("balances.json"))

    await _adapter(bridge).discover(_ACCESS_URL, currency_exponents=_EXPONENTS)

    [request] = bridge.requests
    assert request.headers["authorization"] == "Basic " + base64.b64encode(b"demo-user:demo-password").decode()
    assert not request.url.userinfo
    assert "demo-password" not in str(request.url)
    assert request.headers["user-agent"].startswith("LuminaFinance")


async def test_discovery_asks_for_balances_only():
    """Discovery lists every account with its balance and no transactions"""
    bridge = RecordingBridge(_recorded("balances.json"))

    result = await _adapter(bridge).discover(_ACCESS_URL, currency_exponents=_EXPONENTS)

    [request] = bridge.requests
    assert request.url.params.multi_items() == [("version", "2"), ("balances-only", "1")]
    assert [(account.external_id, account.balance) for account in result.accounts] == [
        ("ACT-chequing", 251075),
        ("ACT-visa", -64012),
    ]


async def test_window_longer_than_90_days_is_refused_before_sending():
    """SimpleFIN Bridge refuses a longer window, so the adapter never asks for one"""
    bridge = RecordingBridge()

    with pytest.raises(ValueError, match="90 days"):
        await _adapter(bridge).fetch(
            _ACCESS_URL,
            account_ids=["ACT-chequing"],
            start=_WINDOW_START,
            end=_WINDOW_END + timedelta(seconds=1),
            include_pending=False,
            timezone=ZoneInfo("America/Los_Angeles"),
            currency_exponents=_EXPONENTS,
        )

    assert bridge.requests == []
