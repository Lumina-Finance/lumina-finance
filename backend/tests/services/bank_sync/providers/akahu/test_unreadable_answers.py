"""Akahu answers that don't fit the documented shape, and statuses it refuses with

Guards what a sync does with an answer it can't read, and what the log keeps of it: an account list
that can't be read fails the request, a page or pending list that can't be read fails only what it
holds, and each time the log says which field and what kind of mismatch, never the value that was
sent, since the answer holds the user's account names, amounts and descriptions. A refused status is
logged with the request path alone
"""

import logging

import httpx
import pytest

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
    fetch,
    json_response,
    pending,
    pending_body,
    transaction,
    transactions_body,
)

_WIRE_LOGGER = "app.services.bank_sync.providers.akahu.wire"
_ADAPTER_LOGGER = "app.services.bank_sync.providers.akahu.adapter"

# Everything the answers below hold that must stay out of the log
_PRIVATE = (
    "SECRET",
    "Everyday Chequing",
    "EFTPOS BEAN THERE CAFE",
    "CARD PURCHASE FRESHWAY",
    "4.50",
    "100.00",
    APP_ID_TOKEN,
    USER_ACCESS_TOKEN,
)


async def _discover(api: AkahuApi):
    """Discover the personal app's accounts"""
    return await akahu_adapter(api.transport).discover(CREDENTIAL, currency_exponents=EXPONENTS)


async def _fetch(api: AkahuApi):
    """Fetch the chequing account's window"""
    return await fetch(akahu_adapter(api.transport), "acc_chq")


def _logged(caplog, logger: str) -> str:
    """Return what a logger logged, after proving nothing private reached any log"""
    for private in _PRIVATE:
        assert private not in caplog.text
    return " ".join(record.getMessage() for record in caplog.records if record.name == logger)


@pytest.mark.parametrize(
    ("body", "place", "kind"),
    [
        ('{"success": true, "items": [{"name": "SECRET"}]}', "items.0._id", "missing"),
        (
            '{"success": true, "items": [{"_id": "acc_1", "name": "SECRET", "connection": {"name": "Bank"}, "status": "ACTIVE"}]}',
            "items.0.connection._id",
            "missing",
        ),
        (
            '{"success": true, "items": [{"_id": "acc_1", "name": "n", "connection": {"_id": "c", "name": "b"}, "status": "ACTIVE", '
            '"balance": {"current": "SECRET-1.00", "currency": "NZD"}}]}',
            "items.0.balance.current",
            "decimal_parsing",
        ),
        (
            '{"success": true, "items": [{"_id": "acc_1", "name": "n", "connection": {"_id": "c", "name": "b"}, "status": "ACTIVE", '
            '"balance": {"current": 1.00}}]}',
            "items.0.balance.currency",
            "missing",
        ),
        ('{"success": true}', "items", "missing"),
        ('{"success": true, "items": "SECRET"}', "items", "list_type"),
        ('["SECRET"]', "", "model_type"),
    ],
    ids=["no-id", "no-connection-id", "balance-not-a-number", "balance-without-currency", "no-list", "list-not-a-list", "not-an-object"],
)
@pytest.mark.parametrize("operation", [_discover, _fetch])
async def test_an_account_list_in_the_wrong_shape_fails_the_request_and_logs_where(operation, body, place, kind, caplog):
    """An account list that can't be read is no outage, and the log names the field and the mismatch but not the value"""
    caplog.set_level(logging.DEBUG)
    api = AkahuApi().serve("/accounts", body)

    result = await operation(api)

    assert result.accounts == ()
    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.UNKNOWN
    assert f"{place} ({kind})" in _logged(caplog, _WIRE_LOGGER)


@pytest.mark.parametrize(
    ("body", "logged"),
    [
        ("SECRET not json", "isn't JSON"),
        ('{"success": false, "items": [], "message": "SECRET"}', "Akahu's answer to the account list says it wasn't successful"),
    ],
    ids=["not-json", "unsuccessful"],
)
async def test_an_account_list_that_is_not_json_or_not_successful_fails_the_request_and_logs_that(body, logged, caplog):
    """The log says what was wrong with the answer as a whole, without repeating a word of it"""
    caplog.set_level(logging.DEBUG)
    api = AkahuApi().serve("/accounts", body)

    result = await _discover(api)

    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.UNKNOWN
    assert logged in _logged(caplog, _WIRE_LOGGER)


