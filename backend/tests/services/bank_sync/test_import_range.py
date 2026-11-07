"""Where a bank import may start

A start too early imports bank activity the ledger already holds, and one too late leaves days nothing
covers, so the range has to follow the ledger floor and the provider's limit exactly, in the user's
own calendar
"""

from datetime import date

import pytest

from app.models.bank_connection import BankLinkState
from app.models.currency import Currency
from app.services.bank_sync.import_range import ImportRange, calculate_import_range, get_import_range
from tests.routes.support.bank_sync_helpers import (
    _build_account,
    _build_bank_connection,
    _build_bank_link,
    _build_category,
    _build_ledger_transaction,
    _build_user,
)
from tests.services.bank_sync.fake_provider import FAKE_PROVIDER

_HISTORY_MONTHS = 12


def _range(today: date, latest_ledger_date: date | None, *, was_linked_before: bool = False) -> ImportRange:
    """Work out the range for a provider reaching back 12 months"""
    return calculate_import_range(
        today=today,
        latest_ledger_date=latest_ledger_date,
        history_months=_HISTORY_MONTHS,
        was_linked_before=was_linked_before,
    )


def test_import_range_of_an_empty_account_reaches_back_to_the_providers_limit():
    """On 23 September: 1 September 2025 through today, no floor, and a first link suggests 1 June"""
    assert _range(date(2026, 9, 23), None) == ImportRange(
        suggested_start=date(2026, 6, 1),
        default_suggestion=date(2026, 6, 1),
        earliest_allowed=date(2025, 9, 1),
        latest_allowed=date(2026, 9, 23),
        ledger_floor=None,
        provider_limit_date=date(2025, 9, 1),
        provider_history_months=12,
        latest_ledger_date=None,
    )


def test_import_range_floor_after_the_limit_raises_a_first_links_suggestion():
    """A ledger running to 14 August starts the range on 15 August, which the 1 June suggestion is raised to"""
    imported = _range(date(2026, 9, 23), date(2026, 8, 14))

    assert (imported.ledger_floor, imported.earliest_allowed) == (date(2026, 8, 15), date(2026, 8, 15))
    assert (imported.default_suggestion, imported.suggested_start) == (date(2026, 6, 1), date(2026, 8, 15))


def test_import_range_floor_before_the_limit_leaves_the_limit_as_the_earliest_start():
    """A ledger ending 10 March 2024 floors at 11 March 2024, but nothing may start before 1 September 2025"""
    imported = _range(date(2026, 9, 23), date(2024, 3, 10))

    assert (imported.ledger_floor, imported.earliest_allowed) == (date(2024, 3, 11), date(2025, 9, 1))


def test_import_range_with_a_transaction_dated_today_allows_only_tomorrow():
    """A transaction on 23 September leaves 24 September as the only start"""
    imported = _range(date(2026, 9, 23), date(2026, 9, 23))

    assert (imported.earliest_allowed, imported.latest_allowed) == (date(2026, 9, 24), date(2026, 9, 24))
    assert [imported.allows(day) for day in (date(2026, 9, 23), date(2026, 9, 24), date(2026, 9, 25))] == [False, True, False]


def test_import_range_counts_months_across_a_month_end_and_a_year_end():
    """On 31 January the limit is 1 January last year and a first link suggests 1 October

    A ledger ending on New Year's Eve floors on New Year's Day
    """
    empty = _range(date(2026, 1, 31), None)
    imported = _range(date(2026, 1, 31), date(2025, 12, 31))

    assert (empty.provider_limit_date, empty.suggested_start) == (date(2025, 1, 1), date(2025, 10, 1))
    assert imported.ledger_floor == date(2026, 1, 1)


def test_import_range_on_the_first_of_the_month_counts_from_that_month():
    """In Auckland it is already 1 October, so the limit is 1 October 2025 and a first link suggests 1 July"""
    imported = _range(date(2026, 10, 1), None)

    assert (imported.provider_limit_date, imported.suggested_start) == (date(2025, 10, 1), date(2026, 7, 1))


@pytest.mark.parametrize(
    ("latest_ledger_date", "suggested"),
    [(date(2026, 8, 14), date(2026, 8, 15)), (None, date(2026, 6, 1))],
    ids=["after-the-ledger", "empty-account"],
)
def test_import_range_after_an_earlier_link_suggests_picking_up_after_the_ledger(latest_ledger_date, suggested):
    """A relink suggests the day after the latest transaction, or three months back when the ledger is empty"""
    imported = _range(date(2026, 9, 23), latest_ledger_date, was_linked_before=True)

    assert (imported.default_suggestion, imported.suggested_start) == (suggested, suggested)


@pytest.mark.parametrize(
    ("previous_link", "default_suggestion"),
    [(None, date(2026, 7, 1)), (BankLinkState.UNLINKED, date(2026, 10, 4)), (BankLinkState.CHOOSE_ACCOUNT, date(2026, 10, 4))],
    ids=["first-link", "relink-after-unlinking", "choosing-the-bank-account-again"],
)
async def test_import_range_reads_the_ledger_on_the_users_own_day(db, frozen_now, previous_link, default_suggestion):
    """At 8 pm on 3 October in Los Angeles, a transaction dated 3 October is in the ledger and one dated 4 October is still future-dated

    So the floor is 4 October, the only start allowed, and only an account linked before suggests it
    """
    db.add(Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2))
    user = _build_user("range@example.com")
    user.tz = "America/Los_Angeles"
    db.add(user)
    await db.flush()
    account = _build_account(user.id)
    category = _build_category(user.id)
    connection = _build_bank_connection(user.id)
    db.add_all([account, category, connection])
    await db.flush()
    for day in (date(2026, 10, 3), date(2026, 10, 4)):
        transaction = _build_ledger_transaction(account, category.id)
        transaction.dt = day
        db.add(transaction)
    if previous_link is BankLinkState.UNLINKED:
        db.add(_build_bank_link(account, None, state=previous_link, unlinked_at=frozen_now))
    elif previous_link is not None:
        db.add(_build_bank_link(account, connection, state=previous_link))
    await db.flush()

    imported = await get_import_range(db, user, account.id, FAKE_PROVIDER)

    assert (imported.latest_ledger_date, imported.ledger_floor, imported.earliest_allowed, imported.latest_allowed) == (
        date(2026, 10, 3),
        date(2026, 10, 4),
        date(2026, 10, 4),
        date(2026, 10, 4),
    )
    assert (imported.default_suggestion, imported.suggested_start) == (default_suggestion, date(2026, 10, 4))
