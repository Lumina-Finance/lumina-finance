"""Akahu fetch tests

Guards what a sync stores from Akahu: the window it asks for, given Akahu's exclusive start and
inclusive end, every page of a cursor followed to its end, dates in the user's timezone, amounts read
exactly from JSON numbers and kept raw when they can't be stored, and the failures that stop every
account against the ones that stop only one
"""

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
import pytest

from app.models.bank_sync_job import ProviderErrorKind
from app.services.bank_sync.providers.akahu import adapter as akahu_module
from tests.services.bank_sync.providers.akahu.stand_ins import (
    APP_ID_TOKEN,
    TORONTO,
    USER_ACCESS_TOKEN,
    WINDOW_END,
    WINDOW_START,
    AkahuApi,
    account,
    accounts_body,
    akahu_adapter,
    fetch,
    json_response,
    transaction,
    transactions_body,
)

_AUCKLAND = ZoneInfo("Pacific/Auckland")


def _api_with_one_account(*transactions: str, current: str = "100.00", currency: str = "NZD") -> AkahuApi:
    """Return Akahu holding one chequing account with the given transactions on one page"""
    return (
        AkahuApi()
        .serve("/accounts", accounts_body(account(current=current, currency=currency)))
        .serve("/accounts/acc_chq/transactions", transactions_body(*transactions))
    )


def _transaction_requests(api: AkahuApi) -> list[httpx.Request]:
    """Return the requests for transactions"""
    return [request for request in api.requests if request.url.path.endswith("/transactions")]


async def test_fetch_asks_for_the_window_given_akahus_exclusive_start_and_inclusive_end():
    """The engine's window holds start and not end, so Akahu is asked from a millisecond before start to a millisecond before end, in UTC"""
    api = _api_with_one_account()

    await fetch(akahu_adapter(api.transport), "acc_chq")

    [request] = _transaction_requests(api)
    assert dict(request.url.params) == {"start": "2026-10-01T03:59:59.999Z", "end": "2026-10-04T03:59:59.999Z"}
    assert request.headers["authorization"] == f"Bearer {USER_ACCESS_TOKEN}"
    assert request.headers["x-akahu-id"] == APP_ID_TOKEN


async def test_fetch_windows_that_meet_leave_no_instant_asked_twice_or_missed():
    """The second window starts where the first ends, and Akahu's bounds put that instant in the second only"""
    api = _api_with_one_account()
    boundary = datetime(2026, 10, 4, tzinfo=TORONTO)
    adapter = akahu_adapter(api.transport)

    await fetch(adapter, "acc_chq", end=boundary)
    await fetch(adapter, "acc_chq", start=boundary, end=boundary + timedelta(days=3))

    first, second = _transaction_requests(api)
    first_end = datetime.fromisoformat(first.url.params["end"])
    second_start = datetime.fromisoformat(second.url.params["start"])
    # Akahu's end counts and its start doesn't, so the first covers up to a millisecond before the boundary and the second from it
    assert first_end + timedelta(milliseconds=1) == boundary.astimezone(UTC)
    assert second_start + timedelta(milliseconds=1) == boundary.astimezone(UTC)


async def test_fetch_follows_the_cursor_to_the_last_page_with_the_same_range():
    """Every page of an account is read, each asked for with the same start and end and the cursor the page before gave"""

    def page(request: httpx.Request) -> httpx.Response:
        """Answer each page by the cursor it was asked for"""
        cursor = request.url.params.get("cursor")
        if cursor is None:
            return json_response(transactions_body(transaction("trans_1", "-1.00"), next_cursor="page2"))
        if cursor == "page2":
            return json_response(transactions_body(transaction("trans_2", "-2.00"), next_cursor="page3"))
        return json_response(transactions_body(transaction("trans_3", "-3.00")))

    api = AkahuApi().serve("/accounts", accounts_body(account())).serve("/accounts/acc_chq/transactions", page)

    result = await fetch(akahu_adapter(api.transport), "acc_chq")

    [chequing] = result.accounts
    assert [record.external_id for record in chequing.records] == ["trans_1", "trans_2", "trans_3"]
    assert result.possibly_cut_off is False
    requests = _transaction_requests(api)
    assert [request.url.params.get("cursor") for request in requests] == [None, "page2", "page3"]
    assert {(request.url.params["start"], request.url.params["end"]) for request in requests} == {
        ("2026-10-01T03:59:59.999Z", "2026-10-04T03:59:59.999Z")
    }


