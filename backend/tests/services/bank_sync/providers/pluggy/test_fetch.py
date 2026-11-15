"""Pluggy fetch tests

Guards what a sync stores from Pluggy: the window it asks for, with a day of margin that the records
then trim, every page of a cursor followed to its end, dates in the user's timezone except where
Pluggy gives a bare date, a credit card's signs, amounts read exactly from JSON numbers and kept raw
when they can't be stored, and the failures that stop every account against the ones that stop only one
"""

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
import pytest

from app.models.bank_sync_job import ProviderErrorKind
from app.services.bank_sync.providers.pluggy import adapter as pluggy_module
from tests.services.bank_sync.providers.pluggy.stand_ins import (
    API_KEY,
    CLIENT_SECRET,
    ITEM_ID,
    TORONTO,
    WINDOW_END,
    WINDOW_START,
    PluggyApi,
    account,
    accounts_body,
    fetch,
    item,
    json_response,
    next_page,
    pluggy_adapter,
    transaction,
    transactions_body,
)

_SAO_PAULO = ZoneInfo("America/Sao_Paulo")


def _api_with_one_account(*transactions: str, kind: str = "BANK", balance: str = "100.00", currency: str = "BRL") -> PluggyApi:
    """Return Pluggy holding one account with the given transactions on one page"""
    return (
        PluggyApi()
        .serve_sign_in()
        .serve_item(item(), account(kind=kind, balance=balance, currency=currency))
        .serve_transactions("acc-chk", transactions_body(*transactions))
    )


def _transaction_requests(api: PluggyApi) -> list[httpx.Request]:
    """Return the requests for transactions"""
    return [request for request in api.requests if request.url.path == "/v2/transactions"]


async def test_fetch_asks_for_the_window_with_a_day_of_margin_each_side_and_signs_in_once():
    """Pluggy reads dates in a timezone of its own, so a day either side is asked for and the records trim it"""
    api = _api_with_one_account()

    await fetch(pluggy_adapter(api.transport), "acc-chk")

    [request] = _transaction_requests(api)
    assert dict(request.url.params) == {"accountId": "acc-chk", "dateFrom": "2026-09-30", "dateTo": "2026-10-05"}
    assert request.headers["x-api-key"] == API_KEY
    assert api.paths().count("/auth") == 1


async def test_fetch_keeps_a_record_only_inside_the_window_whether_it_has_a_time_or_not():
    """A bare date counts from the start of its day where the user is, an instant is itself, and the window holds its start and not its end"""
    api = _api_with_one_account(
        transaction("before-date", date="2026-09-30T00:00:00.000Z"),
        transaction("start-date", date="2026-10-01T00:00:00.000Z"),
        transaction("last-date", date="2026-10-03T00:00:00.000Z"),
        transaction("end-date", date="2026-10-04T00:00:00.000Z"),
        transaction("before-instant", date="2026-10-01T03:59:59.000Z"),
        transaction("start-instant", date="2026-10-01T04:00:00.000Z"),
        transaction("last-instant", date="2026-10-04T03:59:59.000Z"),
        transaction("end-instant", date="2026-10-04T04:00:00.000Z"),
    )

    result = await fetch(pluggy_adapter(api.transport), "acc-chk")

    assert [(record.external_id, record.date) for record in result.accounts[0].records] == [
        ("start-date", date(2026, 10, 1)),
        ("last-date", date(2026, 10, 3)),
        ("start-instant", date(2026, 10, 1)),
        ("last-instant", date(2026, 10, 3)),
    ]


