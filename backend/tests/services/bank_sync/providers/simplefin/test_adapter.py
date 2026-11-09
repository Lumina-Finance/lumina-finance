"""SimpleFIN adapter request tests

Guards the claim and the accounts requests: a claim reaches only the token's own server and
returns an Access URL that works, and accounts requests ask for the right window and accounts in
protocol version 2 with the credentials only as HTTP Basic. Requests go to the in-process fake
SimpleFIN Bridge, or to a recording stand-in where a test checks the wire itself, never to the
real Bridge
"""

import base64
import logging
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
import pytest

from app.services.bank_sync import outbound
from app.services.bank_sync.providers.contract import ClaimRefused, FetchResult, ProviderUnreachable
from app.services.bank_sync.providers.simplefin.adapter import SimpleFinAdapter
from tests.fake_simplefin_bridge import FakeBridgeTransport
from tests.services.bank_sync.providers.simplefin.stand_ins import ACCESS_URL, FakeBridgeScenario, simplefin_adapter
from tests.services.bank_sync.stand_ins import RecordingBridge, answer_with, fail_with

_EXPONENTS = {"USD": 2}

_CLAIM_URL = "https://beta-bridge.simplefin.org/simplefin/claim/DEMO-CLAIM"

_LOS_ANGELES = ZoneInfo("America/Los_Angeles")
_TORONTO = ZoneInfo("America/Toronto")

# Exactly 90 days, from 1 July to 29 September 2026
_WINDOW_START = datetime(2026, 7, 1, tzinfo=UTC)
_WINDOW_END = datetime(2026, 9, 29, tzinfo=UTC)

_SETUP_UNREADABLE_MESSAGE = "That doesn't look like a SimpleFIN setup token. Copy the whole token from SimpleFIN Bridge and try again"
_SETUP_ALREADY_USED_MESSAGE = "This setup token has already been used. Create a new one in SimpleFIN Bridge"


def _setup_token(claim_url: str) -> str:
    """Encode a claim URL the way SimpleFIN Bridge hands out setup tokens"""
    return base64.b64encode(claim_url.encode()).decode()


def _fake_adapter() -> SimpleFinAdapter:
    """Return an adapter whose requests reach the in-process fake SimpleFIN Bridge"""
    return simplefin_adapter(FakeBridgeTransport())


async def _fetch(
    adapter: SimpleFinAdapter,
    start: datetime,
    end: datetime,
    *,
    access_url: str = ACCESS_URL,
    include_pending: bool = True,
) -> FetchResult:
    """Fetch Everyday Chequing and Rewards Visa over a window for a user in Los Angeles"""
    return await adapter.fetch(
        access_url,
        account_ids=["ACT-chequing", "ACT-visa"],
        start=start,
        end=end,
        include_pending=include_pending,
        timezone=_LOS_ANGELES,
        currency_exponents=_EXPONENTS,
    )


async def test_claim_returns_an_access_url_that_reaches_the_users_accounts(scenario: FakeBridgeScenario):
    """The claimed Access URL is the stored credential, and discovery through it lists every account with its balance"""
    await scenario.add_harbour_accounts()
    adapter = _fake_adapter()

    access_url = await adapter.claim_setup_token(scenario.setup_token)
    result = await adapter.discover(access_url, currency_exponents=_EXPONENTS)

    assert httpx.URL(access_url).host == "beta-bridge.simplefin.org"
    assert result.request_error is None
    assert [(account.external_id, account.login_key, account.balance) for account in result.accounts] == [
        ("ACT-chequing", "CON-harbour", 251075),
        ("ACT-savings", "CON-harbour", 820000),
        ("ACT-visa", "CON-harbourline", -64012),
    ]


async def test_setup_token_copied_with_line_breaks_and_no_padding_still_claims(scenario: FakeBridgeScenario):
    """Copying a token can wrap it or drop its trailing padding. Neither changes what it holds"""
    token = scenario.setup_token.rstrip("=")

    access_url = await _fake_adapter().claim_setup_token(f"{token[:20]}\n{token[20:]}")

    assert httpx.URL(access_url).password


async def test_claimed_setup_token_is_refused_the_second_time(scenario: FakeBridgeScenario):
    """SimpleFIN Bridge answers a spent token with a plain 403. The link flow explains it"""
    await _fake_adapter().claim_setup_token(scenario.setup_token)

    with pytest.raises(ClaimRefused) as refusal:
        await _fake_adapter().claim_setup_token(scenario.setup_token)

    assert str(refusal.value) == _SETUP_ALREADY_USED_MESSAGE


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
        await simplefin_adapter(bridge.transport).claim_setup_token(setup_token)

    assert str(refusal.value) == _SETUP_UNREADABLE_MESSAGE
    assert bridge.requests == []


