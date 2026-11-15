"""Pluggy discovery tests

Guards what listing an application's items tells the sync engine: every account with its balance,
the bank connection that identifies it, a credit card's balance read as money owed, an item waiting
on its user as a login error, an item that is only behind as an outage, and nothing of the holder or
the account number kept
"""

from datetime import UTC, datetime

import httpx
import pytest

from app.models.bank_sync_job import ProviderErrorKind
from tests.services.bank_sync.providers.pluggy.stand_ins import (
    API_KEY,
    CLIENT_SECRET,
    CREDENTIAL,
    EXPONENTS,
    ITEM_ID,
    OTHER_ITEM_ID,
    PluggyApi,
    account,
    accounts_body,
    item,
    json_response,
    pluggy_adapter,
)


async def _discover(api: PluggyApi):
    """List the accounts the stored credential reaches"""
    return await pluggy_adapter(api.transport).discover(CREDENTIAL, currency_exponents=EXPONENTS)


async def test_discovery_lists_each_account_with_its_balance_connector_and_date():
    """The login is Pluggy's item, the institution its connector, a card's balance is money owed, and the date is the item's last update"""
    checking = account("acc-chk", balance="2510.75")
    card = account("acc-card", kind="CREDIT", name="Cartão Aurora Gold", balance="640.10")
    api = PluggyApi().serve_sign_in().serve_item(item(), checking, card)

    result = await _discover(api)

    assert result.request_error is None
    assert result.account_errors == {}
    assert result.login_errors == {}
    assert [
        (found.external_id, found.name, found.login_key, found.institution_key, found.institution_name, found.currency, found.balance)
        for found in result.accounts
    ] == [
        ("acc-chk", "Conta Corrente", ITEM_ID, "612", "Banco Aurora", "BRL", 251075),
        ("acc-card", "Cartão Aurora Gold", ITEM_ID, "612", "Banco Aurora", "BRL", -64010),
    ]
    assert {found.available_balance for found in result.accounts} == {None}
    assert {found.balance_at for found in result.accounts} == {datetime(2026, 10, 3, 21, tzinfo=UTC)}
    assert {found.records for found in result.accounts} == {()}
    assert sorted(api.paths()) == ["/accounts", "/auth", f"/items/{ITEM_ID}"]
    items_request = next(request for request in api.requests if request.url.path == "/accounts")
    assert (items_request.url.params["itemId"], items_request.headers["x-api-key"]) == (ITEM_ID, API_KEY)


async def test_discovery_reads_each_item_as_its_own_login_and_institution():
    """Two items at two banks are two logins, and balance dates fall back to the read time when Pluggy gives none"""
    api = (
        PluggyApi()
        .serve_sign_in()
        .serve_item(item(), account("acc-chk"))
        .serve_item(
            item(OTHER_ITEM_ID, connector_id=77, connector_name="Banco Maré", last_updated=None),
            account("acc-sav", item_id=OTHER_ITEM_ID),
            item_id=OTHER_ITEM_ID,
        )
    )
    credential = CREDENTIAL.replace(f'"{ITEM_ID}"', f'"{ITEM_ID}", "{OTHER_ITEM_ID}"')

    before = datetime.now(UTC)
    result = await pluggy_adapter(api.transport).discover(credential, currency_exponents=EXPONENTS)
    after = datetime.now(UTC)

    assert [(found.external_id, found.login_key, found.institution_key, found.institution_name) for found in result.accounts] == [
        ("acc-chk", ITEM_ID, "612", "Banco Aurora"),
        ("acc-sav", OTHER_ITEM_ID, "77", "Banco Maré"),
    ]
    assert before <= result.accounts[1].balance_at <= after


async def test_discovery_keeps_nothing_of_the_holder_the_account_number_or_the_connector_images():
    """Only what sync needs is read, so the holder, tax number, account number and images Pluggy sends are gone"""
    api = PluggyApi().serve_sign_in().serve_item(item(), account())

    result = await _discover(api)

    kept = repr(result)
    for dropped in ("MARIA S SOUZA", "123.456.789-09", "0001/123456-7", "aurora.png", "Aurora Premium", "user-77"):
        assert dropped not in kept


async def test_discovery_of_a_connector_with_no_name_takes_its_id_as_the_institution_name():
    """Pluggy's schema leaves a connector's name optional, and a nameless one still lists its accounts under an institution"""
    api = PluggyApi().serve_sign_in().serve_item(item(connector_id=612, connector_name=None), account("acc-chk"))

    result = await _discover(api)

    assert result.request_error is None
    assert [(found.institution_key, found.institution_name) for found in result.accounts] == [("612", "612")]