async def test_fetch_windows_that_meet_leave_no_record_taken_twice_or_missed():
    """The second window starts where the first ends, and a record at that instant is in the second only"""
    boundary = datetime(2026, 10, 4, tzinfo=TORONTO)
    api = _api_with_one_account(
        transaction("day-before", date="2026-10-03T17:00:00.000Z"),
        transaction("on-it", date="2026-10-04T00:00:00.000Z"),
        transaction("instant-on-it", date="2026-10-04T04:00:00.000Z"),
    )
    adapter = pluggy_adapter(api.transport)

    first = await fetch(adapter, "acc-chk", end=boundary)
    second = await fetch(adapter, "acc-chk", start=boundary, end=boundary + timedelta(days=3))

    assert [record.external_id for record in first.accounts[0].records] == ["day-before"]
    assert [record.external_id for record in second.accounts[0].records] == ["on-it", "instant-on-it"]


async def test_fetch_follows_the_cursor_to_the_last_page_for_the_same_account():
    """Every page of an account is read, each asked for with the query the page before gave"""

    def page(request: httpx.Request) -> httpx.Response:
        """Answer each page by the cursor it was asked for"""
        after = request.url.params.get("after")
        if after is None:
            return json_response(transactions_body(transaction("tx-1", "-1.00"), next_query=next_page("acc-chk", "p2")))
        if after == "p2":
            return json_response(transactions_body(transaction("tx-2", "-2.00"), next_query=next_page("acc-chk", "p3")))
        return json_response(transactions_body(transaction("tx-3", "-3.00")))

    api = PluggyApi().serve_sign_in().serve_item(item(), account()).serve_transactions("acc-chk", page)

    result = await fetch(pluggy_adapter(api.transport), "acc-chk")

    [checking] = result.accounts
    assert [record.external_id for record in checking.records] == ["tx-1", "tx-2", "tx-3"]
    assert result.possibly_cut_off is False
    assert [request.url.params.get("after") for request in _transaction_requests(api)] == [None, "p2", "p3"]


async def test_fetch_that_meets_a_cursor_without_end_stops_and_says_it_was_cut_off(monkeypatch):
    """A cursor that never ends can't keep a sync going for ever, and what was read isn't taken as complete"""
    monkeypatch.setattr(pluggy_module, "MAX_PAGES_PER_ACCOUNT", 3)
    count = iter(range(100))
    api = (
        PluggyApi()
        .serve_sign_in()
        .serve_item(item(), account())
        .serve_transactions(
            "acc-chk", lambda _request: json_response(transactions_body(transaction(), next_query=next_page("acc-chk", f"p{next(count)}")))
        )
    )

    result = await fetch(pluggy_adapter(api.transport), "acc-chk")

    assert len(_transaction_requests(api)) == 3
    assert result.possibly_cut_off is True
    assert [warning.kind for warning in result.warnings] == [ProviderErrorKind.UNKNOWN]


@pytest.mark.parametrize(
    ("cursor", "pages_read"),
    [
        (next_page("acc-chk", "same"), 2),
        (next_page("acc-other", "p2"), 1),
        ("https://elsewhere.example/v2/transactions?accountId=acc-chk&after=p2", 1),
        ("?accountId=acc-chk", 1),
    ],
    ids=["repeated", "other-account", "other-host", "no-position"],
)
async def test_fetch_refuses_a_cursor_that_loops_or_leads_elsewhere(cursor, pages_read):
    """A cursor repeating itself, naming another account or host, or saying nowhere to go on is unreadable, never followed"""
    api = (
        PluggyApi()
        .serve_sign_in()
        .serve_item(item(), account())
        .serve_transactions("acc-chk", lambda _request: json_response(transactions_body(transaction(), next_query=cursor)))
    )

    result = await fetch(pluggy_adapter(api.transport), "acc-chk")

    assert result.accounts == ()
    assert result.account_errors["acc-chk"].kind is ProviderErrorKind.UNKNOWN
    assert {request.headers["host"] for request in api.requests} == {"api.pluggy.ai"}
    assert len(_transaction_requests(api)) == pages_read