async def test_setup_token_for_a_server_not_added_names_its_host():
    """A token pointing at a server the environment hasn't added is refused before anything is sent"""
    bridge = RecordingBridge()

    with pytest.raises(ClaimRefused) as refusal:
        await simplefin_adapter(bridge.transport).claim_setup_token(_setup_token("https://intranet.example/simplefin/claim/DEMO-CLAIM"))

    assert str(refusal.value) == "This setup token points to intranet.example, and this Lumina Finance server is not set up to contact it"
    assert bridge.requests == []


async def test_setup_token_for_a_host_resolving_privately_is_refused_and_logged_by_host(caplog):
    """An allowed host resolving to a private address is refused like one not added, with a warning naming only the host"""
    caplog.set_level(logging.DEBUG)
    bridge = RecordingBridge()
    claim_url = "https://beta-bridge.simplefin.org/simplefin/claim/CLAIM-PATH-5e1d"

    with pytest.raises(ClaimRefused) as refusal:
        await simplefin_adapter(bridge.transport, "10.0.4.2").claim_setup_token(_setup_token(claim_url))

    assert str(refusal.value) == (
        "This setup token points to beta-bridge.simplefin.org, and this Lumina Finance server is not set up to contact it"
    )
    assert bridge.requests == []
    [warning] = [record for record in caplog.records if record.levelno == logging.WARNING]
    assert "beta-bridge.simplefin.org" in warning.getMessage()
    assert "CLAIM-PATH-5e1d" not in caplog.text


@pytest.mark.parametrize(
    "fault",
    [{"kind": "html_error"}, {"kind": "rate_limited"}, {"kind": "timeout"}],
    ids=["html-403", "429", "timeout"],
)
async def test_claim_meeting_a_bridge_fault_reports_the_bridge_unreachable(scenario: FakeBridgeScenario, monkeypatch, fault):
    """An edge error page, a refusal that isn't about the token, or no answer in time leaves nothing claimed"""
    # Short enough that the timeout fault doesn't hold the test for the full read timeout
    monkeypatch.setattr(outbound, "REQUEST_TIMEOUT", httpx.Timeout(1.0, connect=5.0))
    await scenario.change("PUT", "/fault", fault)

    with pytest.raises(ProviderUnreachable):
        await _fake_adapter().claim_setup_token(scenario.setup_token)


async def test_claim_meeting_a_payment_problem_names_it(scenario: FakeBridgeScenario):
    """A 402 is something the user can settle with SimpleFIN Bridge, so the claim says so"""
    await scenario.change("PUT", "/fault", {"kind": "payment_required"})

    with pytest.raises(ClaimRefused) as refusal:
        await _fake_adapter().claim_setup_token(scenario.setup_token)

    assert str(refusal.value) == "SimpleFIN Bridge reports a payment problem"


@pytest.mark.parametrize(
    "respond",
    [
        answer_with(502, b"Bad gateway"),
        answer_with(200, b"<html><body>Maintenance</body></html>", "text/html"),
        answer_with(200, b"OK"),
        fail_with(httpx.ConnectError),
    ],
    ids=["5xx", "html-200", "not-an-access-url", "connection-failed"],
)
async def test_claim_without_a_usable_answer_reports_the_bridge_unreachable(respond):
    """A server error, a connection failure or a body that isn't an Access URL can't be claimed"""
    with pytest.raises(ProviderUnreachable):
        await simplefin_adapter(RecordingBridge(respond).transport).claim_setup_token(_setup_token(_CLAIM_URL))


async def test_access_url_for_a_server_not_added_is_refused():
    """A claim answering with an Access URL elsewhere is refused, since no request could follow it"""
    bridge = RecordingBridge(answer_with(200, b"https://user:pass@intranet.example/simplefin"))

    with pytest.raises(ClaimRefused) as refusal:
        await simplefin_adapter(bridge.transport).claim_setup_token(_setup_token(_CLAIM_URL))

    assert str(refusal.value) == "This setup token points to intranet.example, and this Lumina Finance server is not set up to contact it"


