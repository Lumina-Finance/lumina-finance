"""Pluggy answers that don't fit the documented shape

Guards what a sync does with valid JSON in the wrong shape: a sign-in, an item or an account list that
can't be read fails the request, a transaction list that can't be read fails only its account, one
account or transaction that can't be read is skipped and counted in a warning while the rest are kept,
and each time the log says which field and what kind of mismatch, never the value that was sent, since
the answer holds the user's account names and amounts
"""

import logging

import pytest

from app.models.bank_sync_job import ProviderErrorKind
from app.services.bank_sync.providers.contract import ProviderUnreachable
from tests.services.bank_sync.providers.pluggy.stand_ins import (
    API_KEY,
    CLIENT_ID,
    CLIENT_SECRET,
    CREDENTIAL,
    EXPONENTS,
    ITEM_ID,
    OTHER_ITEM_ID,
    PluggyApi,
    account,
    fetch,
    item,
    json_response,
    next_page,
    pluggy_adapter,
    transaction,
    transactions_body,
)

_LOGGER = "app.services.bank_sync.providers.pluggy.wire"
_ACCOUNT_WITHOUT_BALANCE = '{"id": "acc-bad", "type": "BANK", "name": "SECRET name", "currencyCode": "BRL"}'
_TRANSACTION_WITHOUT_AMOUNT = '{"id": "tx-bad", "date": "2026-10-01T11:00:00.000Z", "description": "SECRET"}'
_PENDING_WITHOUT_AMOUNT = '{"id": "tx-pending", "status": "PENDING", "date": "2026-10-02T11:00:00.000Z", "description": "SECRET"}'


async def _discover(api: PluggyApi):
    """List the accounts the stored credential reaches"""
    return await pluggy_adapter(api.transport).discover(CREDENTIAL, currency_exponents=EXPONENTS)


async def _fetch(api: PluggyApi):
    """Fetch the window of the checking account"""
    return await fetch(pluggy_adapter(api.transport), "acc-chk")


def _logged_mismatches(caplog) -> str:
    """Return what the wire module logged, and prove no secret or value reached any log"""
    assert "SECRET" not in caplog.text
    assert CLIENT_SECRET not in caplog.text
    assert API_KEY not in caplog.text
    return " ".join(record.getMessage() for record in caplog.records if record.name == _LOGGER)


def _warnings(result) -> list[tuple[ProviderErrorKind, str]]:
    """Return each warning of a result as its kind and reason"""
    return [(warning.kind, warning.reason) for warning in result.warnings]


@pytest.mark.parametrize(
    ("body", "place", "kind"),
    [
        ('{"token": "SECRET"}', "apiKey", "missing"),
        ('{"apiKey": 12345}', "apiKey", "string_type"),
        ('["SECRET"]', "root", "model_type"),
    ],
    ids=["no-key", "key-not-a-string", "not-an-object"],
)
@pytest.mark.parametrize("operation", [_discover, _fetch])
async def test_a_sign_in_in_the_wrong_shape_fails_the_request_and_logs_where(operation, body, place, kind, caplog):
    """The first answer can't be read, so nothing is sent after it and the log names the field and the mismatch but not the value"""
    caplog.set_level(logging.DEBUG)
    api = PluggyApi().serve("/auth", body)

    result = await operation(api)

    assert result.accounts == ()
    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.UNKNOWN
    assert f"{place} ({kind})" in _logged_mismatches(caplog)
    assert api.paths() == ["/auth"]


@pytest.mark.parametrize("body", ["not json", "NaN", '{"apiKey": "  "}'], ids=["not-json", "not-a-number", "blank-key"])
async def test_a_sign_in_that_holds_no_usable_key_fails_the_request_and_logs_it(body, caplog):
    """A body that isn't JSON or a key that is blank is told apart in the log from a rejected key"""
    caplog.set_level(logging.DEBUG)
    api = PluggyApi().serve("/auth", body)

    result = await _discover(api)

    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.UNKNOWN
    assert _logged_mismatches(caplog)


async def test_a_claim_whose_sign_in_cannot_be_read_leaves_the_entry_to_try_again(caplog):
    """The first request's answer being unreadable says nothing about the keys, and the log says where"""
    caplog.set_level(logging.DEBUG)
    api = PluggyApi().serve("/auth", '{"token": "SECRET"}')
    supplied = {"client_id": CLIENT_ID, "client_secret": CLIENT_SECRET, "item_ids": ITEM_ID}

    with pytest.raises(ProviderUnreachable):
        await pluggy_adapter(api.transport).claim(supplied)

    assert "apiKey (missing)" in _logged_mismatches(caplog)