@pytest.mark.parametrize(
    ("timezone", "stamps", "days"),
    [
        # A timestamp at midnight UTC is a bare date, so 2 October stays 2 October in every timezone
        (
            _SAO_PAULO,
            ["2026-10-02T00:00:00.000Z", "2026-10-02T02:59:59.000Z", "2026-10-02T03:00:00.000Z"],
            [date(2026, 10, 2), date(2026, 10, 1), date(2026, 10, 2)],
        ),
        (
            TORONTO,
            ["2026-10-02T00:00:00.000Z", "2026-10-02T03:59:59.000Z", "2026-10-02T04:00:00.000Z"],
            [date(2026, 10, 2), date(2026, 10, 1), date(2026, 10, 2)],
        ),
    ],
    ids=["sao-paulo", "toronto"],
)
async def test_fetch_dates_an_instant_in_the_users_timezone_and_a_bare_date_as_itself(timezone, stamps, days):
    """Midnight UTC is the day Pluggy named, and any other timestamp lands on the user's own day"""
    start, end = datetime(2026, 9, 30, tzinfo=timezone), datetime(2026, 10, 4, tzinfo=timezone)
    api = _api_with_one_account(*(transaction(f"tx-{number}", date=stamp) for number, stamp in enumerate(stamps)))

    result = await fetch(pluggy_adapter(api.transport), "acc-chk", start=start, end=end, timezone=timezone)

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
        balance="1234567.89",
    )

    result = await fetch(pluggy_adapter(api.transport), "acc-chk")

    [checking] = result.accounts
    assert checking.balance == 123456789
    assert [(record.external_id, record.amount, record.raw_amount, record.description) for record in checking.records] == [
        ("t1", 1007, "10.07", "Refund"),
        ("t2", -29, "-0.29", "Fee"),
        ("t3", -123456789, "-1234567.89", "Deposit"),
        ("t4", 25000, "250", "Whole number"),
        ("t5", 900719925474099301, "9007199254740993.01", "Large"),
    ]
    assert not any(record.pending for record in checking.records)


async def test_fetch_notes_a_transaction_by_the_banks_description_and_names_the_merchant_people_know():
    """Pluggy's description is the text the bank sent, so it is also the note, and the merchant is the name Pluggy matched

    That name is the one people know, not the registered company. A description of only blanks is no
    note, and a transaction Pluggy matched to no merchant has none
    """
    api = _api_with_one_account(
        transaction("t1", description="PAGO NETFLIX SERV", merchant="Netflix"),
        transaction("t2", description="  ", merchant=None),
    )

    result = await fetch(pluggy_adapter(api.transport), "acc-chk")

    assert [(record.note, record.merchant) for record in result.accounts[0].records] == [("PAGO NETFLIX SERV", "Netflix"), (None, None)]


async def test_fetch_keeps_only_the_raw_amount_when_it_cannot_be_stored_exactly():
    """More decimals than the currency holds, or a currency Lumina Finance has no exponent for, is never rounded into a figure"""
    precise = _api_with_one_account(transaction("t1", "-1.005"), transaction("t2", "-3"))
    unknown = _api_with_one_account(transaction("t3", "-12.50", currency="XYZ"), currency="XYZ")

    precise_result = await fetch(pluggy_adapter(precise.transport), "acc-chk")
    unknown_result = await fetch(pluggy_adapter(unknown.transport), "acc-chk")

    assert [(record.amount, record.raw_amount) for record in precise_result.accounts[0].records] == [(None, "-1.005"), (-300, "-3")]
    assert [(record.amount, record.raw_amount) for record in unknown_result.accounts[0].records] == [(None, "-12.50")]
    assert unknown_result.accounts[0].currency == "XYZ"


