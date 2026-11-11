"""Which days a bank import may cover

The range runs from the provider's limit through today in the user's own calendar. The ledger floor
is only a fact beside it, so an import may reach into days the ledger already covers
"""

from datetime import date

from app.models.currency import Currency
from app.services.bank_sync.import_range import ImportRange, calculate_import_range, get_import_range
from tests.routes.support.bank_sync_helpers import (
    _build_account,
    _build_category,
    _build_ledger_transaction,
    _build_user,
)
from tests.services.bank_sync.fake_provider import FAKE_PROVIDER

_HISTORY_MONTHS = 12


def _range(today: date, latest_ledger_date: date | None) -> ImportRange:
    """Work out the range for a provider reaching back 12 months"""
    return calculate_import_range(today=today, latest_ledger_date=latest_ledger_date, history_months=_HISTORY_MONTHS)


def test_import_range_of_an_empty_account_reaches_back_to_the_providers_limit():
    """On 23 September: 1 September 2025 through today, and no floor"""
    assert _range(date(2026, 9, 23), None) == ImportRange(
        earliest_allowed=date(2025, 9, 1),
        latest_allowed=date(2026, 9, 23),
        ledger_floor=None,
        provider_limit_date=date(2025, 9, 1),
        provider_history_months=12,
    )


def test_import_range_floor_after_the_limit_leaves_the_limit_as_the_earliest_start():
    """A ledger running to 14 August floors at 15 August, yet the range still starts at the limit, 1 September 2025"""
    imported = _range(date(2026, 9, 23), date(2026, 8, 14))

    assert (imported.ledger_floor, imported.earliest_allowed) == (date(2026, 8, 15), date(2025, 9, 1))


def test_import_range_floor_before_the_limit_leaves_the_limit_as_the_earliest_start():
    """A ledger ending 10 March 2024 floors at 11 March 2024, but nothing may start before 1 September 2025"""
    imported = _range(date(2026, 9, 23), date(2024, 3, 10))

    assert (imported.ledger_floor, imported.earliest_allowed) == (date(2024, 3, 11), date(2025, 9, 1))


def test_import_range_with_a_transaction_dated_today_still_allows_every_day_through_today():
    """A transaction on 23 September floors at 24 September, after today, and the range still runs from the limit to 23 September"""
    imported = _range(date(2026, 9, 23), date(2026, 9, 23))

    assert (imported.ledger_floor, imported.earliest_allowed, imported.latest_allowed) == (
        date(2026, 9, 24),
        date(2025, 9, 1),
        date(2026, 9, 23),
    )
    assert [imported.allows(day) for day in (date(2025, 8, 31), date(2025, 9, 1), date(2026, 9, 23), date(2026, 9, 24))] == [
        False,
        True,
        True,
        False,
    ]


def test_import_range_counts_months_across_a_month_end_and_a_year_end():
    """On 31 January the limit is 1 January last year

    A ledger ending on New Year's Eve floors on New Year's Day
    """
    empty = _range(date(2026, 1, 31), None)
    imported = _range(date(2026, 1, 31), date(2025, 12, 31))

    assert empty.provider_limit_date == date(2025, 1, 1)
    assert imported.ledger_floor == date(2026, 1, 1)


def test_import_range_on_the_first_of_the_month_counts_from_that_month():
    """In Auckland it is already 1 October, so the limit is 1 October 2025"""
    imported = _range(date(2026, 10, 1), None)

    assert imported.provider_limit_date == date(2025, 10, 1)


async def test_import_range_reads_the_ledger_on_the_users_own_day(db, frozen_now):
    """At 8 pm on 3 October in Los Angeles, a transaction dated 3 October is in the ledger and one dated 4 October is still future-dated

    So the floor is 4 October, and the range runs from 1 October 2025 to 3 October
    """
    db.add(Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2))
    user = _build_user("range@example.com")
    user.tz = "America/Los_Angeles"
    db.add(user)
    await db.flush()
    account = _build_account(user.id)
    category = _build_category(user.id)
    db.add_all([account, category])
    await db.flush()
    for day in (date(2026, 10, 3), date(2026, 10, 4)):
        transaction = _build_ledger_transaction(account, category.id)
        transaction.dt = day
        db.add(transaction)
    await db.flush()

    imported = await get_import_range(db, user, account.id, FAKE_PROVIDER)

    assert (imported.ledger_floor, imported.earliest_allowed, imported.latest_allowed) == (
        date(2026, 10, 4),
        date(2025, 10, 1),
        date(2026, 10, 3),
    )
