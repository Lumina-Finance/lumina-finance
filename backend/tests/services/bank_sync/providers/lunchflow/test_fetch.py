"""Lunch Flow fetch tests

Guards what a sync stores from Lunch Flow: the window it asks for, amounts read exactly from JSON
numbers and kept raw when they can't be stored, the failures that stop every account against the ones
that stop only one, and the signs a response was cut short or its rows can't be told apart
"""

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
import pytest

from app.models.bank_sync_job import ProviderErrorKind
from app.services.bank_sync.providers.contract import FetchResult
from app.services.bank_sync.providers.lunchflow.adapter import LunchFlowAdapter
from tests.services.bank_sync.providers.lunchflow.stand_ins import (
    API_KEY,
    LunchFlowApi,
    account,
    accounts_body,
    json_response,
    lunchflow_adapter,
    transaction,
    transactions_body,
)

_EXPONENTS = {"CAD": 2, "JPY": 0}
_TORONTO = ZoneInfo("America/Toronto")

# Three whole days in Toronto, 1 to 3 October 2026
_START = datetime(2026, 10, 1, tzinfo=_TORONTO)
_END = datetime(2026, 10, 4, tzinfo=_TORONTO)


async def _fetch(
    adapter: LunchFlowAdapter, *account_ids: str, start: datetime = _START, end: datetime = _END, include_pending: bool = False
) -> FetchResult:
    """Fetch a window of records for accounts, for a user in Toronto"""
    return await adapter.fetch(
        API_KEY,
        account_ids=account_ids,
        start=start,
        end=end,
        include_pending=include_pending,
        timezone=_TORONTO,
        currency_exponents=_EXPONENTS,
    )


def _api_with_one_account(*transactions: str, total: int | None = None, currency: str = "CAD", balance: str = "100.00") -> LunchFlowApi:
    """Return Lunch Flow holding one account with the given transactions"""
    chequing = account(11, currency=currency)
    return (
        LunchFlowApi()
        .serve("/accounts", accounts_body(chequing))
        .serve_account(chequing, balance=balance, transactions=transactions_body(*transactions, total=total))
    )


@pytest.mark.parametrize(("include_pending", "sent"), [(False, "false"), (True, "true")])
async def test_fetch_asks_for_each_account_over_the_inclusive_days_of_the_window(include_pending, sent):
    """The window's last day is the one before its end, and pending is asked for exactly as told"""
    chequing = account(11)
    visa = account(12, name="Rewards Visa")
    api = LunchFlowApi().serve("/accounts", accounts_body(chequing, visa)).serve_account(chequing).serve_account(visa)

    result = await _fetch(lunchflow_adapter(api.transport), "11", "12", include_pending=include_pending)

    assert result.request_error is None
    assert [found.external_id for found in result.accounts] == ["11", "12"]
    transaction_requests = [request for request in api.requests if request.url.path.endswith("/transactions")]
    assert sorted(request.url.path for request in transaction_requests) == [
        "/api/v1/accounts/11/transactions",
        "/api/v1/accounts/12/transactions",
    ]
    for request in transaction_requests:
        assert dict(request.url.params) == {"from": "2026-10-01", "to": "2026-10-03", "include_pending": sent}
        assert request.headers["x-api-key"] == API_KEY
    assert sorted(api.paths()).count("/api/v1/accounts") == 1
    assert {"/api/v1/accounts/11/balance", "/api/v1/accounts/12/balance"} <= set(api.paths())


async def test_fetch_dates_the_window_in_the_users_timezone_across_a_clock_change():
    """The days are the user's, so a window spanning the autumn clock change still ends on the day before its end"""
    api = _api_with_one_account()
    start = datetime(2026, 10, 31, tzinfo=_TORONTO)
    end = datetime(2026, 11, 3, tzinfo=_TORONTO)

    await _fetch(lunchflow_adapter(api.transport), "11", start=start, end=end)

    [request] = [request for request in api.requests if request.url.path.endswith("/transactions")]
    assert (request.url.params["from"], request.url.params["to"]) == ("2026-10-31", "2026-11-02")