@pytest.mark.parametrize(
    ("body", "place", "kind"),
    [
        ('{"status": "UPDATED"}', "id", "missing"),
        (f'{{"id": "{ITEM_ID}"}}', "status", "missing"),
        ('{"id": 7, "status": "UPDATED"}', "id", "string_type"),
        (f'{{"id": "{ITEM_ID}", "status": "UPDATED", "connector": "SECRET"}}', "connector", "model_type"),
        (f'{{"id": "{ITEM_ID}", "status": "UPDATED", "connector": {{"name": "SECRET"}}}}', "connector.id", "missing"),
        ('["SECRET"]', "root", "model_type"),
    ],
    ids=["no-id", "no-status", "id-not-a-string", "connector-not-an-object", "connector-without-id", "not-an-object"],
)
@pytest.mark.parametrize("operation", [_discover, _fetch])
async def test_an_item_in_the_wrong_shape_fails_the_request_and_logs_where(operation, body, place, kind, caplog):
    """An item that can't be read leaves no account to list, so the request fails and the links stay"""
    caplog.set_level(logging.DEBUG)
    api = PluggyApi().serve_sign_in().serve(f"/items/{ITEM_ID}", body)

    result = await operation(api)

    assert result.accounts == ()
    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.UNKNOWN
    assert f"{place} ({kind})" in _logged_mismatches(caplog)


@pytest.mark.parametrize(
    ("body", "place", "kind"),
    [
        ('{"totalPages": "SECRET"}', "totalPages", "int_parsing"),
        ('{"results": "SECRET-list"}', "results", "list_type"),
        ('["SECRET"]', "root", "model_type"),
    ],
    ids=["pages-not-a-number", "list-not-a-list", "not-an-object"],
)
@pytest.mark.parametrize("operation", [_discover, _fetch])
async def test_an_account_list_in_the_wrong_shape_fails_the_request_and_logs_where(operation, body, place, kind, caplog):
    """A list that can't be read as a list is no outage, and the log names the field and the mismatch but not the value"""
    caplog.set_level(logging.DEBUG)
    api = PluggyApi().serve_sign_in().serve_item(item()).serve_accounts(ITEM_ID, body)

    result = await operation(api)

    assert result.accounts == ()
    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.UNKNOWN
    assert f"{place} ({kind})" in _logged_mismatches(caplog)


@pytest.mark.parametrize(
    ("bad_account", "place", "kind"),
    [
        (_ACCOUNT_WITHOUT_BALANCE, "results.1.balance", "missing"),
        (account("acc-bad", balance='"SECRET-12.34"'), "results.1.balance", "decimal_parsing"),
        ('{"type": "BANK", "name": "SECRET", "balance": 1.00, "currencyCode": "BRL"}', "results.1.id", "missing"),
        ('"SECRET"', "results.1", "model_type"),
    ],
    ids=["no-balance", "balance-not-a-number", "no-id", "not-an-object"],
)
async def test_discovery_skips_an_account_it_cannot_read_and_warns_how_many(bad_account, place, kind, caplog):
    """One account that can't be read costs only itself, and the warning counts it without naming it"""
    caplog.set_level(logging.DEBUG)
    api = PluggyApi().serve_sign_in().serve_item(item(), account("acc-chk"), bad_account)

    result = await _discover(api)

    assert result.request_error is None
    assert [found.external_id for found in result.accounts] == ["acc-chk"]
    assert result.account_errors == {}
    assert _warnings(result) == [(ProviderErrorKind.UNKNOWN, "1 account from Pluggy isn't listed: it can't be read")]
    assert f"{place} ({kind})" in _logged_mismatches(caplog)


async def test_discovery_counts_every_account_it_skips_across_items():
    """The warning adds up the accounts skipped on each item"""
    api = (
        PluggyApi()
        .serve_sign_in()
        .serve_item(item(), account("acc-chk"), _ACCOUNT_WITHOUT_BALANCE, _ACCOUNT_WITHOUT_BALANCE)
        .serve_item(item(OTHER_ITEM_ID), account("acc-sav", item_id=OTHER_ITEM_ID), _ACCOUNT_WITHOUT_BALANCE, item_id=OTHER_ITEM_ID)
    )
    credential = CREDENTIAL.replace(f'"{ITEM_ID}"', f'"{ITEM_ID}", "{OTHER_ITEM_ID}"')

    result = await pluggy_adapter(api.transport).discover(credential, currency_exponents=EXPONENTS)

    assert [found.external_id for found in result.accounts] == ["acc-chk", "acc-sav"]
    assert _warnings(result) == [(ProviderErrorKind.UNKNOWN, "3 accounts from Pluggy aren't listed: they can't be read")]