async def test_fetch_that_meets_a_cursor_without_end_stops_and_says_it_was_cut_off(monkeypatch):
    """A cursor that never ends can't keep a sync going for ever, and what was read isn't taken as complete"""
    monkeypatch.setattr(akahu_module, "MAX_PAGES_PER_ACCOUNT", 3)
    api = (
        AkahuApi()
        .serve("/accounts", accounts_body(account()))
        .serve("/accounts/acc_chq/transactions", lambda _request: json_response(transactions_body(transaction(), next_cursor="again")))
    )

    result = await fetch(akahu_adapter(api.transport), "acc_chq")

    assert len(_transaction_requests(api)) == 3
    assert result.possibly_cut_off is True
    assert [warning.kind for warning in result.warnings] == [ProviderErrorKind.UNKNOWN]


@pytest.mark.parametrize(
    ("timezone", "stamps", "days"),
    [
        # 11:00 UTC is midnight in Auckland's summer, so Akahu's UTC stamp of a 2 October midnight falls on 1 October in UTC and Toronto
        (_AUCKLAND, ["2026-10-01T11:00:00.000Z", "2026-10-02T10:59:59.000Z"], [date(2026, 10, 2), date(2026, 10, 2)]),
        (
            TORONTO,
            ["2026-10-01T11:00:00.000Z", "2026-10-02T03:59:59.000Z", "2026-10-02T04:00:00.000Z"],
            [date(2026, 10, 1)] * 2 + [date(2026, 10, 2)],
        ),
    ],
    ids=["auckland", "toronto"],
)
async def test_fetch_dates_each_transaction_in_the_users_timezone(timezone, stamps, days):
    """A UTC timestamp near midnight lands on the user's own day, never the UTC one"""
    api = _api_with_one_account(*(transaction(f"trans_{number}", date=stamp) for number, stamp in enumerate(stamps)))

    result = await fetch(akahu_adapter(api.transport), "acc_chq", timezone=timezone)

    assert [record.date for record in result.accounts[0].records] == days


async def test_fetch_reads_amounts_exactly_from_the_json_numbers():
    """10.07 and 0.29 are the two figures a float turns into 1006.999... and 28.999... minor units, so any float on the way shows"""
    api = _api_with_one_account(
        transaction("t1", "10.07", description="Refund"),
        transaction("t2", "-0.29", description="Fee"),
        transaction("t3", "-1234567.89", description="Deposit"),
        transaction("t4", "250", description="Whole number"),
        # More digits than a float holds, so any float on the way changes the figure
        transaction("t5", "9007199254740993.01", description="Large"),
        current="1234567.89",
    )

    result = await fetch(akahu_adapter(api.transport), "acc_chq")

    [chequing] = result.accounts
    assert chequing.balance == 123456789
    assert [(record.external_id, record.amount, record.raw_amount, record.description) for record in chequing.records] == [
        ("t1", 1007, "10.07", "Refund"),
        ("t2", -29, "-0.29", "Fee"),
        ("t3", -123456789, "-1234567.89", "Deposit"),
        ("t4", 25000, "250", "Whole number"),
        ("t5", 900719925474099301, "9007199254740993.01", "Large"),
    ]
    assert not any(record.pending for record in chequing.records)


