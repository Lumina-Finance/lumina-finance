"""Enable Banking answers that don't fit the documented shape

Guards what a sign-in and a sync do with valid JSON in the wrong shape. An answer whose own fields
can't be read fails the step it answers. One bank, account, balance or transaction that can't be read
is skipped with a warning that counts it, and the rest of the answer is kept. Each time the log says
which field and what kind of mismatch, never the value that was sent, since the answer holds the
user's account names and amounts
"""

import logging
from datetime import UTC, datetime

import pytest

from app.services.bank_sync.providers.contract import ProviderErrorKind, ProviderUnreachable
from app.services.bank_sync.providers.enable_banking import adapter as adapter_module
from tests.services.bank_sync.providers.enable_banking.stand_ins import (
    CARD,
    CHECKING,
    CODE,
    COUNTRY,
    REDIRECT_URL,
    SESSION_ID,
    STATE,
    SUPPLIED,
    EnableBankingApi,
    balance,
    balances_body,
    enable_banking_adapter,
    fetch,
    session_account,
    session_body,
    transaction,
    transactions_body,
)

_LOGGER = "app.services.bank_sync.providers.enable_banking.wire"
_BALANCES = balances_body(balance("CLBD", "1500.50"))


@pytest.fixture(autouse=True)
def _reads_on_5_october(monkeypatch):
    """Make every read happen two days after the stand-in window, so the window is read by its exact dates"""
    monkeypatch.setattr(adapter_module, "_read_time", lambda: datetime(2026, 10, 5, 12, 0, tzinfo=UTC))


def _logged_mismatches(caplog) -> str:
    """Return what the wire module logged, and prove no value that was sent reached any log"""
    assert "SECRET" not in caplog.text
    return " ".join(record.getMessage() for record in caplog.records if record.name == _LOGGER)


def _api(checking: str, card: str = "", *, checking_balances: str = _BALANCES) -> EnableBankingApi:
    """Return Enable Banking holding the checking account and the card, with the checking account's answers given"""
    return (
        EnableBankingApi()
        .serve_account("uid-checking", balances=checking_balances, transactions=checking)
        .serve_account("uid-card", balances=_BALANCES, transactions=card or transactions_body())
    )


@pytest.mark.parametrize(
    ("body", "place", "kind"),
    [
        ('{"banks": []}', "aspsps", "missing"),
        ('{"aspsps": "SECRET"}', "aspsps", "list_type"),
        ('["SECRET"]', "", "model_type"),
    ],
    ids=["no-list", "list-not-a-list", "not-an-object"],
)
async def test_a_bank_list_in_the_wrong_shape_leaves_the_sign_in_to_be_tried_again_and_logs_where(body, place, kind, caplog):
    """The first answer of a sign-in that can't be read is no verdict on the key or the bank"""
    caplog.set_level(logging.DEBUG)
    api = EnableBankingApi().serve("GET", "/aspsps", body)

    with pytest.raises(ProviderUnreachable):
        await enable_banking_adapter(api.transport).start_authorization(SUPPLIED, redirect_url=REDIRECT_URL, state=STATE)

    assert f"{place} ({kind})" in _logged_mismatches(caplog)


async def test_a_bank_in_the_list_that_cannot_be_read_is_skipped_and_the_others_still_found(caplog):
    """One odd entry among Enable Banking's banks doesn't stop the user signing in at theirs"""
    caplog.set_level(logging.DEBUG)
    body = f'{{"aspsps": [{{"country": "{COUNTRY}", "logo": "SECRET"}}, {{"name": "Aurora Bank", "country": "{COUNTRY}"}}]}}'
    api = EnableBankingApi().serve_session(session_account("uid-checking", CHECKING)).serve("GET", "/aspsps", body)

    url = await enable_banking_adapter(api.transport).start_authorization(SUPPLIED, redirect_url=REDIRECT_URL, state=STATE)

    assert url == "https://bank.example/sign-in?x=1"
    logged = _logged_mismatches(caplog)
    assert "Skipped 1 of 2 items" in logged
    assert "aspsps.0.name (missing)" in logged


@pytest.mark.parametrize(
    ("body", "place", "kind"),
    [
        ('{"accounts": [], "aspsp": {"name": "SECRET", "country": "FI"}}', "session_id", "missing"),
        (f'{{"session_id": "{SESSION_ID}", "accounts": "SECRET"}}', "accounts", "list_type"),
        (f'{{"session_id": "{SESSION_ID}"}}', "accounts", "missing"),
    ],
    ids=["no-session-id", "accounts-not-a-list", "no-accounts"],
)
async def test_a_session_in_the_wrong_shape_leaves_the_sign_in_to_be_tried_again_and_logs_where(body, place, kind, caplog):
    """A session answer that can't be read stores nothing and blames neither the key nor the code"""
    caplog.set_level(logging.DEBUG)
    api = EnableBankingApi().serve("POST", "/sessions", body)

    with pytest.raises(ProviderUnreachable):
        await enable_banking_adapter(api.transport).claim_authorized(SUPPLIED, code=CODE)

    assert f"{place} ({kind})" in _logged_mismatches(caplog)