async def test_fetch_tells_an_asked_account_it_cannot_read_apart_from_one_that_is_gone_and_still_syncs_the_others():
    """An entry of the list that can't be read doesn't fail the account asked for, and the account it may have been is told so"""
    api = (
        PluggyApi()
        .serve_sign_in()
        .serve_item(item(), _ACCOUNT_WITHOUT_BALANCE, account("acc-chk"))
        .serve_transactions("acc-chk", transactions_body(transaction()))
    )

    result = await fetch(pluggy_adapter(api.transport), "acc-chk", "acc-bad", "acc-gone")

    assert result.request_error is None
    assert [found.external_id for found in result.accounts] == ["acc-chk"]
    assert result.warnings == ()
    assert set(result.account_errors) == {"acc-bad", "acc-gone"}
    assert result.account_errors["acc-bad"].kind is ProviderErrorKind.UNKNOWN
    assert result.account_errors["acc-bad"].reason == "Pluggy didn't return this account, or sent it in a form Lumina Finance can't read"


@pytest.mark.parametrize(
    ("answer", "place", "kind"),
    [
        ('{"next": null}', "results", "missing"),
        ('{"results": "SECRET", "next": null}', "results", "list_type"),
        ('{"results": [], "next": 12}', "next", "string_type"),
        ('["SECRET"]', "root", "model_type"),
        (transactions_body(transaction(), next_query="https://elsewhere.example/SECRET"), "next", "cursor"),
        (transactions_body(transaction(), next_query=next_page("acc-other", "SECRET")), "next", "cursor"),
    ],
    ids=["no-list", "list-not-a-list", "cursor-not-a-string", "not-an-object", "cursor-elsewhere", "cursor-of-another-account"],
)
async def test_a_transaction_list_in_the_wrong_shape_fails_only_its_account_and_logs_where(answer, place, kind, caplog):
    """A list that can't be read is the account's error, and the log names the field but never an amount or a name"""
    caplog.set_level(logging.DEBUG)
    api = (
        PluggyApi()
        .serve_sign_in()
        .serve_item(item(), account("acc-chk"), account("acc-sav", name="Poupança"))
        .serve_transactions("acc-chk", answer)
        .serve_transactions("acc-sav", transactions_body(transaction()))
    )

    result = await fetch(pluggy_adapter(api.transport), "acc-chk", "acc-sav")

    assert result.request_error is None
    assert [found.external_id for found in result.accounts] == ["acc-sav"]
    assert set(result.account_errors) == {"acc-chk"}
    assert result.account_errors["acc-chk"].kind is ProviderErrorKind.UNKNOWN
    assert f"{place} ({kind})" in _logged_mismatches(caplog)


@pytest.mark.parametrize(
    ("bad_transaction", "place", "kind"),
    [
        (_TRANSACTION_WITHOUT_AMOUNT, "results.1.amount", "missing"),
        (transaction("tx-bad", '"SECRET-12.34"'), "results.1.amount", "decimal_parsing"),
        ('{"id": "tx-bad", "amount": 4.50, "description": "SECRET"}', "results.1.date", "missing"),
        ('{"amount": 4.50, "date": "2026-10-01T11:00:00.000Z", "description": "SECRET"}', "results.1.id", "missing"),
        ('"SECRET"', "results.1", "model_type"),
    ],
    ids=["no-amount", "amount-not-a-number", "no-date", "no-id", "not-an-object"],
)
async def test_fetch_skips_a_transaction_it_cannot_read_and_warns_how_many(bad_transaction, place, kind, caplog):
    """One transaction that can't be read costs only itself, and the warning counts it without describing it"""
    caplog.set_level(logging.DEBUG)
    api = (
        PluggyApi()
        .serve_sign_in()
        .serve_item(item(), account("acc-chk"))
        .serve_transactions("acc-chk", transactions_body(transaction("tx-1"), bad_transaction, transaction("tx-2")))
    )

    result = await _fetch(api)

    assert result.request_error is None
    assert result.account_errors == {}
    [checking] = result.accounts
    assert [record.external_id for record in checking.records] == ["tx-1", "tx-2"]
    assert _warnings(result) == [(ProviderErrorKind.UNKNOWN, "1 transaction from Pluggy isn't imported: it can't be read")]
    assert f"{place} ({kind})" in _logged_mismatches(caplog)


