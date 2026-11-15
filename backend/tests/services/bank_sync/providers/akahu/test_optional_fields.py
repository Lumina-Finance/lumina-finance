"""Akahu answers that leave out fields its reference doesn't require

Guards that a field Akahu may omit costs only what it describes: an account listed without a balance
has no currency to be stored with, so it alone is left out and the others still list and sync, a
cursor that is null or absent is the last page, and a pending transaction missing its date, amount or
account is the only item skipped, with a warning saying how many
"""

import pytest

from app.models.bank_sync_job import ProviderErrorKind
from tests.services.bank_sync.providers.akahu.stand_ins import (
    CREDENTIAL,
    EXPONENTS,
    AkahuApi,
    account,
    accounts_body,
    akahu_adapter,
    fetch,
    pending,
    pending_body,
    transaction,
    transactions_body,
)

_NO_CURRENCY = "Akahu didn't say which currency this account is in"


async def test_discovery_leaves_out_an_active_account_listed_without_a_balance_and_lists_the_rest():
    """With no balance there is no currency, so that account has an error of its own and nobody else loses theirs"""
    api = AkahuApi().serve("/accounts", accounts_body(account("acc_chq"), account("acc_new", name="New Savings", has_balance=False)))

    result = await akahu_adapter(api.transport).discover(CREDENTIAL, currency_exponents=EXPONENTS)

    assert result.request_error is None
    assert [found.external_id for found in result.accounts] == ["acc_chq"]
    assert set(result.account_errors) == {"acc_new"}
    assert result.account_errors["acc_new"].kind is ProviderErrorKind.UNKNOWN
    assert result.account_errors["acc_new"].reason == _NO_CURRENCY


async def test_discovery_leaves_out_an_inactive_account_listed_without_a_balance_and_still_asks_for_its_reconnection():
    """An inactive account has no balance to read anyway, so its bank's login error is what reaches the user"""
    inactive = account("acc_old", connection_id="conn_old", status="INACTIVE", has_balance=False)
    api = AkahuApi().serve("/accounts", accounts_body(account("acc_chq"), inactive))

    result = await akahu_adapter(api.transport).discover(CREDENTIAL, currency_exponents=EXPONENTS)

    assert [found.external_id for found in result.accounts] == ["acc_chq"]
    assert result.account_errors == {}
    assert set(result.login_errors) == {"conn_old"}


async def test_fetch_gives_an_account_listed_without_a_balance_an_error_of_its_own_and_syncs_the_others():
    """No request is made for the account that can't be stored, and the other account's records still arrive"""
    api = (
        AkahuApi()
        .serve("/accounts", accounts_body(account("acc_chq"), account("acc_new", name="New Savings", has_balance=False)))
        .serve("/accounts/acc_chq/transactions", transactions_body(transaction()))
    )

    result = await fetch(akahu_adapter(api.transport), "acc_chq", "acc_new")

    assert result.request_error is None
    assert [(found.external_id, len(found.records)) for found in result.accounts] == [("acc_chq", 1)]
    assert set(result.account_errors) == {"acc_new"}
    assert result.account_errors["acc_new"].kind is ProviderErrorKind.UNKNOWN
    assert result.account_errors["acc_new"].reason == _NO_CURRENCY
    assert api.paths() == ["/v1/accounts", "/v1/accounts/acc_chq/transactions"]


@pytest.mark.parametrize(
    "body",
    [
        '{"success": true, "items": [%s], "cursor": null}',
        '{"success": true, "items": [%s]}',
        '{"success": true, "items": [%s], "cursor": {}}',
    ],
    ids=["null-cursor", "no-cursor", "empty-cursor"],
)
async def test_fetch_reads_a_cursor_that_is_null_or_absent_as_the_last_page(body):
    """Akahu's reference doesn't say whether the cursor can be null or left out, so neither makes the account unreadable"""
    api = AkahuApi().serve("/accounts", accounts_body(account("acc_chq"))).serve("/accounts/acc_chq/transactions", body % transaction())

    result = await fetch(akahu_adapter(api.transport), "acc_chq")

    assert result.account_errors == {}
    assert [len(found.records) for found in result.accounts] == [1]
    assert result.possibly_cut_off is False
    assert api.paths().count("/v1/accounts/acc_chq/transactions") == 1


def _pending_without(field: str) -> str:
    """Return a pending transaction with one field left out"""
    item = pending("-5.00", description="CARD PURCHASE BAKERY")
    start = item.index(f'"{field}"')
    end = item.index(", ", start) + 2
    return item[:start] + item[end:]


async def test_fetch_skips_only_the_pending_transactions_missing_a_date_an_amount_or_an_account_and_says_how_many():
    """No pending field is required, so an incomplete item is left out with a warning while every account still syncs"""
    api = (
        AkahuApi()
        .serve("/accounts", accounts_body(account("acc_chq"), account("acc_sav", name="Online Savings")))
        .serve("/accounts/acc_chq/transactions", transactions_body(transaction()))
        .serve("/accounts/acc_sav/transactions", transactions_body())
        .serve(
            "/transactions/pending",
            pending_body(pending("-12.00"), _pending_without("date"), _pending_without("amount"), _pending_without("_account")),
        )
    )

    result = await fetch(akahu_adapter(api.transport), "acc_chq", "acc_sav", include_pending=True)

    assert result.request_error is None
    assert result.account_errors == {}
    assert [(found.external_id, [(record.pending, record.amount) for record in found.records]) for found in result.accounts] == [
        ("acc_chq", [(False, -450), (True, -1200)]),
        ("acc_sav", []),
    ]
    assert [warning.reason for warning in result.warnings] == [
        "3 pending transactions from Akahu aren't shown: they're missing a date, an amount or an account"
    ]


async def test_fetch_with_one_incomplete_pending_transaction_words_the_warning_for_one():
    """The warning counts what was left out, so a single item reads in the singular"""
    api = (
        AkahuApi()
        .serve("/accounts", accounts_body(account("acc_chq")))
        .serve("/accounts/acc_chq/transactions", transactions_body())
        .serve("/transactions/pending", pending_body(_pending_without("amount")))
    )

    result = await fetch(akahu_adapter(api.transport), "acc_chq", include_pending=True)

    assert [warning.reason for warning in result.warnings] == [
        "1 pending transaction from Akahu isn't shown: it's missing a date, an amount or an account"
    ]


async def test_fetch_ignores_an_incomplete_pending_transaction_of_an_account_it_was_not_asked_for():
    """A pending item that names another account is dropped as before, with no warning about it"""
    api = (
        AkahuApi()
        .serve("/accounts", accounts_body(account("acc_chq"), account("acc_sav", name="Online Savings")))
        .serve("/accounts/acc_chq/transactions", transactions_body())
        .serve("/transactions/pending", pending_body(_pending_without("amount").replace("acc_chq", "acc_sav")))
    )

    result = await fetch(akahu_adapter(api.transport), "acc_chq", include_pending=True)

    assert result.warnings == ()