async def test_fetch_keeps_only_the_raw_amount_when_it_cannot_be_stored_exactly():
    """More decimals than the currency holds, or a currency Lumina has no exponent for, is never rounded into a figure"""
    precise = _api_with_one_account(transaction("t1", "-1.005"), transaction("t2", "-3"))
    unknown = _api_with_one_account(transaction("t3", "-12.50"), currency="XYZ")
    yen = _api_with_one_account(transaction("t4", "-300"), transaction("t5", "-300.5"), currency="JPY")

    precise_result = await fetch(akahu_adapter(precise.transport), "acc_chq")
    unknown_result = await fetch(akahu_adapter(unknown.transport), "acc_chq")
    yen_result = await fetch(akahu_adapter(yen.transport), "acc_chq")

    assert [(record.amount, record.raw_amount) for record in precise_result.accounts[0].records] == [(None, "-1.005"), (-300, "-3")]
    assert [(record.amount, record.raw_amount) for record in unknown_result.accounts[0].records] == [(None, "-12.50")]
    assert unknown_result.accounts[0].currency == "XYZ"
    assert [(record.amount, record.raw_amount) for record in yen_result.accounts[0].records] == [(-300, "-300"), (None, "-300.5")]


async def test_fetch_reads_transactions_only_for_accounts_that_have_them_and_active_ones():
    """An account without the TRANSACTIONS attribute is returned with its balance and no request, and an inactive one needs reconnecting"""
    chequing = account("acc_chq")
    loan = account("acc_loan", name="Home Loan", attributes='"PAYMENT_TO"', current="-250000.00")
    inactive = account("acc_old", connection_id="conn_old", name="Old Savings", status="INACTIVE")
    api = (
        AkahuApi()
        .serve("/accounts", accounts_body(chequing, loan, inactive))
        .serve("/accounts/acc_chq/transactions", transactions_body(transaction()))
    )

    result = await fetch(akahu_adapter(api.transport), "acc_chq", "acc_loan", "acc_old")

    assert [(found.external_id, found.balance, len(found.records)) for found in result.accounts] == [
        ("acc_chq", 10000, 1),
        ("acc_loan", -25000000, 0),
        ("acc_old", None, 0),
    ]
    assert set(result.login_errors) == {"conn_old"}
    assert result.login_errors["conn_old"].kind is ProviderErrorKind.BANK_LOGIN_NEEDED
    assert api.paths() == ["/v1/accounts", "/v1/accounts/acc_chq/transactions"]


async def test_fetch_warns_that_akahu_shares_no_transactions_for_an_account_without_the_attribute():
    """An account Akahu holds no transactions for syncs empty, so the sync says so, as a warning because no other window would help"""
    loan = account("acc_loan", name="Home Loan", attributes='"PAYMENT_TO"', current="-250000.00")
    inactive = account("acc_old", connection_id="conn_old", name="Old Savings", status="INACTIVE", attributes='"PAYMENT_TO"')
    api = (
        AkahuApi()
        .serve("/accounts", accounts_body(account("acc_chq"), loan, inactive))
        .serve("/accounts/acc_chq/transactions", transactions_body(transaction()))
    )

    result = await fetch(akahu_adapter(api.transport), "acc_chq", "acc_loan", "acc_old")

    assert result.account_errors == {}
    assert [warning.reason for warning in result.warnings] == [
        "Transactions from \"Home Loan\" aren't imported: Akahu doesn't offer them for this account"
    ]
    assert result.warnings[0].kind is ProviderErrorKind.UNKNOWN
    assert [found.external_id for found in result.accounts] == ["acc_chq", "acc_loan", "acc_old"]


async def test_fetch_sends_only_gets_and_never_asks_akahu_to_refresh():
    """Akahu refreshes a personal app daily, so no refresh is requested"""
    api = _api_with_one_account(transaction()).serve("/transactions/pending", '{"success": true, "items": []}')

    await fetch(akahu_adapter(api.transport), "acc_chq", include_pending=True)

    assert {request.method for request in api.requests} == {"GET"}
    assert not any("refresh" in path for path in api.paths())


async def test_fetch_with_one_account_failing_reports_that_account_and_returns_the_rest():
    """A failed account is an error of its own, never a silent drop that would read as the account vanishing"""
    chequing = account("acc_chq")
    savings = account("acc_sav", name="Online Savings")
    api = (
        AkahuApi()
        .serve("/accounts", accounts_body(chequing, savings))
        .serve("/accounts/acc_chq/transactions", transactions_body(transaction()))
        .serve("/accounts/acc_sav/transactions", '{"success": false, "message": "Bank unavailable"}', 500)
    )

    result = await fetch(akahu_adapter(api.transport), "acc_chq", "acc_sav")

    assert result.request_error is None
    assert [found.external_id for found in result.accounts] == ["acc_chq"]
    assert set(result.account_errors) == {"acc_sav"}
    assert result.account_errors["acc_sav"].kind is ProviderErrorKind.TEMPORARY