async def test_fetch_reads_amounts_exactly_from_the_json_numbers():
    """10.07 and 0.29 are the two figures a float turns into 1006.999... and 28.999... minor units, so any float on the way shows"""
    api = _api_with_one_account(
        transaction("t1", "10.07", description="Refund"),
        transaction("t2", "-0.29", description="Fee"),
        transaction("t3", "-1234567.89", description="Deposit"),
        transaction("t4", "250", description="Whole number"),
        # More digits than a float holds, so any float on the way changes the figure
        transaction("t5", "9007199254740993.01", description="Large"),
        balance="1234567.89",
    )

    result = await _fetch(lunchflow_adapter(api.transport), "11")

    [chequing] = result.accounts
    assert chequing.balance == 123456789
    assert [(record.external_id, record.amount, record.raw_amount) for record in chequing.records] == [
        ("t1", 1007, "10.07"),
        ("t2", -29, "-0.29"),
        ("t3", -123456789, "-1234567.89"),
        ("t4", 25000, "250"),
        ("t5", 900719925474099301, "9007199254740993.01"),
    ]


async def test_fetch_keeps_an_amount_with_more_decimals_than_the_currency_holds_as_sent_and_unstored():
    """1.005 can't be stored exactly in cents, so it keeps its raw amount alone rather than a rounded figure"""
    api = _api_with_one_account(transaction("t1", "1.005"))

    result = await _fetch(lunchflow_adapter(api.transport), "11")

    [record] = result.accounts[0].records
    assert (record.amount, record.raw_amount) == (None, "1.005")


async def test_fetch_keeps_a_transaction_in_another_currency_than_its_account_as_sent_and_unstored():
    """An amount in euros can't be added to a Canadian dollar account, so only its raw amount is kept"""
    api = _api_with_one_account(transaction("t1", "-12.50", currency="EUR"), transaction("t2", "-12.50"))

    result = await _fetch(lunchflow_adapter(api.transport), "11")

    assert [(record.external_id, record.amount, record.raw_amount) for record in result.accounts[0].records] == [
        ("t1", None, "-12.50"),
        ("t2", -1250, "-12.50"),
    ]


async def test_fetch_reads_transactions_in_the_balance_currency_when_the_account_list_sends_none():
    """Lunch Flow's live account list has no currency, so the balance is read first and its currency sets each amount's minor unit"""
    yen = account(11, currency=None)
    api = (
        LunchFlowApi()
        .serve("/accounts", accounts_body(yen))
        .serve_account(
            yen,
            balance="120000",
            currency="JPY",
            transactions=transactions_body(transaction("t1", "-1500", currency="JPY"), transaction("t2", "-12.50", currency="EUR")),
        )
    )

    result = await _fetch(lunchflow_adapter(api.transport), "11")

    [found] = result.accounts
    assert (found.currency, found.balance) == ("JPY", 120000)
    assert [(record.external_id, record.amount) for record in found.records] == [("t1", -1500), ("t2", None)]
    assert api.paths().index("/api/v1/accounts/11/balance") < api.paths().index("/api/v1/accounts/11/transactions")


async def test_fetch_keeps_amounts_unstored_for_a_currency_lumina_does_not_hold():
    """A currency with no known exponent has no minor unit to read an amount at"""
    api = _api_with_one_account(transaction("t1", "-12.50", currency="XYZ"), currency="XYZ")

    result = await _fetch(lunchflow_adapter(api.transport), "11")

    [chequing] = result.accounts
    assert (chequing.currency, chequing.currency_raw, chequing.balance) == ("XYZ", "XYZ", None)
    assert [(record.amount, record.raw_amount) for record in chequing.records] == [(None, "-12.50")]


async def test_fetch_reads_the_dates_pending_flags_and_descriptions_of_transactions():
    """The date is the transaction's own, pending is kept for the engine, and the bank's description beats the merchant name"""
    api = _api_with_one_account(
        transaction("t1", date="2026-09-30", pending=True),
        transaction("t2", merchant="Corner Store", description=None),
        transaction("t3", merchant=None, description="  ETRANSFER  "),
    )

    result = await _fetch(lunchflow_adapter(api.transport), "11", include_pending=True)

    assert [(record.date, record.pending, record.description, record.removed) for record in result.accounts[0].records] == [
        (date(2026, 9, 30), True, "EFTPOS BEAN THERE CAFE", False),
        (date(2026, 10, 1), False, "Corner Store", False),
        (date(2026, 10, 1), False, "ETRANSFER", False),
    ]