@pytest.mark.usefixtures("frozen_now")
async def test_fetch_returns_only_the_chosen_accounts_records_in_the_window(scenario: FakeBridgeScenario):
    """The Bridge gets one request naming the chosen accounts and the window, and a fetch not asking for pending records brings none"""
    await scenario.add_harbour_accounts()
    transactions = [
        {"id": "TRN-in-window", "posted": "2026-09-15", "amount": "-4.50", "description": "POS 4411 BLUE BOTTLE SF"},
        {"id": "TRN-before-window", "posted": "2026-06-30", "amount": "-8.00", "description": "PARKING"},
        {"id": "TRN-pending", "pending": True, "amount": "-23.10", "description": "GROCER"},
    ]
    await scenario.change("POST", "/accounts/ACT-chequing/transactions", {"transactions": transactions})
    savings = {"id": "TRN-savings", "posted": "2026-09-15", "amount": "1.25", "description": "INTEREST"}
    await scenario.change("POST", "/accounts/ACT-savings/transactions", {"transactions": [savings]})
    adapter = _fake_adapter()

    result = await _fetch(
        adapter, _WINDOW_START, _WINDOW_END, access_url=await adapter.claim_setup_token(scenario.setup_token), include_pending=False
    )

    assert result.request_error is None
    assert {account.external_id: [record.external_id for record in account.records] for account in result.accounts} == {
        "ACT-chequing": ["TRN-in-window"],
        "ACT-visa": [],
    }


async def test_window_of_exactly_90_days_across_a_clock_change_is_served(scenario: FakeBridgeScenario):
    """90 days of elapsed time is within the Bridge's limit, though clocks going forward on 8 March show an hour more"""
    await scenario.add_harbour_accounts()
    adapter = _fake_adapter()

    result = await _fetch(
        adapter,
        datetime(2026, 3, 1, tzinfo=_TORONTO),
        datetime(2026, 5, 30, 1, tzinfo=_TORONTO),
        access_url=await adapter.claim_setup_token(scenario.setup_token),
    )

    assert result.request_error is None
    assert [account.external_id for account in result.accounts] == ["ACT-chequing", "ACT-visa"]


async def test_account_in_a_currency_lumina_doesnt_hold_stores_no_amounts(scenario: FakeBridgeScenario):
    """With no exponent for KWD, its balances and amounts are kept as sent and never read at a guessed precision"""
    await scenario.change("POST", "/connections", {"conn_id": "CON-gulf", "name": "Gulf Bank", "org_id": "ORG-gulf"})
    account = {
        "id": "ACT-chequing",
        "name": "Dinar Current",
        "conn_id": "CON-gulf",
        "currency": "KWD",
        "balance": "125.500",
        "available_balance": "100.250",
        "balance_date": 1791115200,
    }
    await scenario.change("POST", "/accounts", account)
    transaction = {"id": "TRN-dinar", "posted": "2026-09-15", "amount": "-1.250", "description": "TALABAT"}
    await scenario.change("POST", "/accounts/ACT-chequing/transactions", {"transactions": [transaction]})
    adapter = _fake_adapter()

    result = await _fetch(adapter, _WINDOW_START, _WINDOW_END, access_url=await adapter.claim_setup_token(scenario.setup_token))

    [dinar] = result.accounts
    assert (dinar.currency, dinar.balance, dinar.available_balance) == ("KWD", None, None)
    assert [(record.amount, record.raw_amount) for record in dinar.records] == [(None, "-1.250")]


@pytest.mark.parametrize(
    ("booked", "pending", "cut_off"),
    [(999, 0, False), (1000, 0, True), (999, 1, True)],
    ids=["999-booked", "1000-booked", "999-booked-and-1-pending"],
)
async def test_fetch_holding_1000_transactions_may_be_cut_off(scenario: FakeBridgeScenario, frozen_now: datetime, booked, pending, cut_off):
    """SimpleFIN has no paging, so a fetch holding 1,000 transactions, pending ones included, can't be taken as complete"""
    await scenario.add_harbour_accounts()
    transactions = [{"posted": "2026-09-15", "amount": "-1.00", "description": "COFFEE"}] * booked
    transactions += [{"pending": True, "amount": "-5.00", "description": "HOLD"}] * pending
    await scenario.change("POST", "/accounts/ACT-chequing/transactions", {"transactions": transactions})
    adapter = _fake_adapter()

    # A window ending today. A sync asks for pending transactions with it
    result = await _fetch(
        adapter, frozen_now - timedelta(days=30), frozen_now, access_url=await adapter.claim_setup_token(scenario.setup_token)
    )

    assert sum(len(account.records) for account in result.accounts) == booked + pending
    assert result.possibly_cut_off is cut_off


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
        await _fetch(simplefin_adapter(bridge.transport), start, end)

    assert bridge.requests == []