async def test_discovery_of_an_item_waiting_on_its_user_lists_its_accounts_unread_and_sends_the_user_to_reconnect():
    """LOGIN_ERROR and a user-action execution status don't sync: the balance is out of date, so it is unread, and the login says why"""
    waiting = item(OTHER_ITEM_ID, status="LOGIN_ERROR", execution_status="INVALID_CREDENTIALS", connector_name="Banco Maré")
    api = (
        PluggyApi()
        .serve_sign_in()
        .serve_item(item(), account("acc-chk"))
        .serve_item(waiting, account("acc-old", item_id=OTHER_ITEM_ID), item_id=OTHER_ITEM_ID)
    )
    credential = CREDENTIAL.replace(f'"{ITEM_ID}"', f'"{ITEM_ID}", "{OTHER_ITEM_ID}"')

    result = await pluggy_adapter(api.transport).discover(credential, currency_exponents=EXPONENTS)

    assert [(found.external_id, found.balance) for found in result.accounts] == [("acc-chk", 150050), ("acc-old", None)]
    assert set(result.login_errors) == {OTHER_ITEM_ID}
    assert result.login_errors[OTHER_ITEM_ID].kind is ProviderErrorKind.BANK_LOGIN_NEEDED
    assert (
        result.login_errors[OTHER_ITEM_ID].reason
        == "Pluggy says this bank needs a reconnection. Please reconnect it in Meu Pluggy, then sync again"
    )
    assert result.account_errors == {}


@pytest.mark.parametrize(
    ("status", "execution"),
    [
        ("WAITING_USER_INPUT", "SUCCESS"),
        ("WAITING_USER_ACTION", "WAITING_USER_ACTION"),
        ("UPDATED", "USER_AUTHORIZATION_PENDING"),
        ("UPDATED", "USER_AUTHORIZATION_REVOKED"),
        ("UPDATED", "ACCOUNT_LOCKED"),
        ("OUTDATED", "INVALID_CREDENTIALS_MFA"),
        ("UPDATED", "USER_AUTHORIZATION_NOT_GRANTED"),
    ],
)
async def test_discovery_of_each_status_that_needs_the_user_sends_them_to_reconnect(status, execution):
    """Every status and execution status Pluggy documents as the user's to fix is a login error, even when the item says it updated"""
    api = PluggyApi().serve_sign_in().serve_item(item(status=status, execution_status=execution), account())

    result = await _discover(api)

    assert set(result.login_errors) == {ITEM_ID}


async def test_discovery_of_an_item_that_is_behind_is_an_outage_and_not_a_reconnect():
    """OUTDATED with a bank that is down is Pluggy's to retry, so the accounts' error is temporary and no login error is raised"""
    api = PluggyApi().serve_sign_in().serve_item(item(status="OUTDATED", execution_status="SITE_NOT_AVAILABLE"), account("acc-chk"))

    result = await _discover(api)

    assert result.login_errors == {}
    assert [(found.external_id, found.balance) for found in result.accounts] == [("acc-chk", None)]
    assert result.account_errors["acc-chk"].kind is ProviderErrorKind.TEMPORARY


@pytest.mark.parametrize(("status", "execution"), [("UPDATING", "CREATING"), ("MERGING", "SUCCESS")], ids=["updating", "merging"])
async def test_discovery_of_an_item_that_is_refreshing_still_reads_the_data_it_holds(status, execution):
    """UPDATING and MERGING are a refresh in progress, and the figures from before it are good"""
    api = PluggyApi().serve_sign_in().serve_item(item(status=status, execution_status=execution), account(balance="10.00"))

    result = await _discover(api)

    assert result.account_errors == {}
    assert result.accounts[0].balance == 1000


async def test_discovery_asks_for_an_items_accounts_by_item_alone_and_flags_a_list_of_more_pages_as_cut_off():
    """Pluggy publishes no page parameter, so only the item is sent, and a list saying it has more pages is flagged"""
    api = PluggyApi().serve_sign_in().serve("/items/" + ITEM_ID, item())
    api.serve_accounts(ITEM_ID, accounts_body(account("acc-1"), total_pages=2))

    result = await _discover(api)

    assert [dict(request.url.params) for request in api.requests if request.url.path == "/accounts"] == [{"itemId": ITEM_ID}]
    assert [found.external_id for found in result.accounts] == ["acc-1"]
    assert result.possibly_cut_off is True
    assert [(warning.kind, warning.reason) for warning in result.warnings] == [
        (ProviderErrorKind.UNKNOWN, "Pluggy has more accounts under an item than Lumina Finance reads at once")
    ]


async def test_discovery_of_an_accounts_list_of_one_page_is_not_flagged():
    """A list that says it is complete raises no flag and no warning"""
    api = PluggyApi().serve_sign_in().serve_item(item(), account("acc-1"))

    result = await _discover(api)

    assert result.possibly_cut_off is False
    assert result.warnings == ()