@pytest.mark.parametrize("missing_id", [None, "", "   "], ids=["absent", "empty", "blank"])
async def test_fetch_leaves_out_transactions_without_an_id_and_warns(missing_id):
    """Rows that can't be told apart from one another aren't imported, and the sync says how many were left out"""
    api = _api_with_one_account(transaction("t1"), transaction(missing_id), transaction(missing_id, "-9.99"))

    result = await _fetch(lunchflow_adapter(api.transport), "11")

    assert [record.external_id for record in result.accounts[0].records] == ["t1"]
    [warning] = result.warnings
    assert warning.reason == "2 transactions from Lunch Flow aren't imported: they have no id"


async def test_fetch_warns_about_one_transaction_without_an_id_in_the_singular():
    """A single row left out is counted as one transaction in the singular"""
    api = _api_with_one_account(transaction("t1"), transaction(None))

    result = await _fetch(lunchflow_adapter(api.transport), "11")

    [warning] = result.warnings
    assert warning.reason == "1 transaction from Lunch Flow isn't imported: it has no id"


@pytest.mark.parametrize(("total", "cut_off"), [(2, False), (3, True)], ids=["whole", "cut-off"])
async def test_fetch_flags_a_response_holding_fewer_transactions_than_lunch_flow_says_it_has(total, cut_off):
    """Lunch Flow documents no paging, so a total above the rows sent means they can't be taken as complete"""
    api = _api_with_one_account(transaction("t1"), transaction("t2"), total=total)

    result = await _fetch(lunchflow_adapter(api.transport), "11")

    assert result.possibly_cut_off is cut_off
    assert len(result.accounts[0].records) == 2


async def test_fetch_reports_a_failed_account_and_still_returns_the_others():
    """One account's failed transactions request is an error for it, never a drop that would read as the account vanishing"""
    chequing = account(11)
    savings = account(12, name="Online Savings")
    api = LunchFlowApi().serve("/accounts", accounts_body(chequing, savings))
    api.serve_account(chequing, transactions=transactions_body(transaction("t1")))
    api.serve("/accounts/12/transactions", '{"error": "Internal", "message": "Bank unavailable"}', 500)
    api.serve("/accounts/12/balance", '{"balance": {"amount": 1, "currency": "CAD"}}')

    result = await _fetch(lunchflow_adapter(api.transport), "11", "12")

    assert result.request_error is None
    assert [found.external_id for found in result.accounts] == ["11"]
    assert set(result.account_errors) == {"12"}
    assert result.account_errors["12"].kind is ProviderErrorKind.TEMPORARY


async def test_fetch_reports_an_account_whose_balance_failed_though_its_transactions_arrived():
    """An account is synced whole or not at all, so a failed balance beside good transactions is its error"""
    chequing = account(11)
    api = LunchFlowApi().serve("/accounts", accounts_body(chequing))
    api.serve("/accounts/11/transactions", transactions_body(transaction("t1")))
    api.serve("/accounts/11/balance", httpx.ReadTimeout("slow"))

    result = await _fetch(lunchflow_adapter(api.transport), "11")

    assert result.accounts == ()
    assert set(result.account_errors) == {"11"}
    assert result.account_errors["11"].kind is ProviderErrorKind.TEMPORARY


@pytest.mark.parametrize("unreadable", ["transactions", "balance"])
async def test_fetch_with_an_unreadable_answer_reports_the_account_as_unknown_not_an_outage(unreadable):
    """An answer that can't be read isn't the provider being down, so the engine must not retry it without end"""
    chequing = account(11)
    api = LunchFlowApi().serve("/accounts", accounts_body(chequing))
    api.serve("/accounts/11/transactions", "not json" if unreadable == "transactions" else transactions_body(transaction("t1")))
    api.serve("/accounts/11/balance", "not json")

    result = await _fetch(lunchflow_adapter(api.transport), "11")

    assert result.account_errors["11"].kind is ProviderErrorKind.UNKNOWN


