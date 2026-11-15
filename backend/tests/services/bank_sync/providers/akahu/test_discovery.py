"""Akahu discovery tests

Guards what listing a personal app's accounts tells the sync engine: every account with its balances
in one request, the bank connection that identifies it, a bank asking to be reconnected as a login
error, and nothing of the account holder or number kept
"""

from datetime import UTC, datetime

import httpx

from app.models.bank_sync_job import ProviderErrorKind
from tests.services.bank_sync.providers.akahu.stand_ins import (
    APP_ID_TOKEN,
    CREDENTIAL,
    EXPONENTS,
    USER_ACCESS_TOKEN,
    AkahuApi,
    account,
    accounts_body,
    akahu_adapter,
    json_response,
)


async def test_discovery_lists_each_account_with_its_balances_connection_and_date_in_one_request():
    """The login and institution are Akahu's bank connection, the balance date is Akahu's refresh, and the headers carry both tokens"""
    chequing = account("acc_chq", current="2510.75", available="2400.00")
    visa = account(
        "acc_visa", connection_id="conn_cards", connection_name="Harbourline Cards", name="Rewards Visa", current="-640.1", available=None
    )
    yen = account("acc_yen", name="Tokyo Savings", currency="JPY", current="120000", available="120000", balance_refreshed=None)
    api = AkahuApi().serve("/accounts", accounts_body(chequing, visa, yen))

    before = datetime.now(UTC)
    result = await akahu_adapter(api.transport).discover(CREDENTIAL, currency_exponents=EXPONENTS)
    after = datetime.now(UTC)

    assert result.request_error is None
    assert result.account_errors == {}
    assert result.login_errors == {}
    assert [
        (found.external_id, found.name, found.login_key, found.institution_key, found.institution_name, found.currency, found.balance)
        for found in result.accounts
    ] == [
        ("acc_chq", "Everyday Chequing", "conn_bank", "conn_bank", "Harbour Bank", "NZD", 251075),
        ("acc_visa", "Rewards Visa", "conn_cards", "conn_cards", "Harbourline Cards", "NZD", -64010),
        ("acc_yen", "Tokyo Savings", "conn_bank", "conn_bank", "Harbour Bank", "JPY", 120000),
    ]
    assert [found.available_balance for found in result.accounts] == [240000, None, 120000]
    assert result.accounts[0].balance_at == datetime(2026, 10, 3, 21, tzinfo=UTC)
    assert before <= result.accounts[2].balance_at <= after
    assert {found.records for found in result.accounts} == {()}
    [request] = api.requests
    assert (request.url.path, request.url.query) == ("/v1/accounts", b"")
    assert request.headers["authorization"] == f"Bearer {USER_ACCESS_TOKEN}"
    assert request.headers["x-akahu-id"] == APP_ID_TOKEN


async def test_discovery_keeps_nothing_of_the_holder_the_account_number_or_the_logo():
    """Only what sync needs is read, so the holder, address, formatted account number and logos Akahu sends are gone"""
    api = AkahuApi().serve("/accounts", accounts_body(account()))

    result = await akahu_adapter(api.transport).discover(CREDENTIAL, currency_exponents=EXPONENTS)

    kept = repr(result)
    for dropped in ("Jane Q Holder", "Karori", "12-3456-7890123-00", "logo", "auth_1"):
        assert dropped not in kept


async def test_discovery_lists_an_inactive_account_with_its_bank_asking_to_be_reconnected():
    """INACTIVE doesn't sync: its balance is out of date, so it is unread, and its connection sends the user to Akahu"""
    chequing = account("acc_chq")
    inactive = account("acc_old", connection_id="conn_old", connection_name="Old Bank", name="Old Savings", status="INACTIVE")
    api = AkahuApi().serve("/accounts", accounts_body(chequing, inactive))

    result = await akahu_adapter(api.transport).discover(CREDENTIAL, currency_exponents=EXPONENTS)

    assert [(found.external_id, found.balance, found.available_balance) for found in result.accounts] == [
        ("acc_chq", 10000, 9000),
        ("acc_old", None, None),
    ]
    assert set(result.login_errors) == {"conn_old"}
    assert result.login_errors["conn_old"].kind is ProviderErrorKind.BANK_LOGIN_NEEDED
    assert result.login_errors["conn_old"].reason == (
        "Akahu says this bank needs a reconnection. Please reconnect it in your Akahu personal app, then sync again"
    )


async def test_discovery_leaves_a_balance_unread_when_its_currency_is_not_held_or_has_too_many_decimals():
    """A balance that can't be stored exactly is None, never rounded, and the account stays listed"""
    odd_currency = account("acc_xyz", currency="XYZ")
    too_precise = account("acc_precise", current="10.005", available="1.234")
    api = AkahuApi().serve("/accounts", accounts_body(odd_currency, too_precise))

    result = await akahu_adapter(api.transport).discover(CREDENTIAL, currency_exponents=EXPONENTS)

    assert [(found.external_id, found.currency, found.currency_raw, found.balance, found.available_balance) for found in result.accounts] == [
        ("acc_xyz", "XYZ", "XYZ", None, None),
        ("acc_precise", "NZD", "NZD", None, None),
    ]
    assert result.accounts[1].available_balance_unreadable


async def test_discovery_with_rejected_tokens_fails_the_request_for_the_user_to_reconnect():
    """A 401 at the listing is the credential being rejected, with no accounts"""
    api = AkahuApi().serve("/accounts", '{"success": false, "message": "Invalid token"}', 401)

    result = await akahu_adapter(api.transport).discover(CREDENTIAL, currency_exponents=EXPONENTS)

    assert result.accounts == ()
    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.CREDENTIAL_REJECTED
    assert APP_ID_TOKEN not in result.request_error.reason
    assert USER_ACCESS_TOKEN not in result.request_error.reason


async def test_discovery_meeting_a_429_fails_the_request_as_rate_limited():
    """A spent quota means the rest of the sync waits, so the request reports it"""
    api = AkahuApi().serve("/accounts", json_response("{}", 429))

    result = await akahu_adapter(api.transport).discover(CREDENTIAL, currency_exponents=EXPONENTS)

    assert result.accounts == ()
    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.RATE_LIMITED


async def test_discovery_with_a_lost_connection_is_an_outage_and_names_no_token():
    """A lost connection is the only kind of failure here that retries without end"""
    api = AkahuApi().serve("/accounts", httpx.ConnectError("refused"))

    result = await akahu_adapter(api.transport).discover(CREDENTIAL, currency_exponents=EXPONENTS)

    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.TEMPORARY
    assert USER_ACCESS_TOKEN not in result.request_error.reason


async def test_discovery_of_a_body_that_is_not_the_documented_shape_is_unknown_and_names_no_token():
    """An unreadable answer isn't an outage, so the sync stops after one series of retries"""
    api = AkahuApi().serve("/accounts", json_response('{"success": true, "items": [{"name": "no id"}]}'))

    result = await akahu_adapter(api.transport).discover(CREDENTIAL, currency_exponents=EXPONENTS)

    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.UNKNOWN
    assert USER_ACCESS_TOKEN not in result.request_error.reason