async def test_fetch_reads_a_credit_cards_charges_and_balance_as_money_owed():
    """Pluggy sends a card's charges and balance positive, so they are negated to read as debt, and zero stays unsigned"""
    api = (
        PluggyApi()
        .serve_sign_in()
        .serve_item(item(), account("acc-chk", balance="100.00"), account("acc-card", kind="CREDIT", balance="640.10"))
        .serve_transactions("acc-chk", transactions_body(transaction("c1", "-4.50")))
        .serve_transactions(
            "acc-card",
            transactions_body(
                transaction("k1", "129.95", description="LOJA ONLINE"),
                transaction("k2", "-500.00", description="PAGAMENTO RECEBIDO"),
                transaction("k3", "0.00", description="AJUSTE"),
                transaction("k4", "1.005", description="PRECISO"),
            ),
        )
    )

    result = await fetch(pluggy_adapter(api.transport), "acc-chk", "acc-card")

    checking, card = result.accounts
    assert (checking.balance, [record.amount for record in checking.records]) == (10000, [-450])
    assert card.balance == -64010
    assert [(record.amount, record.raw_amount) for record in card.records] == [
        (-12995, "-129.95"),
        (50000, "500.00"),
        (0, "0.00"),
        (None, "-1.005"),
    ]


async def test_fetch_takes_a_foreign_purchase_in_the_accounts_own_currency():
    """A dollar charge on a real card counts as the reais Pluggy says it cost, and the dollar figure alone is kept raw when it says nothing"""
    api = (
        PluggyApi()
        .serve_sign_in()
        .serve_item(item(), account("acc-card", kind="CREDIT", balance="1000.00"))
        .serve_transactions(
            "acc-card",
            transactions_body(
                transaction("f1", "20.00", currency="USD", in_account_currency="104.37"),
                transaction("f2", "35.00", currency="USD"),
                transaction("f3", "8.00", currency="BRL"),
            ),
        )
    )

    result = await fetch(pluggy_adapter(api.transport), "acc-card")

    [card] = result.accounts
    assert [(record.external_id, record.amount, record.raw_amount) for record in card.records] == [
        ("f1", -10437, "-104.37"),
        ("f2", None, "-35.00"),
        ("f3", -800, "-8.00"),
    ]


async def test_fetch_of_an_item_waiting_on_its_user_reads_nothing_and_asks_for_the_reconnect():
    """A login error returns the account unread, with no transaction request, and the login says why"""
    api = (
        PluggyApi()
        .serve_sign_in()
        .serve_item(item(status="LOGIN_ERROR", execution_status="ACCOUNT_NEEDS_ACTION"), account("acc-chk"))
        .serve_transactions("acc-chk", transactions_body(transaction()))
    )

    result = await fetch(pluggy_adapter(api.transport), "acc-chk")

    assert [(found.external_id, found.balance, found.records) for found in result.accounts] == [("acc-chk", None, ())]
    assert set(result.login_errors) == {ITEM_ID}
    assert result.login_errors[ITEM_ID].kind is ProviderErrorKind.BANK_LOGIN_NEEDED
    assert _transaction_requests(api) == []


async def test_fetch_of_an_item_that_is_behind_reports_an_outage_for_its_accounts():
    """OUTDATED with no action for the user is temporary, and its transactions aren't read as if current"""
    api = (
        PluggyApi()
        .serve_sign_in()
        .serve_item(item(status="OUTDATED", execution_status="CONNECTION_ERROR"), account("acc-chk"))
        .serve_transactions("acc-chk", transactions_body(transaction()))
    )

    result = await fetch(pluggy_adapter(api.transport), "acc-chk")

    assert result.account_errors["acc-chk"].kind is ProviderErrorKind.TEMPORARY
    assert result.login_errors == {}
    assert _transaction_requests(api) == []


async def test_fetch_sends_only_what_reading_needs_and_never_asks_pluggy_to_refresh():
    """Pluggy refreshes items itself, so the only request that isn't a GET is the sign-in"""
    api = _api_with_one_account(transaction())

    await fetch(pluggy_adapter(api.transport), "acc-chk", include_pending=True)

    assert {(request.method, request.url.path) for request in api.requests if request.method != "GET"} == {("POST", "/auth")}
    assert not any("refresh" in path for path in api.paths())