async def test_fetch_for_an_account_the_listing_leaves_out_reports_it_as_unknown_not_an_outage():
    """A bank account missing from Lunch Flow's answer is no outage, so it gets one retry series and then stops"""
    api = LunchFlowApi().serve("/accounts", accounts_body(account(11)))

    result = await _fetch(lunchflow_adapter(api.transport), "99")

    assert result.account_errors["99"].kind is ProviderErrorKind.UNKNOWN


async def test_fetch_with_an_unreadable_account_list_fails_the_request_as_unknown():
    """An account list that can't be read is no outage"""
    api = LunchFlowApi().serve("/accounts", "not json")

    result = await _fetch(lunchflow_adapter(api.transport), "11")

    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.UNKNOWN


async def test_fetch_meeting_a_429_fails_every_account_as_rate_limited():
    """A spent quota fails the request, so the engine marks the budget spent rather than treating one account as the problem"""
    chequing = account(11)
    savings = account(12)
    api = LunchFlowApi().serve("/accounts", accounts_body(chequing, savings)).serve_account(chequing).serve_account(savings)
    api.serve("/accounts/12/transactions", json_response('{"error": "Too Many Requests"}', 429))

    result = await _fetch(lunchflow_adapter(api.transport), "11", "12")

    assert result.accounts == ()
    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.RATE_LIMITED


@pytest.mark.parametrize("status", [401, 403])
async def test_fetch_with_a_key_that_stopped_working_fails_the_request_as_rejected(status):
    """A key revoked in Lunch Flow fails the whole request so the user is asked to reconnect"""
    api = LunchFlowApi().serve("/accounts", '{"error": "Unauthorized", "message": "Invalid API key"}', status)

    result = await _fetch(lunchflow_adapter(api.transport), "11")

    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.CREDENTIAL_REJECTED
    assert API_KEY not in result.request_error.reason


async def test_fetch_reports_an_account_lunch_flow_no_longer_lists():
    """An account asked for that the listing leaves out has an error of its own, so the sync can say why"""
    api = _api_with_one_account()

    result = await _fetch(lunchflow_adapter(api.transport), "11", "99")

    assert [found.external_id for found in result.accounts] == ["11"]
    assert set(result.account_errors) == {"99"}
    assert result.account_errors["99"].reason == "Lunch Flow didn't return this account"


async def test_fetch_syncs_nothing_for_an_account_that_is_not_active():
    """An account Lunch Flow no longer calls ACTIVE comes back with no records, and its connection needs attention in Lunch Flow"""
    expired = account(12, connection_id=9, currency=None, status="EXPIRED")
    api = LunchFlowApi().serve("/accounts", accounts_body(expired))

    result = await _fetch(lunchflow_adapter(api.transport), "12")

    assert result.accounts == ()
    assert result.account_errors == {}
    assert set(result.login_errors) == {"9"}
    assert result.login_errors["9"].kind is ProviderErrorKind.BANK_LOGIN_NEEDED
    assert api.paths() == ["/api/v1/accounts"]


async def test_fetch_sends_only_for_the_accounts_asked_for():
    """Accounts the key reaches that aren't linked cost no requests"""
    chequing = account(11)
    savings = account(12, name="Online Savings")
    api = LunchFlowApi().serve("/accounts", accounts_body(chequing, savings)).serve_account(chequing)

    await _fetch(lunchflow_adapter(api.transport), "11")

    assert sorted(api.paths()) == ["/api/v1/accounts", "/api/v1/accounts/11/balance", "/api/v1/accounts/11/transactions"]


@pytest.mark.parametrize(
    ("start", "end"),
    [
        (datetime(2026, 10, 1), datetime(2026, 10, 2, tzinfo=UTC)),
        (datetime(2026, 10, 2, tzinfo=UTC), datetime(2026, 10, 2, tzinfo=UTC)),
        (_START, _START + timedelta(days=91)),
    ],
    ids=["naive", "empty", "over-the-limit"],
)
async def test_fetch_refuses_a_window_that_is_naive_empty_or_longer_than_the_limit(start, end):
    """The engine never sends one, so a caller that does is told, and nothing is sent"""
    api = _api_with_one_account()

    with pytest.raises(ValueError, match="Lunch Flow window"):
        await _fetch(lunchflow_adapter(api.transport), "11", start=start, end=end)

    assert api.requests == []