@pytest.mark.parametrize(
    ("page", "place", "kind"),
    [
        (transactions_body(transaction("t1", '"SECRET-4.50"')), "items.0.amount", "decimal_parsing"),
        (
            '{"success": true, "items": [{"description": "SECRET", "amount": -4.50, "date": "2026-10-01T11:00:00.000Z"}]}',
            "items.0._id",
            "missing",
        ),
        (
            '{"success": true, "items": [{"_id": "t1", "description": "SECRET", "amount": -4.50, "date": "SECRET"}]}',
            "items.0.date",
            "datetime_from_date_parsing",
        ),
        ('{"success": true, "items": [{"_id": "t1", "amount": -4.50}]}', "items.0.date", "missing"),
        ('{"success": true, "items": [], "cursor": {"next": 12}}', "cursor.next", "string_type"),
        ('{"success": true, "items": "SECRET"}', "items", "list_type"),
    ],
    ids=["amount-not-a-number", "no-id", "date-not-a-date", "no-date", "cursor-not-a-string", "list-not-a-list"],
)
async def test_a_transaction_page_in_the_wrong_shape_fails_only_its_account_and_logs_where(page, place, kind, caplog):
    """A page that can't be read is that account's error, and the log names the field but never an amount or a description"""
    caplog.set_level(logging.DEBUG)
    api = (
        AkahuApi()
        .serve("/accounts", accounts_body(account("acc_chq"), account("acc_sav", name="Online Savings")))
        .serve("/accounts/acc_chq/transactions", page)
        .serve("/accounts/acc_sav/transactions", transactions_body())
    )

    result = await fetch(akahu_adapter(api.transport), "acc_chq", "acc_sav")

    assert result.request_error is None
    assert [found.external_id for found in result.accounts] == ["acc_sav"]
    assert set(result.account_errors) == {"acc_chq"}
    assert result.account_errors["acc_chq"].kind is ProviderErrorKind.UNKNOWN
    assert f"{place} ({kind})" in _logged(caplog, _WIRE_LOGGER)


@pytest.mark.parametrize(
    ("body", "place", "kind"),
    [
        (pending_body(pending('"SECRET-12.00"')), "items.0.amount", "decimal_parsing"),
        (pending_body(pending("-12.00", date="SECRET")), "items.0.date", "datetime_from_date_parsing"),
        ('{"success": true, "items": "SECRET"}', "items", "list_type"),
    ],
    ids=["amount-not-a-number", "date-not-a-date", "list-not-a-list"],
)
async def test_a_pending_list_in_the_wrong_shape_holds_back_the_accounts_and_logs_where(body, place, kind, caplog):
    """A pending set that can't be read isn't an empty one, and the log says where it differs without repeating it"""
    caplog.set_level(logging.DEBUG)
    api = (
        AkahuApi()
        .serve("/accounts", accounts_body(account("acc_chq")))
        .serve("/accounts/acc_chq/transactions", transactions_body(transaction()))
        .serve("/transactions/pending", body)
    )

    result = await fetch(akahu_adapter(api.transport), "acc_chq", include_pending=True)

    assert result.accounts == ()
    assert result.account_errors["acc_chq"].kind is ProviderErrorKind.UNKNOWN
    assert f"{place} ({kind})" in _logged(caplog, _WIRE_LOGGER)


@pytest.mark.parametrize("path", ["/accounts", "/accounts/acc_chq/transactions", "/transactions/pending"])
@pytest.mark.parametrize("status", [401, 404, 429, 500])
async def test_a_refused_status_is_logged_with_the_request_path_and_nothing_private(path, status, caplog):
    """The log says which request Akahu refused and with what status, so an operator can tell a missing account from a rejected token"""
    caplog.set_level(logging.DEBUG)
    api = (
        AkahuApi()
        .serve("/accounts", accounts_body(account("acc_chq", name="Everyday Chequing")))
        .serve("/accounts/acc_chq/transactions", transactions_body(transaction()))
        .serve("/transactions/pending", pending_body(pending()))
        .serve(path, json_response('{"success": false, "message": "SECRET Everyday Chequing"}', status))
    )

    await fetch(akahu_adapter(api.transport), "acc_chq", include_pending=True)

    assert f"/v1{path} with status {status}" in _logged(caplog, _ADAPTER_LOGGER)


async def test_a_body_that_is_not_json_is_logged_without_the_body(caplog):
    """The log says the answer wasn't JSON and keeps none of it"""
    caplog.set_level(logging.DEBUG)
    api = AkahuApi().serve("/accounts", httpx.Response(200, content=b"SECRET Everyday Chequing 100.00"))

    result = await _discover(api)

    assert result.request_error is not None
    assert "isn't JSON" in _logged(caplog, _WIRE_LOGGER)