async def test_fetch_with_one_account_failing_reports_that_account_and_returns_the_rest():
    """A failed account is an error of its own, never a silent drop that would read as the account vanishing"""
    api = (
        PluggyApi()
        .serve_sign_in()
        .serve_item(item(), account("acc-chk"), account("acc-sav", name="Poupança"))
        .serve_transactions("acc-chk", transactions_body(transaction()))
        .serve_transactions("acc-sav", '{"message": "Bank unavailable"}', 500)
    )

    result = await fetch(pluggy_adapter(api.transport), "acc-chk", "acc-sav")

    assert result.request_error is None
    assert [found.external_id for found in result.accounts] == ["acc-chk"]
    assert set(result.account_errors) == {"acc-sav"}
    assert result.account_errors["acc-sav"].kind is ProviderErrorKind.TEMPORARY


async def test_fetch_asking_for_an_account_pluggy_no_longer_lists_reports_it_missing():
    """An account that is gone from the listing has an error saying so"""
    api = _api_with_one_account()

    result = await fetch(pluggy_adapter(api.transport), "acc-chk", "acc-gone")

    assert [found.external_id for found in result.accounts] == ["acc-chk"]
    assert result.account_errors["acc-gone"].reason == "Pluggy didn't return this account"
    assert result.account_errors["acc-gone"].kind is ProviderErrorKind.UNKNOWN


async def test_fetch_asking_for_the_accounts_of_an_item_that_failed_reports_that_failure():
    """An item Pluggy couldn't give right now is an outage for its accounts, not a sign that they are gone"""
    api = (
        PluggyApi()
        .serve_sign_in()
        .serve_item(item(), account("acc-chk"))
        .serve_transactions("acc-chk", transactions_body(transaction()))
        .serve("/items/" + "7a2d9e41-3c68-4f05-b1e7-6c8d0a5f2b93", "{}", 503)
    )
    credential = '{"client_id": "c", "client_secret": "s", "item_ids": ["' + ITEM_ID + '", "7a2d9e41-3c68-4f05-b1e7-6c8d0a5f2b93"]}'

    result = await pluggy_adapter(api.transport).fetch(
        credential,
        account_ids=["acc-chk", "acc-other"],
        start=WINDOW_START,
        end=WINDOW_END,
        include_pending=False,
        timezone=TORONTO,
        currency_exponents={"BRL": 2},
    )

    assert [found.external_id for found in result.accounts] == ["acc-chk"]
    assert result.account_errors["acc-other"].kind is ProviderErrorKind.TEMPORARY


async def test_fetch_of_an_account_whose_page_cannot_be_read_reports_it_as_unknown():
    """An unreadable page isn't an outage, so it doesn't retry without end"""
    api = (
        PluggyApi()
        .serve_sign_in()
        .serve_item(item(), account("acc-chk"))
        .serve_transactions("acc-chk", '{"results": "nonsense", "next": null}')
    )

    result = await fetch(pluggy_adapter(api.transport), "acc-chk")

    assert result.account_errors["acc-chk"].kind is ProviderErrorKind.UNKNOWN


@pytest.mark.parametrize(
    ("status", "kind"),
    [(401, ProviderErrorKind.CREDENTIAL_REJECTED), (403, ProviderErrorKind.CREDENTIAL_REJECTED), (429, ProviderErrorKind.RATE_LIMITED)],
)
async def test_fetch_meeting_a_rejection_or_a_spent_quota_on_a_page_fails_the_whole_request(status, kind):
    """A rejected key or a rate limit on any account stops every account, since the next request would meet the same answer"""
    api = (
        PluggyApi()
        .serve_sign_in()
        .serve_item(item(), account("acc-chk"), account("acc-sav", name="Poupança"))
        .serve_transactions("acc-chk", transactions_body(transaction()))
        .serve_transactions("acc-sav", json_response('{"message": "No"}', status))
    )

    result = await fetch(pluggy_adapter(api.transport), "acc-chk", "acc-sav")

    assert result.accounts == ()
    assert result.request_error is not None
    assert result.request_error.kind is kind
    assert CLIENT_SECRET not in result.request_error.reason
    assert API_KEY not in result.request_error.reason