async def test_discovery_leaves_a_balance_unread_when_its_currency_is_not_held_or_has_too_many_decimals():
    """A balance that can't be stored exactly is None, never rounded, and the account stays listed"""
    api = PluggyApi().serve_sign_in().serve_item(item(), account("acc-xyz", currency="XYZ"), account("acc-precise", balance="10.005"))

    result = await _discover(api)

    assert [(found.external_id, found.currency, found.currency_raw, found.balance) for found in result.accounts] == [
        ("acc-xyz", "XYZ", "XYZ", None),
        ("acc-precise", "BRL", "BRL", None),
    ]


async def test_discovery_with_one_item_missing_lists_the_others_and_warns():
    """A deleted item is no outage and not the keys' fault, so the rest of the application still lists"""
    api = PluggyApi().serve_sign_in().serve_item(item(), account("acc-chk"))
    credential = CREDENTIAL.replace(f'"{ITEM_ID}"', f'"{ITEM_ID}", "{OTHER_ITEM_ID}"')

    result = await pluggy_adapter(api.transport).discover(credential, currency_exponents=EXPONENTS)

    assert result.request_error is None
    assert [found.external_id for found in result.accounts] == ["acc-chk"]
    assert [(warning.kind, warning.reason) for warning in result.warnings] == [
        (ProviderErrorKind.UNKNOWN, "Pluggy didn't return one of this connection's items")
    ]


async def test_discovery_with_every_item_missing_fails_the_request_instead_of_listing_nothing():
    """An empty list would read as every account having vanished, so the request fails and the links stay"""
    api = PluggyApi().serve_sign_in()

    result = await _discover(api)

    assert result.accounts == ()
    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.UNKNOWN


async def test_discovery_with_rejected_keys_fails_the_request_for_the_user_to_reconnect():
    """A 401 at sign-in is the credential being rejected, with no accounts"""
    api = PluggyApi().serve("/auth", '{"message": "Invalid credentials"}', 401)

    result = await _discover(api)

    assert result.accounts == ()
    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.CREDENTIAL_REJECTED
    assert CLIENT_SECRET not in result.request_error.reason
    assert API_KEY not in result.request_error.reason


async def test_discovery_meeting_a_429_fails_the_request_as_rate_limited():
    """A spent quota means the rest of the sync waits, so the request reports it"""
    api = PluggyApi().serve_sign_in().serve_item(item()).serve_accounts(ITEM_ID, json_response("{}", 429))

    result = await _discover(api)

    assert result.accounts == ()
    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.RATE_LIMITED


async def test_discovery_with_a_lost_connection_is_an_outage_and_names_no_key():
    """A lost connection is the only kind of failure here that retries without end"""
    api = PluggyApi().serve("/auth", httpx.ConnectError("refused"))

    result = await _discover(api)

    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.TEMPORARY
    assert CLIENT_SECRET not in result.request_error.reason


async def test_discovery_of_a_body_that_is_not_the_documented_shape_is_unknown():
    """An unreadable answer isn't an outage, so the sync stops after one series of retries"""
    api = PluggyApi().serve_sign_in().serve_item(item()).serve_accounts(ITEM_ID, '{"results": "no list"}')

    result = await _discover(api)

    assert result.accounts == ()
    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.UNKNOWN


async def test_discovery_of_an_item_without_a_connector_lists_its_accounts_under_an_unnamed_bank_of_its_own():
    """Pluggy's schema leaves an item's connector optional, so an item without one still lists its accounts, and two such items are two banks"""
    unnamed = item().replace('"connector": {', '"unused": {')
    other = item(OTHER_ITEM_ID).replace('"connector": {', '"unused": {')
    api = (
        PluggyApi()
        .serve_sign_in()
        .serve_item(unnamed, account("acc-chk"))
        .serve_item(other, account("acc-sav", item_id=OTHER_ITEM_ID), item_id=OTHER_ITEM_ID)
    )
    credential = CREDENTIAL.replace(f'"{ITEM_ID}"', f'"{ITEM_ID}", "{OTHER_ITEM_ID}"')

    result = await pluggy_adapter(api.transport).discover(credential, currency_exponents=EXPONENTS)

    assert result.request_error is None
    assert [(found.institution_key, found.institution_name) for found in result.accounts] == [
        (ITEM_ID, "Unnamed bank"),
        (OTHER_ITEM_ID, "Unnamed bank"),
    ]


async def test_discovery_of_an_accounts_page_without_results_lists_no_accounts():
    """Pluggy's schema leaves the results of a page optional, so a page without them is an empty one and no failure"""
    api = PluggyApi().serve_sign_in().serve_item(item()).serve_accounts(ITEM_ID, '{"page": 1, "total": 0, "totalPages": 1}')

    result = await _discover(api)

    assert result.request_error is None
    assert result.accounts == ()
    assert result.warnings == ()