def _two_accounts_with_incomplete_pending_transactions() -> PluggyApi:
    """Return Pluggy holding two accounts, three incomplete pending transactions on them and a whole one each page"""

    def checking_pages(request):
        """Answer the first page with an incomplete pending transaction and the last with another"""
        if request.url.params.get("after") is None:
            return json_response(transactions_body(transaction("tx-1"), _PENDING_WITHOUT_AMOUNT, next_query=next_page("acc-chk", "p2")))
        return json_response(transactions_body(_PENDING_WITHOUT_AMOUNT, transaction("tx-2")))

    return (
        PluggyApi()
        .serve_sign_in()
        .serve_item(item(), account("acc-chk"), account("acc-sav", name="Poupança"))
        .serve_transactions("acc-chk", checking_pages)
        .serve_transactions("acc-sav", transactions_body(_PENDING_WITHOUT_AMOUNT, transaction("tx-3")))
    )


async def test_fetch_with_incomplete_pending_transactions_counts_them_across_accounts_and_pages_when_pending_are_wanted():
    """A pending transaction Pluggy hasn't filled in is skipped alone, and the warning counts it where it would have been imported"""
    api = _two_accounts_with_incomplete_pending_transactions()

    result = await fetch(pluggy_adapter(api.transport), "acc-chk", "acc-sav", include_pending=True)

    assert result.request_error is None
    assert result.account_errors == {}
    assert {found.external_id: [record.external_id for record in found.records] for found in result.accounts} == {
        "acc-chk": ["tx-1", "tx-2"],
        "acc-sav": ["tx-3"],
    }
    assert _warnings(result) == [(ProviderErrorKind.UNKNOWN, "3 transactions from Pluggy aren't imported: they can't be read")]


async def test_fetch_with_incomplete_pending_transactions_neither_warns_nor_logs_when_pending_are_not_wanted(caplog):
    """A pending transaction that would be left out anyway is no cause for a warning on every sync"""
    caplog.set_level(logging.DEBUG)
    api = _two_accounts_with_incomplete_pending_transactions()

    result = await fetch(pluggy_adapter(api.transport), "acc-chk", "acc-sav")

    assert result.warnings == ()
    assert {found.external_id: [record.external_id for record in found.records] for found in result.accounts} == {
        "acc-chk": ["tx-1", "tx-2"],
        "acc-sav": ["tx-3"],
    }
    assert _logged_mismatches(caplog) == ""


async def test_a_page_of_many_unreadable_entries_is_logged_once_naming_the_first_five_places(caplog):
    """A page full of mismatches costs one log line and not one for each entry"""
    caplog.set_level(logging.DEBUG)
    api = (
        PluggyApi()
        .serve_sign_in()
        .serve_item(item(), account("acc-chk"))
        .serve_transactions("acc-chk", transactions_body(*(_TRANSACTION_WITHOUT_AMOUNT for _ in range(50))))
    )

    result = await _fetch(api)

    assert _warnings(result) == [(ProviderErrorKind.UNKNOWN, "50 transactions from Pluggy aren't imported: they can't be read")]
    [line] = [record.getMessage() for record in caplog.records if record.name == _LOGGER]
    assert line.count("amount (missing)") == 5
    assert "results.4.amount (missing)" in line
    assert "results.5.amount" not in line


async def test_a_cursor_pluggy_repeats_fails_only_its_account_and_logs_where(caplog):
    """A cursor that would loop for ever is unreadable, and the log says it is the next field that repeats"""
    caplog.set_level(logging.DEBUG)
    api = (
        PluggyApi()
        .serve_sign_in()
        .serve_item(item(), account("acc-chk"))
        .serve_transactions("acc-chk", json_response(transactions_body(transaction(), next_query=next_page("acc-chk", "same"))))
    )

    result = await _fetch(api)

    assert result.account_errors["acc-chk"].kind is ProviderErrorKind.UNKNOWN
    assert "next (repeated)" in " ".join(record.getMessage() for record in caplog.records)
    assert "SECRET" not in caplog.text


async def test_a_refused_request_is_logged_by_status_and_path_without_ids_or_keys(caplog):
    """A status that explains a failure is in the log, while the item ID, the account ID and the keys are not"""
    caplog.set_level(logging.DEBUG)
    api = PluggyApi().serve_sign_in().serve(f"/items/{ITEM_ID}", json_response("{}", 500))

    await _discover(api)

    assert "Pluggy answered /items/{id} with status 500" in caplog.text
    assert ITEM_ID not in caplog.text
    assert CLIENT_SECRET not in caplog.text
    assert API_KEY not in caplog.text


async def test_fetch_takes_a_null_cursor_as_the_last_page_and_asks_no_more():
    """A null next is the end of the list, so an account of one page takes one request"""
    api = PluggyApi().serve_sign_in().serve_item(item(), account("acc-chk")).serve_transactions("acc-chk", '{"results": [], "next": null}')

    result = await _fetch(api)

    assert result.warnings == ()
    assert api.paths().count("/v2/transactions") == 1