async def test_claim_is_an_empty_post_naming_lumina_finance():
    """The claim is an empty POST to the decoded URL under the Bridge's own host name"""
    bridge = RecordingBridge(answer_with(200, f"{ACCESS_URL}\n".encode()))

    access_url = await simplefin_adapter(bridge.transport).claim_setup_token(_setup_token(_CLAIM_URL))

    assert access_url == ACCESS_URL
    [request] = bridge.requests
    assert request.method == "POST"
    assert request.url.path == "/simplefin/claim/DEMO-CLAIM"
    assert request.headers["host"] == "beta-bridge.simplefin.org"
    assert request.headers["content-length"] == "0"
    assert request.headers["user-agent"].startswith("LuminaFinance")


async def test_every_accounts_request_carries_the_version_a_user_agent_and_basic_credentials():
    """Discovery and fetch both send the Access URL's user info as HTTP Basic, never in the URL"""
    bridge = RecordingBridge()
    adapter = simplefin_adapter(bridge.transport)

    await adapter.discover(ACCESS_URL, currency_exponents=_EXPONENTS)
    await _fetch(adapter, _WINDOW_START, _WINDOW_END)

    assert len(bridge.requests) == 2
    for request in bridge.requests:
        assert request.url.path == "/simplefin/accounts"
        assert request.url.params["version"] == "2"
        assert request.headers["authorization"] == "Basic " + base64.b64encode(b"demo-user:demo-password").decode()
        assert not request.url.userinfo
        assert "demo-password" not in str(request.url)
        assert request.headers["user-agent"].startswith("LuminaFinance")


async def test_requests_ask_for_balances_only_or_for_the_window_in_epoch_seconds():
    """Discovery asks for balances only, and a fetch for the chosen accounts between its start and end in epoch seconds"""
    bridge = RecordingBridge()
    adapter = simplefin_adapter(bridge.transport)

    await adapter.discover(ACCESS_URL, currency_exponents=_EXPONENTS)
    await _fetch(adapter, _WINDOW_START, _WINDOW_END, include_pending=False)

    discovery, fetch = bridge.requests
    assert sorted(discovery.url.params.multi_items()) == [("balances-only", "1"), ("version", "2")]
    assert sorted(fetch.url.params.multi_items()) == [
        ("account", "ACT-chequing"),
        ("account", "ACT-visa"),
        ("end-date", "1790640000"),
        ("start-date", "1782864000"),
        ("version", "2"),
    ]


# Midnight starting the frozen day for a user in Los Angeles, a day behind UTC's
_TODAY_STARTS = datetime(2026, 10, 3, tzinfo=_LOS_ANGELES)


@pytest.mark.parametrize("include_pending", [True, False], ids=["wanted", "not-wanted"])
@pytest.mark.usefixtures("frozen_now")
async def test_fetch_asks_for_pending_records_exactly_when_the_sync_wants_them(include_pending):
    """The window ends at the midnight starting 3 October, as one from a sync that fixed 2 October as today and sent after midnight does

    The adapter's own clock reads 3 October, but the sync owns today, so pending=1 goes whenever it
    asks and never otherwise
    """
    bridge = RecordingBridge()

    await _fetch(simplefin_adapter(bridge.transport), _TODAY_STARTS - timedelta(days=30), _TODAY_STARTS, include_pending=include_pending)

    [request] = bridge.requests
    assert (("pending", "1") in request.url.params.multi_items()) is include_pending


async def test_pending_record_without_a_time_is_dated_the_users_today(scenario: FakeBridgeScenario, frozen_now: datetime):
    """At 8 pm on 3 October in Los Angeles it is already 4 October in UTC, and the record takes the user's 3 October"""
    await scenario.add_harbour_accounts()
    hold = {"id": "TRN-hold", "pending": True, "amount": "-23.10", "description": "GROCER"}
    await scenario.change("POST", "/accounts/ACT-chequing/transactions", {"transactions": [hold]})
    adapter = _fake_adapter()

    result = await _fetch(
        adapter, frozen_now - timedelta(days=30), frozen_now, access_url=await adapter.claim_setup_token(scenario.setup_token)
    )

    [record] = result.accounts[0].records
    assert (record.external_id, record.pending, record.date) == ("TRN-hold", True, date(2026, 10, 3))