async def test_an_account_in_the_session_that_cannot_be_read_is_skipped_and_the_others_stored(caplog):
    """An account missing its required identification hash can't be linked, but the other one shared still connects"""
    caplog.set_level(logging.DEBUG)
    unreadable = '{"uid": "uid-odd", "details": "SECRET", "currency": "EUR", "cash_account_type": "CACC"}'
    api = EnableBankingApi().serve("POST", "/sessions", session_body(unreadable, session_account("uid-checking", CHECKING)))

    stored = await enable_banking_adapter(api.transport).claim_authorized(SUPPLIED, code=CODE)

    assert '"identification_hash": "hash-checking"' in stored
    assert "uid-odd" not in stored
    logged = _logged_mismatches(caplog)
    assert "Skipped 1 of 2 items" in logged
    assert "accounts.0.identification_hash (missing)" in logged


@pytest.mark.parametrize(
    ("body", "place", "kind"),
    [
        ('{"items": []}', "balances", "missing"),
        ('{"balances": "SECRET"}', "balances", "list_type"),
    ],
    ids=["no-list", "list-not-a-list"],
)
async def test_a_balance_list_in_the_wrong_shape_fails_only_its_account_and_logs_where(body, place, kind, caplog):
    """A balance list that can't be read is the account's error, since the account is synced whole or not at all"""
    caplog.set_level(logging.DEBUG)
    api = _api(transactions_body(), checking_balances=body)

    result = await fetch(enable_banking_adapter(api.transport), CHECKING, CARD)

    assert result.request_error is None
    assert [found.external_id for found in result.accounts] == [CARD]
    assert result.account_errors[CHECKING].kind is ProviderErrorKind.UNKNOWN
    assert f"{place} ({kind})" in _logged_mismatches(caplog)


async def test_a_balance_that_cannot_be_read_is_skipped_and_the_others_still_give_the_figures(caplog):
    """An interim balance with an amount that isn't a number leaves the closing one to be the booked balance"""
    caplog.set_level(logging.DEBUG)
    balances = balances_body(balance("ITBD", "SECRET-12.34"), balance("CLBD", "1500.50"), balance("ITAV", "1400.25"))
    api = _api(transactions_body(), checking_balances=balances)

    result = await fetch(enable_banking_adapter(api.transport), CHECKING)

    [checking] = result.accounts
    assert (checking.balance, checking.available_balance) == (150050, 140025)
    assert "balances.0.balance_amount.amount (decimal_parsing)" in _logged_mismatches(caplog)


@pytest.mark.parametrize(
    ("body", "place", "kind"),
    [
        ('{"continuation_key": null}', "transactions", "missing"),
        ('{"transactions": "SECRET"}', "transactions", "list_type"),
        ('"SECRET"', "", "model_type"),
    ],
    ids=["no-list", "list-not-a-list", "not-an-object"],
)
async def test_a_transaction_list_in_the_wrong_shape_fails_only_its_account_and_logs_where(body, place, kind, caplog):
    """A list that can't be read is the account's error, and the other account still syncs"""
    caplog.set_level(logging.DEBUG)
    api = _api(body)

    result = await fetch(enable_banking_adapter(api.transport), CHECKING, CARD)

    assert result.request_error is None
    assert [found.external_id for found in result.accounts] == [CARD]
    assert result.account_errors[CHECKING].kind is ProviderErrorKind.UNKNOWN
    assert f"{place} ({kind})" in _logged_mismatches(caplog)


async def test_transactions_that_cannot_be_read_are_skipped_counted_and_the_rest_of_every_account_imported(caplog):
    """An incomplete pending item or an amount that isn't a number costs only that item, and the sync says how many were left out"""
    caplog.set_level(logging.DEBUG)
    incomplete_pending = '{"entry_reference": "SECRET-ref", "transaction_amount": {"amount": "2.00", "currency": "EUR"}, "status": "PDNG"}'
    checking = transactions_body(transaction(entry_reference="kept-1"), incomplete_pending)
    card = transactions_body(transaction("SECRET-9.99", entry_reference="bad-amount"), transaction(entry_reference="kept-2"))
    api = _api(checking, card)

    result = await fetch(enable_banking_adapter(api.transport), CHECKING, CARD, include_pending=True)

    assert result.request_error is None
    assert result.account_errors == {}
    assert {found.external_id: [record.external_id for record in found.records] for found in result.accounts} == {
        CHECKING: ["kept-1"],
        CARD: ["kept-2"],
    }
    assert [warning.reason for warning in result.warnings] == [
        "2 transactions from Enable Banking aren't imported: they don't have the fields Enable Banking documents"
    ]
    logged = _logged_mismatches(caplog)
    assert "transactions.1.credit_debit_indicator (missing)" in logged
    assert "transactions.0.transaction_amount.amount (decimal_parsing)" in logged


async def test_one_transaction_that_cannot_be_read_is_counted_in_the_singular():
    """The warning reads naturally for a single item"""
    api = _api(transactions_body(transaction(entry_reference="kept"), '{"status": "BOOK"}'))

    result = await fetch(enable_banking_adapter(api.transport), CHECKING)

    assert [warning.reason for warning in result.warnings] == [
        "1 transaction from Enable Banking isn't imported: it doesn't have the fields Enable Banking documents"
    ]


@pytest.mark.parametrize("key", ['""', '"  "'], ids=["empty", "blank"])
async def test_a_blank_continuation_key_is_the_last_page(key):
    """Asking again with a blank key would read the first page over, so a blank key ends the read like a null one"""
    page = f'{{"transactions": [{transaction(entry_reference="only")}], "continuation_key": {key}}}'
    api = _api(page)

    result = await fetch(enable_banking_adapter(api.transport), CHECKING)

    assert [record.external_id for record in result.accounts[0].records] == ["only"]
    assert [path for path in api.paths() if path.endswith("/transactions")] == ["GET /accounts/uid-checking/transactions"]
    assert result.account_errors == {}
