"""Lunch Flow answers that don't fit the documented shape

Guards what a sync does with valid JSON in the wrong shape: an account list that can't be read fails
the request, a balance or transaction list that can't be read fails only its account, and each time
the log says which field and what kind of mismatch, never the value that was sent, since the answer
holds the user's account names and amounts
"""

import logging
from datetime import UTC, datetime

import pytest

from app.models.bank_sync_job import ProviderErrorKind
from tests.services.bank_sync.providers.lunchflow.stand_ins import (
    API_KEY,
    LunchFlowApi,
    account,
    accounts_body,
    lunchflow_adapter,
    transaction,
    transactions_body,
)

_EXPONENTS = {"CAD": 2}
_START = datetime(2026, 10, 1, tzinfo=UTC)
_END = datetime(2026, 10, 4, tzinfo=UTC)
_LOGGER = "app.services.bank_sync.providers.lunchflow.wire"


async def _discover(api: LunchFlowApi):
    """Discover the key's accounts"""
    return await lunchflow_adapter(api.transport).discover(API_KEY, currency_exponents=_EXPONENTS)


async def _fetch(api: LunchFlowApi):
    """Fetch account 11's last three days"""
    return await lunchflow_adapter(api.transport).fetch(
        API_KEY,
        account_ids=["11"],
        start=_START,
        end=_END,
        include_pending=False,
        timezone=UTC,
        currency_exponents=_EXPONENTS,
    )


def _logged_mismatches(caplog) -> str:
    """Return what the wire module logged, and prove no secret reached any log"""
    assert "SECRET" not in caplog.text
    return " ".join(record.getMessage() for record in caplog.records if record.name == _LOGGER)


@pytest.mark.parametrize(
    ("body", "place", "kind"),
    [
        ('{"accounts": [{"id": 11, "connection_id": 7, "name": "Everyday"}]}', "accounts.0.status", "missing"),
        ('{"accounts": [{"id": "SECRET-id", "connection_id": 7, "status": "ACTIVE"}]}', "accounts.0.id", "int_parsing"),
        ('{"total": 1}', "accounts", "missing"),
        ('{"accounts": "SECRET-list"}', "accounts", "list_type"),
        ('["SECRET"]', "", "model_type"),
    ],
    ids=["no-status", "id-not-a-number", "no-list", "list-not-a-list", "not-an-object"],
)
@pytest.mark.parametrize("operation", [_discover, _fetch])
async def test_an_account_list_in_the_wrong_shape_fails_the_request_and_logs_where(operation, body, place, kind, caplog):
    """An account list that can't be read is no outage, and the log names the field and the mismatch but not the value"""
    caplog.set_level(logging.DEBUG)
    api = LunchFlowApi().serve("/accounts", body)

    result = await operation(api)

    assert result.accounts == ()
    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.UNKNOWN
    assert f"{place} ({kind})" in _logged_mismatches(caplog)


@pytest.mark.parametrize(
    ("body", "place", "kind"),
    [
        ('{"amount": 5.00}', "balance", "missing"),
        ('{"balance": {"currency": "CAD"}}', "balance.amount", "missing"),
        ('{"balance": {"amount": "SECRET-12.34", "currency": "CAD"}}', "balance.amount", "decimal_parsing"),
        ('{"balance": "SECRET"}', "balance", "model_type"),
    ],
    ids=["no-balance", "no-amount", "amount-not-a-number", "balance-not-an-object"],
)
@pytest.mark.parametrize("operation", [_discover, _fetch])
async def test_a_balance_in_the_wrong_shape_fails_only_its_account_and_logs_where(operation, body, place, kind, caplog):
    """A balance that can't be read is the account's error, since the account is synced whole or not at all"""
    caplog.set_level(logging.DEBUG)
    chequing = account(11)
    savings = account(12, name="Online Savings")
    api = LunchFlowApi().serve("/accounts", accounts_body(chequing, savings))
    api.serve_account(savings)
    api.serve("/accounts/11/balance", body)
    api.serve("/accounts/11/transactions", transactions_body(transaction("t1")))

    result = await operation(api)

    assert result.request_error is None
    assert set(result.account_errors) == {"11"}
    assert result.account_errors["11"].kind is ProviderErrorKind.UNKNOWN
    assert f"{place} ({kind})" in _logged_mismatches(caplog)


@pytest.mark.parametrize(
    ("transactions", "place", "kind"),
    [
        (transactions_body(transaction("t1", '"SECRET-12.34"')), "transactions.0.amount", "decimal_parsing"),
        ('{"transactions": [{"id": "t1", "amount": 4.50, "currency": "CAD", "merchant": "SECRET"}]}', "transactions.0.date", "missing"),
        (transactions_body(transaction("t1"), transaction("t2", date="SECRET")), "transactions.1.date", "date_from_datetime_parsing"),
        ('{"total": 0}', "transactions", "missing"),
        ('{"transactions": "SECRET"}', "transactions", "list_type"),
    ],
    ids=["amount-not-a-number", "no-date", "date-not-a-date", "no-list", "list-not-a-list"],
)
async def test_a_transaction_list_in_the_wrong_shape_fails_only_its_account_and_logs_where(transactions, place, kind, caplog):
    """A list that can't be read is the account's error, and the log names the first rows' fields but never an amount or a name"""
    caplog.set_level(logging.DEBUG)
    chequing = account(11)
    savings = account(12, name="Online Savings")
    api = LunchFlowApi().serve("/accounts", accounts_body(chequing, savings))
    api.serve_account(chequing, transactions=transactions).serve_account(savings)

    result = await lunchflow_adapter(api.transport).fetch(
        API_KEY,
        account_ids=["11", "12"],
        start=_START,
        end=_END,
        include_pending=False,
        timezone=UTC,
        currency_exponents=_EXPONENTS,
    )

    assert result.request_error is None
    assert [found.external_id for found in result.accounts] == ["12"]
    assert set(result.account_errors) == {"11"}
    assert result.account_errors["11"].kind is ProviderErrorKind.UNKNOWN
    assert f"{place} ({kind})" in _logged_mismatches(caplog)
