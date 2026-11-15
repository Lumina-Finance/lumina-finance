"""Enable Banking discovery and fetch tests

Guards what a sync stores: amounts exactly as the bank sent them with debits negative, booked balances
apart from available ones, only booked and (when asked) pending records, a stable ID for every record
including those the bank gave none, the window the user asked for, pages followed to their end, and
each failure sorted into the account, the bank sign-in or the whole request it belongs to
"""

import json
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from typing import cast
from zoneinfo import ZoneInfo

import httpx
import pytest

from app.models.bank_connection import BankAccountLink
from app.services.bank_sync.balance_comparison import read_balance_day
from app.services.bank_sync.providers.contract import ProviderErrorKind
from app.services.bank_sync.providers.enable_banking import adapter as adapter_module
from app.services.bank_sync.windows import LinkNeed, plan_window
from app.utils.dates import get_shifted_month_start_date
from tests.services.bank_sync.providers.enable_banking.stand_ins import (
    CARD,
    CHECKING,
    CREDENTIAL,
    EXPONENTS,
    HOLDER,
    TORONTO,
    WINDOW_END,
    WINDOW_START,
    EnableBankingApi,
    balance,
    balances_body,
    enable_banking_adapter,
    error_response,
    fetch,
    json_response,
    stored_credential,
    transaction,
    transactions_body,
)
from tests.services.bank_sync.stand_ins import fail_with

_BALANCES = balances_body(balance("CLBD", "1500.50"), balance("ITAV", "1400.25"))

