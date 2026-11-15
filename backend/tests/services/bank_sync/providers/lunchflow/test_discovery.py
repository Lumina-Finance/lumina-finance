"""Lunch Flow discovery tests

Guards what listing a key's accounts tells the sync engine: every account with its balance, the
connection and institution that identify it, and a reason for each account that can't be synced, so
an account whose balance failed is never taken for one that vanished
"""

from datetime import UTC, datetime

import httpx

from app.models.bank_sync_job import ProviderErrorKind
from tests.services.bank_sync.providers.lunchflow.stand_ins import (
    API_KEY,
    LunchFlowApi,
    account,
    accounts_body,
    balance_body,
    json_response,
    lunchflow_adapter,
)

_EXPONENTS = {"CAD": 2, "JPY": 0}


async def test_discovery_lists_each_account_with_its_balance_connection_and_institution():
    """The login is the connection, the institution key its name, the balance is read now, and nothing else Lunch Flow sends is kept"""
    chequing = account(11, connection_id=7)
    visa = account(12, connection_id=8, name="Rewards Visa", institution="Harbourline Cards")
    yen = account(13, connection_id=7, name="Tokyo Savings", currency="JPY")
    api = LunchFlowApi().serve("/accounts", accounts_body(chequing, visa, yen))
    api.serve_account(chequing, balance="2510.75").serve_account(visa, balance="-640.1").serve_account(yen, balance="120000")

    before = datetime.now(UTC)
    result = await lunchflow_adapter(api.transport).discover(API_KEY, currency_exponents=_EXPONENTS)
    after = datetime.now(UTC)

    assert result.request_error is None
    assert result.account_errors == {}
    assert result.login_errors == {}
    assert [
        (found.external_id, found.name, found.login_key, found.institution_key, found.institution_name, found.currency, found.balance)
        for found in result.accounts
    ] == [
        ("11", "Everyday Chequing", "7", "Harbour Bank", "Harbour Bank", "CAD", 251075),
        ("12", "Rewards Visa", "8", "Harbourline Cards", "Harbourline Cards", "CAD", -64010),
        ("13", "Tokyo Savings", "7", "Harbour Bank", "Harbour Bank", "JPY", 120000),
    ]
    assert all(before <= found.balance_at <= after for found in result.accounts)
    assert {found.available_balance for found in result.accounts} == {None}
    assert {found.records for found in result.accounts} == {()}
    assert sorted(api.paths()) == sorted(["/api/v1/accounts", *(f"/api/v1/accounts/{account_id}/balance" for account_id in (11, 12, 13))])


async def test_discovery_takes_the_currency_from_the_balance_when_the_account_list_sends_none():
    """Lunch Flow's live account list has no currency, so the balance answer's currency is the account's"""
    chequing = account(11, currency=None)
    yen = account(13, name="Tokyo Savings", currency=None)
    api = LunchFlowApi().serve("/accounts", accounts_body(chequing, yen))
    api.serve_account(chequing, balance="2510.75").serve_account(yen, balance="120000", currency="JPY")

    result = await lunchflow_adapter(api.transport).discover(API_KEY, currency_exponents=_EXPONENTS)

    assert result.account_errors == {}
    assert [(found.external_id, found.currency, found.currency_raw, found.balance) for found in result.accounts] == [
        ("11", "CAD", "CAD", 251075),
        ("13", "JPY", "JPY", 120000),
    ]


async def test_discovery_reports_an_account_whose_list_and_balance_both_leave_out_the_currency():
    """A bank account is stored in the currency its amounts are read in, so one with none is an error, never a blank currency"""
    unknown = account(11, currency=None)
    api = LunchFlowApi().serve("/accounts", accounts_body(unknown))
    api.serve("/accounts/11/balance", '{"balance": {"amount": 5.00}}')

    result = await lunchflow_adapter(api.transport).discover(API_KEY, currency_exponents=_EXPONENTS)

    assert result.accounts == ()
    assert result.account_errors["11"].kind is ProviderErrorKind.UNKNOWN
    assert result.account_errors["11"].reason == "Lunch Flow didn't say which currency this account is in"


async def test_discovery_with_one_balance_failing_reports_that_account_and_lists_the_rest():
    """A failed balance is an error for its account, never a silent drop that would read as the account vanishing"""
    chequing = account(11)
    savings = account(12, name="Online Savings")
    api = LunchFlowApi().serve("/accounts", accounts_body(chequing, savings))
    api.serve_account(chequing, balance="10.00")
    api.serve("/accounts/12/balance", '{"error": "Internal", "message": "Bank unavailable"}', 500)

    result = await lunchflow_adapter(api.transport).discover(API_KEY, currency_exponents=_EXPONENTS)

    assert result.request_error is None
    assert [found.external_id for found in result.accounts] == ["11"]
    assert set(result.account_errors) == {"12"}
    assert result.account_errors["12"].kind is ProviderErrorKind.TEMPORARY