async def test_fetch_sends_at_most_four_requests_at_once():
    """Pluggy limits each endpoint a minute, so a user with many accounts doesn't send every account's read together"""
    wire_accounts = [account(f"acc-{number}", name=f"Account {number}") for number in range(12)]
    api = PluggyApi().serve_sign_in().serve_item(item(), *wire_accounts)
    for number in range(12):
        api.serve_transactions(f"acc-{number}", transactions_body(transaction(f"tx-{number}")))

    result = await fetch(pluggy_adapter(api.transport), *(f"acc-{number}" for number in range(12)))

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

    with pytest.raises(ValueError, match="Pluggy window"):
        await fetch(pluggy_adapter(api.transport), "acc-chk", start=start, end=end)

    assert api.requests == []


_SECOND_ITEM_ID = "7a2d9e41-3c68-4f05-b1e7-6c8d0a5f2b93"
_MISSING = "Pluggy didn't return this account"


async def _fetch_two_items(api: PluggyApi, *account_ids: str):
    """Fetch accounts through a credential holding the first item and a second one"""
    credential = f'{{"client_id": "c", "client_secret": "s", "item_ids": ["{ITEM_ID}", "{_SECOND_ITEM_ID}"]}}'
    return await pluggy_adapter(api.transport).fetch(
        credential,
        account_ids=account_ids,
        start=WINDOW_START,
        end=WINDOW_END,
        include_pending=False,
        timezone=TORONTO,
        currency_exponents={"BRL": 2},
    )


def _healthy_first_item() -> PluggyApi:
    """Return Pluggy with a first item holding one account that reads, and nothing for the second"""
    return PluggyApi().serve_sign_in().serve_item(item(), account("acc-chk")).serve_transactions("acc-chk", transactions_body(transaction()))


async def test_fetch_of_an_account_of_a_missing_item_is_missing_when_no_item_is_having_an_outage():
    """An item that is gone says nothing of an outage, so its account is told as one that isn't returned, with a warning for the item"""
    api = _healthy_first_item().serve(f"/items/{_SECOND_ITEM_ID}", '{"message": "Item not found"}', 404)

    result = await _fetch_two_items(api, "acc-chk", "acc-b")

    assert [found.external_id for found in result.accounts] == ["acc-chk"]
    assert (result.account_errors["acc-b"].kind, result.account_errors["acc-b"].reason) == (ProviderErrorKind.UNKNOWN, _MISSING)
    assert [warning.reason for warning in result.warnings] == ["Pluggy didn't return one of this connection's items"]


async def test_fetch_of_an_account_gone_from_a_healthy_item_beside_a_missing_one_is_missing():
    """An account that vanished from an item that answered is gone, whatever happened to the other item"""
    api = _healthy_first_item().serve(f"/items/{_SECOND_ITEM_ID}", '{"message": "Item not found"}', 404)

    result = await _fetch_two_items(api, "acc-chk", "acc-vanished")

    assert result.account_errors["acc-vanished"].reason == _MISSING


async def test_fetch_of_an_unlisted_account_beside_an_item_having_an_outage_blames_no_single_item():
    """With one item down, an unlisted account may be on it or gone, so it gets a temporary error that names neither, not the failing item's"""
    api = _healthy_first_item().serve(f"/items/{_SECOND_ITEM_ID}", '{"message": "Down"}', 503)

    result = await _fetch_two_items(api, "acc-chk", "acc-b")

    error = result.account_errors["acc-b"]
    assert error.kind is ProviderErrorKind.TEMPORARY
    assert error.reason == "Pluggy couldn't give every item right now"
    assert [warning.reason for warning in result.warnings] == ["Lumina Finance couldn't reach Pluggy"]


