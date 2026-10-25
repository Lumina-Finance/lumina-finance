"""SimpleFIN account set reading tests

Guards how SimpleFIN Bridge responses become records bound for the ledger: a wrong date moves a
transaction across the import boundary, and a rounded amount silently changes the user's money.
The sample response is written by hand from the protocol, plus the Bridge's undocumented payee and
memo, and its conventions are assumed until checked against real Bridge data
"""

import json
from datetime import UTC, date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from app.services.bank_sync.providers.contract import ExternalAccount, ProviderRecord
from app.services.bank_sync.providers.simplefin.account_set import (
    RecordDating,
    is_possibly_cut_off,
    read_account_set,
    read_external_accounts,
)

_FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "simplefin"
_EXPONENTS = {"USD": 2, "JPY": 0, "BHD": 3}

# The day the sample response stands as requested on, after every stamp in it, so a record dated
# by the request can't pass for one dated by its stamp
_REQUESTED_ON = date(2026, 10, 6)


def _accounts(timezone: str = "America/Los_Angeles") -> dict[str, ExternalAccount]:
    """Read the sample accounts response for a user in the timezone, by account id"""
    account_set = read_account_set((_FIXTURES / "accounts.json").read_bytes())
    dating = RecordDating(timezone=ZoneInfo(timezone), requested_on=_REQUESTED_ON)
    accounts = read_external_accounts(account_set, currency_exponents=_EXPONENTS, dating=dating)
    return {account.external_id: account for account in accounts}


def _records(timezone: str = "America/Los_Angeles") -> dict[str, ProviderRecord]:
    """Read every record in the sample accounts response, by transaction id"""
    return {record.external_id: record for account in _accounts(timezone).values() for record in account.records}


def test_pending_flag_or_unposted_stamp_marks_a_record_pending():
    """A record is pending when SimpleFIN flags it or hasn't given it a posted time"""
    records = _records()

    assert {record_id for record_id, record in records.items() if record.pending} == {
        "TRN-grocer",
        "TRN-parking",
        "TRN-streaming",
    }


@pytest.mark.parametrize(
    ("record_id", "timezone", "expected"),
    [
        ("TRN-coffee", "Pacific/Auckland", date(2026, 10, 4)),
        ("TRN-fx-fee", "America/Los_Angeles", date(2026, 10, 3)),
        ("TRN-coffee", "America/Los_Angeles", date(2026, 10, 4)),
    ],
    ids=["noon-utc-keeps-its-utc-date", "other-time-in-the-profile-timezone", "booked-uses-posted-not-transacted-at"],
)
def test_booked_record_is_dated_by_the_stamp_rule(record_id, timezone, expected):
    """Noon UTC stands for the bank's date, and any other time is dated where the user lives

    1791115200 is noon UTC on 4 October, already 5 October in Auckland. 1791083700 is 03:15 UTC on
    4 October, still 3 October in Los Angeles. TRN-coffee was posted at the first and transacted
    at the second, and a booked record takes its posted date
    """
    assert _records(timezone)[record_id].date == expected


@pytest.mark.parametrize(
    ("posted", "timezone", "expected"),
    [
        (1791072000, "America/Toronto", date(2026, 10, 4)),
        (1791072001, "America/Toronto", date(2026, 10, 3)),
    ],
    ids=["midnight-utc-toronto", "one-second-past-midnight-utc"],
)
def test_booked_record_stamped_at_midnight_utc_keeps_its_utc_date(posted, timezone, expected):
    """Midnight UTC on 4 October, how a bank that sends only a date may stamp it, is 4 October for a user in Toronto

    Toronto is still 3 October at that instant, so dating it there would put the transaction a day
    early, across a statement boundary. One second later is a real time and is dated where the user lives
    """
    transaction = {"id": "TRN-1", "posted": posted, "amount": "-4.50", "description": "COFFEE"}
    account = {"id": "ACT-1", "name": "Chequing", "conn_id": "CON-1", "currency": "USD", "balance": "1.00", "balance-date": posted}
    body = {
        "connections": [{"conn_id": "CON-1", "name": "Harbour", "org_id": "ORG-1"}],
        "accounts": [account | {"transactions": [transaction]}],
    }
    dating = RecordDating(timezone=ZoneInfo(timezone), requested_on=_REQUESTED_ON)

    accounts = read_external_accounts(read_account_set(json.dumps(body).encode()), currency_exponents=_EXPONENTS, dating=dating)

    assert accounts[0].records[0].date == expected