async def test_discovery_leaves_out_an_account_that_is_not_active_with_its_connection_needing_attention():
    """Only ACTIVE syncs: any other status gets no balance request, so with no currency it is left out and sends the user to Lunch Flow"""
    chequing = account(11, connection_id=7, currency=None)
    expired = account(12, connection_id=9, name="Old Savings", currency=None, status="EXPIRED")
    api = LunchFlowApi().serve("/accounts", accounts_body(chequing, expired)).serve_account(chequing)

    result = await lunchflow_adapter(api.transport).discover(API_KEY, currency_exponents=_EXPONENTS)

    assert [(found.external_id, found.currency_raw, found.balance) for found in result.accounts] == [("11", "CAD", 10000)]
    assert result.account_errors == {}
    assert set(result.login_errors) == {"9"}
    assert result.login_errors["9"].kind is ProviderErrorKind.BANK_LOGIN_NEEDED
    assert (
        result.login_errors["9"].reason == "Lunch Flow says this connection needs attention. Please reconnect it in Lunch Flow, then sync again"
    )
    assert "/api/v1/accounts/12/balance" not in api.paths()


async def test_discovery_leaves_a_balance_unread_when_its_currency_is_not_the_accounts_or_not_held():
    """A balance that can't be stored exactly in the account's currency is None, not a figure in the wrong one"""
    chequing = account(11)
    stored_elsewhere = account(12, currency="XYZ")
    api = LunchFlowApi().serve("/accounts", accounts_body(chequing, stored_elsewhere))
    api.serve("/accounts/11/balance", balance_body("10.00", "USD"))
    api.serve("/accounts/12/balance", balance_body("10.00", "XYZ"))

    result = await lunchflow_adapter(api.transport).discover(API_KEY, currency_exponents=_EXPONENTS)

    assert [(found.external_id, found.balance, found.currency_raw) for found in result.accounts] == [("11", None, "CAD"), ("12", None, "XYZ")]


async def test_discovery_with_a_rejected_key_fails_the_request_for_the_user_to_reconnect():
    """A 401 at the listing is the credential being rejected, with no accounts"""
    api = LunchFlowApi().serve("/accounts", '{"error": "Unauthorized", "message": "Invalid API key"}', 401)

    result = await lunchflow_adapter(api.transport).discover(API_KEY, currency_exponents=_EXPONENTS)

    assert result.accounts == ()
    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.CREDENTIAL_REJECTED
    assert API_KEY not in result.request_error.reason


async def test_discovery_meeting_a_429_on_a_balance_fails_the_request_as_rate_limited():
    """A quota spent partway means the rest of the sync waits, so the whole request reports it"""
    chequing = account(11)
    savings = account(12)
    api = LunchFlowApi().serve("/accounts", accounts_body(chequing, savings)).serve_account(chequing)
    api.serve("/accounts/12/balance", json_response("{}", 429))

    result = await lunchflow_adapter(api.transport).discover(API_KEY, currency_exponents=_EXPONENTS)

    assert result.accounts == ()
    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.RATE_LIMITED


async def test_discovery_sends_at_most_four_requests_at_once():
    """Lunch Flow publishes no rate limit, so a user with many accounts doesn't send all their balance reads together"""
    wire_accounts = [account(number) for number in range(20, 32)]
    api = LunchFlowApi().serve("/accounts", accounts_body(*wire_accounts))
    for wire_account in wire_accounts:
        api.serve_account(wire_account)

    result = await lunchflow_adapter(api.transport).discover(API_KEY, currency_exponents=_EXPONENTS)

    assert len(result.accounts) == 12
    assert api.most_in_flight == 4


async def test_discovery_with_an_unreadable_balance_reports_the_account_as_unknown_not_an_outage():
    """An answer that can't be read isn't the provider being down, so it isn't retried without end"""
    chequing = account(11)
    api = LunchFlowApi().serve("/accounts", accounts_body(chequing))
    api.serve("/accounts/11/balance", "not json")

    result = await lunchflow_adapter(api.transport).discover(API_KEY, currency_exponents=_EXPONENTS)

    assert result.account_errors["11"].kind is ProviderErrorKind.UNKNOWN


async def test_discovery_for_a_connection_failure_reports_it_without_the_key():
    """A lost connection fails the request as temporary, and the reason names no key"""
    api = LunchFlowApi().serve("/accounts", httpx.ConnectError("refused"))

    result = await lunchflow_adapter(api.transport).discover(API_KEY, currency_exponents=_EXPONENTS)

    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.TEMPORARY
    assert API_KEY not in result.request_error.reason