async def test_fetch_negates_a_card_charge_of_thirty_digits_without_rounding_it():
    """Negating a Decimal with a minus sign rounds it to 28 digits, so a 30-digit charge on a card must go through exactly"""
    big = "123456789012345678901234567.89"
    api = (
        PluggyApi()
        .serve_sign_in()
        .serve_item(item(), account("acc-card", kind="CREDIT"))
        .serve_transactions("acc-card", transactions_body(transaction("big", big)))
    )

    result = await fetch(pluggy_adapter(api.transport), "acc-card")

    [record] = result.accounts[0].records
    # Too large for the column, so no amount is stored, but the figure kept is the exact negated one
    assert (record.amount, record.raw_amount) == (None, f"-{big}")


async def test_fetch_of_an_account_with_a_400_on_its_items_account_list_says_the_list_was_refused():
    """A list Pluggy refuses for an item it just returned is told for what it is, not as an unreadable answer"""
    api = PluggyApi().serve_sign_in().serve("/items/" + ITEM_ID, item()).serve_accounts(ITEM_ID, '{"message": "Bad request"}', 400)

    result = await fetch(pluggy_adapter(api.transport), "acc-chk")

    assert result.request_error is not None
    assert result.request_error.reason == "Pluggy didn't return the accounts of one of this connection's items"


@pytest.mark.parametrize(
    "cursor_dates",
    ["", "&dateFrom=1999-01-01&dateTo=1999-01-02"],
    ids=["no-dates", "other-dates"],
)
async def test_fetch_asks_every_page_for_its_own_account_and_window_whatever_the_cursor_holds(cursor_dates):
    """Pluggy's published cursor holds only the account and the position, so the window a page is read over is always the adapter's own"""

    def page(request: httpx.Request) -> httpx.Response:
        """Answer the first page with a cursor and the second with the end"""
        if request.url.params.get("after") is None:
            return json_response(transactions_body(transaction("tx-1"), next_query=f"?accountId=acc-chk{cursor_dates}&after=cDI9"))
        return json_response(transactions_body(transaction("tx-2")))

    api = PluggyApi().serve_sign_in().serve_item(item(), account()).serve_transactions("acc-chk", page)

    result = await fetch(pluggy_adapter(api.transport), "acc-chk")

    window = {"accountId": "acc-chk", "dateFrom": "2026-09-30", "dateTo": "2026-10-05"}
    assert [dict(request.url.params) for request in _transaction_requests(api)] == [window, window | {"after": "cDI9"}]
    assert [record.external_id for record in result.accounts[0].records] == ["tx-1", "tx-2"]


async def test_fetch_warns_of_an_accounts_list_with_more_pages_without_calling_the_transactions_cut_off():
    """The engine halves a cut-off window for ever, so a longer accounts list warns and leaves the flag to the transaction pages"""
    api = PluggyApi().serve_sign_in().serve("/items/" + ITEM_ID, item())
    api.serve_accounts(ITEM_ID, accounts_body(account(), total_pages=3))
    api.serve_transactions("acc-chk", transactions_body())

    result = await fetch(pluggy_adapter(api.transport), "acc-chk")

    assert [dict(request.url.params) for request in api.requests if request.url.path == "/accounts"] == [{"itemId": ITEM_ID}]
    assert result.possibly_cut_off is False
    assert [(warning.kind, warning.reason) for warning in result.warnings] == [
        (ProviderErrorKind.UNKNOWN, "Pluggy has more accounts under an item than Lumina Finance reads at once")
    ]


async def test_fetch_meeting_a_rejected_key_on_an_item_fails_the_request_as_rejected_and_not_as_a_missing_item():
    """A 403 on an item is the API key refused, so the keys are reported and no account is told it vanished"""
    api = PluggyApi().serve_sign_in().serve(f"/items/{ITEM_ID}", '{"code": 403, "codeDescription": "API_KEY_MISSING_OR_INVALID"}', 403)

    result = await fetch(pluggy_adapter(api.transport), "acc-chk")

    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.CREDENTIAL_REJECTED
    assert result.account_errors == {}