async def test_fetch_asking_for_an_account_akahu_no_longer_lists_reports_it_missing():
    """An account that is gone from the listing has an error saying so"""
    api = _api_with_one_account()

    result = await fetch(akahu_adapter(api.transport), "acc_chq", "acc_gone")

    assert [found.external_id for found in result.accounts] == ["acc_chq"]
    assert result.account_errors["acc_gone"].reason == "Akahu didn't return this account"
    assert result.account_errors["acc_gone"].kind is ProviderErrorKind.UNKNOWN


async def test_fetch_of_an_account_whose_page_cannot_be_read_reports_it_as_unknown():
    """An unreadable page isn't an outage, so it doesn't retry without end"""
    chequing = account("acc_chq")
    api = (
        AkahuApi()
        .serve("/accounts", accounts_body(chequing))
        .serve("/accounts/acc_chq/transactions", '{"success": true, "items": [{"nonsense": 1}]}')
    )

    result = await fetch(akahu_adapter(api.transport), "acc_chq")

    assert result.account_errors["acc_chq"].kind is ProviderErrorKind.UNKNOWN


@pytest.mark.parametrize(
    ("status", "kind"),
    [(401, ProviderErrorKind.CREDENTIAL_REJECTED), (403, ProviderErrorKind.CREDENTIAL_REJECTED), (429, ProviderErrorKind.RATE_LIMITED)],
)
async def test_fetch_meeting_a_rejection_or_a_spent_quota_on_a_page_fails_the_whole_request(status, kind):
    """Rejected tokens or a rate limit on any page stop every account, since the next request would meet the same answer"""
    chequing = account("acc_chq")
    savings = account("acc_sav", name="Online Savings")
    api = (
        AkahuApi()
        .serve("/accounts", accounts_body(chequing, savings))
        .serve("/accounts/acc_chq/transactions", transactions_body(transaction()))
        .serve("/accounts/acc_sav/transactions", json_response('{"success": false, "message": "No"}', status))
    )

    result = await fetch(akahu_adapter(api.transport), "acc_chq", "acc_sav")

    assert result.accounts == ()
    assert result.request_error is not None
    assert result.request_error.kind is kind
    assert USER_ACCESS_TOKEN not in result.request_error.reason


async def test_fetch_sends_at_most_four_requests_at_once():
    """Akahu publishes no rate limit, so a user with many accounts doesn't send every account's read together"""
    wire_accounts = [account(f"acc_{number}", name=f"Account {number}") for number in range(12)]
    api = AkahuApi().serve("/accounts", accounts_body(*wire_accounts))
    for number in range(12):
        api.serve(f"/accounts/acc_{number}/transactions", transactions_body(transaction(f"trans_{number}", account_id=f"acc_{number}")))

    result = await fetch(akahu_adapter(api.transport), *(f"acc_{number}" for number in range(12)))

    assert len(result.accounts) == 12
    assert api.most_in_flight == 4


@pytest.mark.parametrize(
    ("start", "end"),
    [
        (WINDOW_START, WINDOW_START),
        (WINDOW_END, WINDOW_START),
        (WINDOW_START, WINDOW_START + timedelta(days=91)),
        (datetime(2026, 10, 1), WINDOW_END),
    ],
    ids=["empty", "backwards", "too-long", "naive"],
)
async def test_fetch_refuses_a_window_that_is_empty_too_long_or_not_timezone_aware(start, end):
    """The window is the engine's to get right, so a wrong one is a bug found loudly with nothing sent"""
    api = _api_with_one_account()

    with pytest.raises(ValueError, match="Akahu window"):
        await fetch(akahu_adapter(api.transport), "acc_chq", start=start, end=end)

    assert api.requests == []