# Two days after the stand-in window, so how far back a read reaches never changes with the real date
_READ_AT = datetime(2026, 10, 5, 12, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def _reads_on_5_october(monkeypatch):
    """Make every read happen at _READ_AT"""
    monkeypatch.setattr(adapter_module, "_read_time", lambda: _READ_AT)


def _api(checking: str = "", *, balances: str = _BALANCES) -> EnableBankingApi:
    """Return Enable Banking holding the checking account and the card of the stored session"""
    return (
        EnableBankingApi()
        .serve_account("uid-checking", balances=balances, transactions=checking or transactions_body())
        .serve_account("uid-card", balances=balances_body(balance("CLBD", "-320.10")), transactions=transactions_body())
    )


async def test_discover_lists_both_accounts_with_their_booked_and_available_balances_exactly():
    """The booked balance is the balance, the available one is kept apart, and nothing is rounded"""
    api = _api(balances=balances_body(balance("ITAV", "1400.25"), balance("CLBD", "1500.50"), balance("OTHR", "9")))

    result = await enable_banking_adapter(api.transport).discover(CREDENTIAL, currency_exponents=EXPONENTS)

    assert result.request_error is None
    checking, card = result.accounts
    assert (checking.external_id, checking.name, checking.balance, checking.available_balance) == (CHECKING, "Everyday", 150050, 140025)
    assert (card.external_id, card.balance, card.available_balance) == (CARD, -32010, None)
    assert (checking.institution_key, checking.institution_name, checking.login_key) == ("FI:Aurora Bank", "Aurora Bank", None)
    assert (checking.currency, checking.records) == ("EUR", ())


@pytest.mark.parametrize(
    ("details", "product", "expected"),
    [("Everyday", "Current account", "Everyday"), ("  ", "Current account", "Current account"), (None, None, "Account")],
    ids=["description", "product", "neither"],
)
async def test_discover_names_an_account_by_its_description_then_its_product_never_its_holder(details, product, expected):
    """Enable Banking's `name` is the account holder's, so an account is named by the description it was given, else its product"""
    credential = json.loads(CREDENTIAL)
    credential["accounts"][0] |= {"name": HOLDER, "details": details, "product": product}

    result = await enable_banking_adapter(_api().transport).discover(json.dumps(credential), currency_exponents=EXPONENTS)

    assert result.accounts[0].name == expected


async def test_discover_keeps_a_balance_with_more_decimals_than_the_currency_holds_as_unreadable():
    """A figure that can't be stored exactly is not rounded, and an available one is told apart from none sent"""
    api = _api(balances=balances_body(balance("CLBD", "10.005"), balance("ITAV", "1.234")))

    result = await enable_banking_adapter(api.transport).discover(CREDENTIAL, currency_exponents=EXPONENTS)

    checking = result.accounts[0]
    assert (checking.balance, checking.available_balance, checking.available_balance_unreadable) == (None, None, True)


async def test_fetch_signs_debits_negative_and_credits_positive_and_keeps_every_decimal():
    """Enable Banking sends unsigned amounts with an indicator, and a figure past the currency's decimals is kept as sent"""
    api = _api(
        transactions_body(
            transaction("4.50", indicator="DBIT", entry_reference="debit"),
            transaction("2500.00", indicator="CRDT", entry_reference="credit"),
            transaction("0.123", indicator="DBIT", entry_reference="odd"),
        )
    )

    result = await fetch(enable_banking_adapter(api.transport), CHECKING)

    records = {record.external_id: record for record in result.accounts[0].records}
    assert (records["debit"].amount, records["debit"].raw_amount) == (-450, "-4.50")
    assert (records["credit"].amount, records["credit"].raw_amount) == (250000, "2500.00")
    assert (records["odd"].amount, records["odd"].raw_amount) == (None, "-0.123")


async def test_fetch_notes_a_record_by_its_payment_message_then_the_banks_note_and_names_the_other_party_its_merchant():
    """The other party's name stands in as the description when the payment has no message, and is the merchant, but never the note

    The other party is the one paid on a debit and the one paying on a credit
    """
    api = _api(
        transactions_body(
            transaction(entry_reference="message", remittance="Gift for Alex", note="Birthday"),
            transaction(entry_reference="bank-note", remittance=" ", note="Birthday"),
            transaction(entry_reference="neither", remittance=""),
            transaction(entry_reference="salary", indicator="CRDT", remittance="SALARY OCTOBER", debtor="Brightworks GmbH"),
        )
    )

    result = await fetch(enable_banking_adapter(api.transport), CHECKING)

    assert [(record.external_id, record.description, record.note, record.merchant) for record in result.accounts[0].records] == [
        ("message", "Gift for Alex", "Gift for Alex", "Padaria Sol"),
        ("bank-note", "Padaria Sol", "Birthday", "Padaria Sol"),
        ("neither", "Padaria Sol", None, "Padaria Sol"),
        ("salary", "SALARY OCTOBER", "SALARY OCTOBER", "Brightworks GmbH"),
    ]


async def test_fetch_keeps_booked_records_and_pending_ones_only_when_asked():
    """Cancelled, rejected and scheduled records never count, and a hold shows as pending"""
    page = transactions_body(
        transaction(entry_reference="booked", status="BOOK"),
        transaction(entry_reference="pending", status="PDNG"),
        transaction(entry_reference="held", status="HOLD"),
        transaction(entry_reference="cancelled", status="CNCL"),
        transaction(entry_reference="scheduled", status="SCHD"),
    )

    without = await fetch(enable_banking_adapter(_api(page).transport), CHECKING)
    with_pending = await fetch(enable_banking_adapter(_api(page).transport), CHECKING, include_pending=True)

    assert [(record.external_id, record.pending) for record in without.accounts[0].records] == [("booked", False)]
    assert [(record.external_id, record.pending) for record in with_pending.accounts[0].records] == [
        ("booked", False),
        ("pending", True),
        ("held", True),
    ]


async def test_fetch_dates_a_record_by_booking_then_value_then_transaction_date_and_keeps_only_the_window():
    """The first date the bank gave is the record's, and a day outside the three asked for is left out"""
    page = transactions_body(
        transaction(entry_reference="booking", booking_date="2026-10-01", value_date="2026-10-02"),
        transaction(entry_reference="value", booking_date=None, value_date="2026-10-02"),
        transaction(entry_reference="transaction", booking_date=None, transaction_date="2026-10-03"),
        transaction(entry_reference="before", booking_date="2026-09-30"),
        transaction(entry_reference="after", booking_date="2026-10-04"),
        transaction(entry_reference="undated", booking_date=None),
    )

    result = await fetch(enable_banking_adapter(_api(page).transport), CHECKING)

    assert [(record.external_id, record.date) for record in result.accounts[0].records] == [
        ("booking", date(2026, 10, 1)),
        ("value", date(2026, 10, 2)),
        ("transaction", date(2026, 10, 3)),
    ]


async def test_fetch_dates_a_pending_record_the_bank_gave_no_date_on_the_users_today():
    """A hold often has no date yet, so it counts for the user's today, while a booked record with no date is left out"""
    page = transactions_body(
        transaction(entry_reference="held", status="PDNG", booking_date=None),
        transaction(entry_reference="undated", status="BOOK", booking_date=None),
    )

    result = await fetch(enable_banking_adapter(_api(page).transport), CHECKING, end=_READ_AT, include_pending=True)

    assert [(record.external_id, record.date, record.pending) for record in result.accounts[0].records] == [("held", date(2026, 10, 5), True)]


def _without_remittance(amount: str, indicator: str, *, creditor: str | None, debtor: str | None, note: str | None) -> str:
    """Return a transaction with no remittance text, naming the parties and the note given"""
    item = json.loads(transaction(amount, indicator=indicator, entry_reference=f"{indicator}-{amount}", remittance=""))
    item |= {
        "remittance_information": [],
        "creditor": None if creditor is None else {"name": creditor},
        "debtor": None if debtor is None else {"name": debtor},
        "note": note,
    }
    return json.dumps(item)


async def test_fetch_describes_a_record_without_remittance_text_by_the_other_party_then_its_note():
    """A debit is described by who was paid and a credit by who paid, never by the user's own side, and the note comes last"""
    page = transactions_body(
        _without_remittance("1.00", "DBIT", creditor="Padaria Sol", debtor="Me", note="lunch"),
        _without_remittance("2.00", "CRDT", creditor="Me", debtor="Employer", note="pay"),
        _without_remittance("3.00", "DBIT", creditor="  ", debtor="Me", note="  card fee "),
    )

    result = await fetch(enable_banking_adapter(_api(page).transport), CHECKING)

    assert [record.description for record in result.accounts[0].records] == ["Padaria Sol", "Employer", "card fee"]


async def test_fetch_tells_apart_identical_records_without_a_reference_on_different_pages():
    """Two identical transactions the bank gave no reference keep different IDs when each comes on its own page"""
    pages = {
        None: transactions_body(transaction("3.00", entry_reference=None), continuation_key="next"),
        "next": transactions_body(transaction("3.00", entry_reference=None)),
    }
    api = _api().serve(
        "GET",
        "/accounts/uid-checking/transactions",
        lambda request: json_response(pages[request.url.params.get("continuation_key")]),
    )

    result = await fetch(enable_banking_adapter(api.transport), CHECKING)

    assert len({record.external_id for record in result.accounts[0].records}) == 2


async def test_fetch_identifies_a_record_by_its_reference_then_its_fields_never_its_transaction_id():
    """Enable Banking may change a transaction_id on every read, so a record keeps one ID across reads, and identical ones are told apart"""

    def page(read: int) -> str:
        """Return the same transactions under the transaction IDs one read gives them"""
        return transactions_body(
            transaction(entry_reference="ref-9", transaction_id=f"tx-9-{read}"),
            transaction("3.00", entry_reference=None, transaction_id=f"tx-a-{read}"),
            transaction("3.00", entry_reference=None, transaction_id=f"tx-b-{read}"),
            transaction("3.00", entry_reference=None, transaction_id=None, status="PDNG"),
        )

    first = await fetch(enable_banking_adapter(_api(page(1)).transport), CHECKING, include_pending=True)
    again = await fetch(enable_banking_adapter(_api(page(2)).transport), CHECKING, include_pending=True)

    ids = [record.external_id for record in first.accounts[0].records]
    assert ids[0] == "ref-9"
    assert len(set(ids)) == 4
    assert ids == [record.external_id for record in again.accounts[0].records]


async def test_fetch_follows_the_continuation_key_and_asks_for_a_day_more_on_each_side():
    """Every page is read, each asked for with the key the last gave, in the window widened for time zones"""
    pages = {
        None: transactions_body(transaction(entry_reference="one"), continuation_key="next-1"),
        "next-1": transactions_body(transaction(entry_reference="two")),
    }
    api = _api().serve(
        "GET",
        "/accounts/uid-checking/transactions",
        lambda request: json_response(pages[request.url.params.get("continuation_key")]),
    )

    result = await fetch(enable_banking_adapter(api.transport), CHECKING)

    assert [record.external_id for record in result.accounts[0].records] == ["one", "two"]
    sent = [request for request in api.requests if request.url.path.endswith("/uid-checking/transactions")]
    assert [request.url.params.get("continuation_key") for request in sent] == [None, "next-1"]
    assert (sent[0].url.params["date_from"], sent[0].url.params["date_to"]) == ("2026-09-30", "2026-10-05")


async def test_fetch_stops_at_a_continuation_key_the_bank_repeats():
    """A key that never ends would loop for ever, so the account fails as unreadable"""
    page = transactions_body(transaction(entry_reference="one"), continuation_key="same")

    result = await fetch(enable_banking_adapter(_api(page).transport), CHECKING)

    assert result.accounts == ()
    assert result.account_errors[CHECKING].kind is ProviderErrorKind.UNKNOWN


async def test_fetch_reports_an_account_the_session_does_not_share():
    """An account asked for that the session doesn't list has an error of its own"""
    result = await fetch(enable_banking_adapter(_api().transport), CHECKING, "hash-gone")

    assert [account.external_id for account in result.accounts] == [CHECKING]
    assert result.account_errors["hash-gone"].kind is ProviderErrorKind.UNKNOWN


@pytest.mark.parametrize("code", ["EXPIRED_SESSION", "REVOKED_SESSION", "CLOSED_SESSION", "SESSION_DOES_NOT_EXIST"])
async def test_a_session_that_is_over_rejects_the_credential_for_the_whole_request(code):
    """The user must sign in at the bank again, which a reconnect does, and no account is read after the first refusal"""
    api = _api().serve("GET", "/accounts/uid-checking/balances", error_response(code, 401))

    result = await fetch(enable_banking_adapter(api.transport), CHECKING, CARD)

    assert result.accounts == ()
    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.CREDENTIAL_REJECTED


async def test_a_signature_the_application_does_not_accept_rejects_the_credential():
    """A 401 without a session error is the key's fault too"""
    api = _api().serve("GET", "/accounts/uid-checking/balances", json_response("{}", 401))

    result = await fetch(enable_banking_adapter(api.transport), CHECKING)

    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.CREDENTIAL_REJECTED


async def test_a_bank_that_limits_reads_fails_only_that_account():
    """PSD2 lets a bank refuse the fifth unattended read of a day, and the other account still syncs"""
    api = _api().serve("GET", "/accounts/uid-checking/balances", error_response("ASPSP_RATE_LIMIT_EXCEEDED", 429))

    result = await fetch(enable_banking_adapter(api.transport), CHECKING, CARD)

    assert [account.external_id for account in result.accounts] == [CARD]
    assert result.account_errors[CHECKING].kind is ProviderErrorKind.RATE_LIMITED
    assert result.request_error is None


async def test_a_bank_that_needs_the_user_to_sign_in_again_rejects_the_credential_so_a_reconnect_sends_them_back_to_the_bank():
    """Signing in again is a new bank sign-in here, which only a reconnect starts, so the connection is flagged for one"""
    api = _api().serve("GET", "/accounts/uid-checking/transactions", error_response("ASPSP_PSU_ACTION_REQUIRED", 400))

    result = await fetch(enable_banking_adapter(api.transport), CHECKING, CARD)

    assert result.accounts == ()
    assert result.login_errors == {}
    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.CREDENTIAL_REJECTED
    assert "reconnect" in result.request_error.reason.lower()


@pytest.mark.parametrize("status", [401, 403])
async def test_an_html_page_from_the_edge_is_temporary_and_blames_no_key(status):
    """The edge in front of Enable Banking answers its own failures with a page, which says nothing about the key"""
    page = httpx.Response(status, content=b"<html><body>Blocked</body></html>", headers={"Content-Type": "text/html"})
    api = _api().serve("GET", "/accounts/uid-checking/balances", page)

    result = await fetch(enable_banking_adapter(api.transport), CHECKING)

    assert result.request_error is None
    assert result.account_errors[CHECKING].kind is ProviderErrorKind.TEMPORARY


async def test_a_plain_too_many_requests_answer_ends_the_request_as_rate_limited():
    """Enable Banking itself asking for fewer requests holds back every account, unlike a bank limiting one"""
    api = _api().serve("GET", "/accounts/uid-checking/balances", json_response("{}", 429))

    result = await fetch(enable_banking_adapter(api.transport), CHECKING, CARD)

    assert result.accounts == ()
    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.RATE_LIMITED


async def test_a_transaction_in_another_currency_than_its_account_keeps_the_amount_as_sent_without_a_figure():
    """Reading it at the account's decimals could store a wrong amount, so only the text the bank sent is kept"""
    api = _api(transactions_body(transaction("12.00", currency="USD", entry_reference="foreign"), transaction("3.00", entry_reference="same")))

    result = await fetch(enable_banking_adapter(api.transport), CHECKING)

    records = {record.external_id: record for record in result.accounts[0].records}
    assert (records["foreign"].amount, records["foreign"].raw_amount) == (None, "-12.00")
    assert (records["same"].amount, records["same"].raw_amount) == (-300, "-3.00")


async def test_a_debit_the_bank_sends_with_a_minus_sign_is_still_a_debit():
    """The indicator says the direction, so a sign on the amount can't turn money out into money in"""
    api = _api(transactions_body(transaction("-4.50", indicator="DBIT", entry_reference="signed")))

    result = await fetch(enable_banking_adapter(api.transport), CHECKING)

    [record] = result.accounts[0].records
    assert (record.amount, record.raw_amount) == (-450, "-4.50")


async def test_fetch_never_asks_for_a_day_that_has_not_begun():
    """A window that ends now is asked for up to today, since a bank may refuse an end date in the future"""
    api = _api()

    await fetch(enable_banking_adapter(api.transport), CHECKING, start=_READ_AT - timedelta(days=2), end=_READ_AT, timezone=ZoneInfo("UTC"))

    sent = next(request for request in api.requests if request.url.path.endswith("/uid-checking/transactions"))
    assert sent.url.params["date_to"] == "2026-10-05"


async def test_fetch_asks_up_to_the_banks_day_not_the_users_when_the_user_is_ahead_of_it(monkeypatch):
    """The bank's day is the UTC one, so a user already in tomorrow doesn't make the request ask for a day that hasn't begun"""
    now = datetime(2026, 11, 12, 20, 0, tzinfo=UTC)
    monkeypatch.setattr(adapter_module, "_read_time", lambda: now)
    api = _api()

    await fetch(
        enable_banking_adapter(api.transport),
        CHECKING,
        start=now - timedelta(days=2),
        end=now,
        timezone=ZoneInfo("Pacific/Kiritimati"),
    )

    sent = next(request for request in api.requests if request.url.path.endswith("/uid-checking/transactions"))
    assert sent.url.params["date_to"] == "2026-11-12"


@pytest.mark.parametrize("kind", ["CLBD", "ITBD"])
async def test_a_balance_known_only_by_its_day_stays_on_that_day_for_a_user_west_of_utc(kind):
    """A closing or interim balance for 12 November reads as 12 November in Toronto, not as the evening of the 11th"""
    api = _api(balances=balances_body(balance(kind, "1400.00", changed=None, reference_date="2026-11-12")))

    result = await enable_banking_adapter(api.transport).discover(CREDENTIAL, currency_exponents=EXPONENTS)

    assert read_balance_day(result.accounts[0].balance_at, tz="America/Toronto") == date(2026, 11, 12)
    assert read_balance_day(result.accounts[0].balance_at, tz="Europe/Helsinki") == date(2026, 11, 12)


async def test_a_booked_balance_without_a_date_is_not_dated_by_the_available_one():
    """The available balance may have changed since, so an undated booked balance is dated by when it was read"""
    api = _api(balances=balances_body(balance("CLBD", "1400.00", changed=None), balance("ITAV", "1300.00", changed="2026-11-01T10:00:00Z")))
    result = await enable_banking_adapter(api.transport).discover(CREDENTIAL, currency_exponents=EXPONENTS)

    assert result.accounts[0].balance_at == _READ_AT


async def test_fetch_refuses_a_window_longer_than_the_adapter_reads_at_once():
    """The engine splits a long import into windows of at most max_window_days, so a longer one is a caller's bug"""
    adapter = enable_banking_adapter(_api().transport)
    start = WINDOW_START.astimezone(UTC)
    end = start + timedelta(days=adapter.max_window_days)

    await fetch(adapter, CHECKING, start=start, end=end)
    with pytest.raises(ValueError, match="at most"):
        await fetch(adapter, CHECKING, start=start, end=end + timedelta(seconds=1))


@pytest.mark.parametrize(
    ("start", "cap"),
    [(WINDOW_START, adapter_module.MAX_PAGES_PER_ACCOUNT), (_READ_AT - timedelta(days=200), adapter_module.MAX_PAGES_PER_HISTORY_READ)],
    ids=["recent_window", "history_read"],
)
async def test_fetch_stops_after_the_page_cap_and_says_the_read_may_be_cut_off(start, cap):
    """A bank that keeps giving new keys can't hold an account's read for ever, and the engine is told not to trust it as complete"""
    api = _api().serve(
        "GET",
        "/accounts/uid-checking/transactions",
        lambda request: json_response(
            transactions_body(
                transaction(entry_reference=f"ref-{request.url.params.get('continuation_key')}"),
                continuation_key=f"key-{request.url.params.get('continuation_key')}",
            )
        ),
    )

    result = await fetch(enable_banking_adapter(api.transport), CHECKING, start=start)

    assert result.possibly_cut_off is True
    assert len(result.accounts[0].records) == cap
    assert any(warning.kind is ProviderErrorKind.UNKNOWN for warning in result.warnings)


async def test_fetch_reads_a_window_reaching_past_90_days_with_the_longest_strategy_and_keeps_only_its_days():
    """A window older than many banks share is read with the strategy that returns what they still share instead of refusing

    The longest strategy ignores date_to and reads up to today, so the records after the window are dropped, and each page
    repeats the first page's parameters
    """
    pages = {
        None: transactions_body(
            transaction(entry_reference="inside", booking_date="2026-06-01"),
            transaction(entry_reference="after", booking_date="2026-10-04"),
            continuation_key="next",
        ),
        "next": transactions_body(),
    }
    api = _api().serve(
        "GET",
        "/accounts/uid-checking/transactions",
        lambda request: json_response(pages[request.url.params.get("continuation_key")]),
    )

    result = await fetch(enable_banking_adapter(api.transport), CHECKING, start=datetime(2026, 1, 1, tzinfo=TORONTO), end=WINDOW_START)

    sent = [dict(request.url.params) for request in api.requests if request.url.path.endswith("/uid-checking/transactions")]
    assert sent == [
        {"date_from": "2025-12-31", "strategy": "longest"},
        {"date_from": "2025-12-31", "strategy": "longest", "continuation_key": "next"},
    ]
    assert [record.external_id for record in result.accounts[0].records] == ["inside"]


@pytest.mark.parametrize(
    ("days_back", "expected"),
    [
        (88, {"date_from": "2026-07-08", "date_to": "2026-10-05"}),
        (89, {"date_from": "2026-07-07", "strategy": "longest"}),
    ],
    ids=["request within 90 days", "request reaching 90 days"],
)
async def test_fetch_asks_for_exact_dates_until_its_request_reaches_90_days_back(days_back, expected):
    """Every bank shares its last 90 days, so a routine window asks for its own dates with the default strategy

    The request starts a day before the window, so a window starting 89 days back already asks from
    90 days back and is read with the longest strategy, which a bank sharing only 90 days still answers
    """
    api = _api()

    await fetch(enable_banking_adapter(api.transport), CHECKING, start=_READ_AT - timedelta(days=days_back), end=_READ_AT)

    sent = next(request for request in api.requests if request.url.path.endswith("/uid-checking/transactions"))
    assert dict(sent.url.params) == expected


def test_a_first_import_reaching_back_the_whole_history_limit_is_one_window():
    """A bank often shares full history only for about an hour after sign-in, so the engine reads it in one request"""
    today = date(2026, 12, 31)
    link = cast(BankAccountLink, SimpleNamespace(id=1))
    first_day = get_shifted_month_start_date(today, -adapter_module.EnableBankingAdapter.history_limit_months)

    window = plan_window(
        [LinkNeed(link, first_day)], today=today, timezone=TORONTO, max_days=adapter_module.EnableBankingAdapter.max_window_days
    )

    assert (window.first_day, window.last_day) == (date(2024, 12, 1), today)


async def test_the_booked_balance_is_the_interim_one_before_the_closing_one_and_is_dated_by_its_own_day():
    """An interim booked balance is today's, and a closing one for yesterday keeps yesterday's date instead of being stamped as read now"""
    interim = await enable_banking_adapter(
        _api(balances=balances_body(balance("CLBD", "1400.00"), balance("ITBD", "1500.00"))).transport
    ).discover(CREDENTIAL, currency_exponents=EXPONENTS)
    assert interim.accounts[0].balance == 150000

    closing = await enable_banking_adapter(
        _api(
            balances=balances_body(
                balance("CLBD", "1400.00", changed=None, reference_date="2026-10-02"),
                balance("ITAV", "1300.00", changed="2026-11-01T10:00:00Z"),
            )
        ).transport
    ).discover(CREDENTIAL, currency_exponents=EXPONENTS)
    assert closing.accounts[0].balance == 140000
    assert closing.accounts[0].balance_at.date() == date(2026, 10, 2)

    changed = await enable_banking_adapter(
        _api(
            balances=balances_body(
                balance("CLBD", "1400.00", changed="2026-10-02T21:00:00Z"),
                balance("ITAV", "1300.00", changed="2026-11-01T10:00:00Z"),
            )
        ).transport
    ).discover(CREDENTIAL, currency_exponents=EXPONENTS)
    assert changed.accounts[0].balance_at == datetime(2026, 10, 2, 21, 0, tzinfo=UTC)


@pytest.mark.parametrize(
    "answer",
    [error_response("ASPSP_TIMEOUT", 504), error_response("ASPSP_ERROR", 500), httpx.ConnectError, httpx.ReadTimeout],
    ids=["bank_timeout", "bank_error", "connection_failed", "timed_out"],
)
async def test_an_outage_is_temporary_for_the_account(answer):
    """The bank or Enable Banking being down is retried later and blames nobody"""
    responder = fail_with(answer) if isinstance(answer, type) else answer
    api = _api().serve("GET", "/accounts/uid-checking/transactions", responder)

    result = await fetch(enable_banking_adapter(api.transport), CHECKING)

    assert result.account_errors[CHECKING].kind is ProviderErrorKind.TEMPORARY


@pytest.mark.parametrize(
    ("start", "end"),
    [(WINDOW_END, WINDOW_START), (WINDOW_START.replace(tzinfo=None), WINDOW_END)],
    ids=["empty", "naive"],
)
async def test_fetch_refuses_a_window_that_is_empty_or_has_no_timezone(start, end):
    """The engine never sends one, so a caller that does has a bug"""
    with pytest.raises(ValueError, match="window"):
        await fetch(enable_banking_adapter(_api().transport), CHECKING, start=start, end=end)


async def test_a_user_with_many_accounts_does_not_send_every_read_together():
    """Reads overlap, but never past the few the adapter allows at once"""
    uids = [f"uid-{index}" for index in range(10)]
    api = EnableBankingApi()
    for uid in uids:
        api.serve_account(uid, balances=_BALANCES, transactions=transactions_body())
    credential = stored_credential(*((uid, f"hash-{uid}", uid, "EUR") for uid in uids))

    result = await fetch(enable_banking_adapter(api.transport), *(f"hash-{uid}" for uid in uids), credential=credential)

    assert len(result.accounts) == 10
    assert 1 < api.most_in_flight <= 4