@pytest.mark.parametrize(
    ("record_id", "expected"),
    [("TRN-grocer", date(2026, 10, 3)), ("TRN-parking", _REQUESTED_ON), ("TRN-streaming", _REQUESTED_ON)],
    ids=["transacted-at", "unposted-without-transacted-at", "flagged-without-transacted-at"],
)
def test_pending_record_is_dated_by_when_it_happened_or_else_the_request_day(record_id, expected):
    """A pending record takes its transaction time under the same rule, or the day it was fetched"""
    assert _records()[record_id].date == expected


@pytest.mark.parametrize(
    ("record_id", "raw_amount", "amount"),
    [("TRN-konbini", "-1500", -1500), ("TRN-refund", "12.340", 12340)],
    ids=["jpy", "bhd"],
)
def test_amount_becomes_minor_units_at_its_currency_precision(record_id, raw_amount, amount):
    """Each currency's own exponent applies, and signs are kept"""
    record = _records()[record_id]

    assert record.amount == amount
    assert record.raw_amount == raw_amount


def test_amount_with_more_decimals_than_its_currency_keeps_only_its_text():
    """-12.345 in USD is kept as sent with no amount, never rounded to -12.35"""
    record = _records()["TRN-fx-fee"]

    assert record.amount is None
    assert record.raw_amount == "-12.345"


def test_a_record_keeps_the_banks_description_whatever_payee_and_memo_the_bridge_adds():
    """The Bridge's undocumented payee, memo and extra fields change nothing about the record"""
    record = _records()["TRN-coffee"]

    assert record.description == "POS 4411 BLUE BOTTLE SF"
    assert record.removed is False


@pytest.mark.parametrize(("first", "second", "cut_off"), [(500, 499, False), (500, 500, True)], ids=["999-in-all", "1000-in-all"])
def test_response_may_be_cut_off_by_its_transactions_in_all_not_in_one_account(first, second, cut_off):
    """SimpleFIN's cap is on the response, so 500 transactions in each of two accounts reach it though neither account does"""
    transaction = {"id": "TRN-1", "posted": 1791115200, "amount": "-1.00", "description": "COFFEE"}
    account = {"name": "Chequing", "conn_id": "CON-1", "currency": "USD", "balance": "1.00", "balance-date": 1791115200}
    accounts = [account | {"id": f"ACT-{count}", "transactions": [transaction] * count} for count in (first, second)]
    body = {"connections": [{"conn_id": "CON-1", "name": "Harbour", "org_id": "ORG-1"}], "accounts": accounts}

    assert is_possibly_cut_off(read_account_set(json.dumps(body).encode())) is cut_off


def test_institution_is_the_bank_logins_institution():
    """Two logins at one bank share one institution while keeping their own login keys"""
    accounts = _accounts()
    chequing, savings = accounts["ACT-chequing"], accounts["ACT-savings"]

    assert (chequing.institution_key, chequing.institution_name) == ("ORG-harbour", "Harbour Bank")
    assert (savings.institution_key, savings.institution_name) == ("ORG-harbour", "Harbour Bank")
    assert (chequing.login_key, savings.login_key) == ("CON-harbour-jim", "CON-harbour-ann")


def test_balances_are_read_with_their_time_and_an_unstorable_one_is_unavailable():
    """Balances read at the currency's precision, while one with too many decimals reads as unavailable

    An available balance sent with too many decimals is flagged, so it reads apart from one never sent
    """
    accounts = _accounts()
    chequing, savings, visa, dinar = accounts["ACT-chequing"], accounts["ACT-savings"], accounts["ACT-visa"], accounts["ACT-dinar"]

    assert (chequing.balance, chequing.available_balance, chequing.available_balance_unreadable) == (251075, 241075, False)
    assert chequing.balance_at == datetime(2026, 10, 4, 12, tzinfo=UTC)
    assert (savings.available_balance, savings.available_balance_unreadable) == (None, False)
    assert visa.balance is None
    assert (dinar.balance, dinar.available_balance, dinar.available_balance_unreadable) == (1200500, None, True)


@pytest.mark.parametrize(
    ("account_id", "currency_raw"),
    [("ACT-points", "https://harbourbank.example/currencies/points"), ("ACT-unnamed-currency", "")],
    ids=["url", "empty"],
)
def test_custom_currency_marks_the_account_and_keeps_its_figures_as_sent(account_id, currency_raw):
    """A URL or nothing in place of an ISO code is a custom currency, whose amounts have no precision to read"""
    account = _accounts()[account_id]

    assert account.currency is None
    assert account.currency_raw == currency_raw
    assert account.balance is None
    assert all(record.amount is None for record in account.records)
