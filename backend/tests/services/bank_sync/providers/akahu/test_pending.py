"""Akahu pending transaction tests

Guards how pending transactions reach the sync when Akahu sends them with no id: each gets an id worked
out from what it shows so identical ones stay apart, the id holds across reads of the same set, and
nothing is asked for unless the sync wants pending records
"""

from datetime import date

from app.models.bank_sync_job import ProviderErrorKind
from tests.services.bank_sync.providers.akahu.stand_ins import (
    APP_ID_TOKEN,
    USER_ACCESS_TOKEN,
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


def _api(*pending_items: str) -> AkahuApi:
    """Return Akahu holding a chequing account with one booked transaction and the pending ones"""
    return (
        AkahuApi()
        .serve("/accounts", accounts_body(account("acc_chq"), account("acc_sav", name="Online Savings")))
        .serve("/accounts/acc_chq/transactions", transactions_body(transaction()))
        .serve("/accounts/acc_sav/transactions", transactions_body())
        .serve("/transactions/pending", pending_body(*pending_items))
    )


async def test_fetch_gives_each_pending_transaction_an_id_and_marks_it_pending():
    """Pending records follow the booked ones, dated in the user's timezone, amounts read exactly, from one request for every account"""
    api = _api(pending("-12.00"), pending("-3.10", date="2026-10-04T02:00:00.000Z", description="CARD PURCHASE BAKERY"))

    result = await fetch(akahu_adapter(api.transport), "acc_chq", "acc_sav", include_pending=True)

    chequing, savings = result.accounts
    assert [(record.pending, record.amount, record.date, record.description) for record in chequing.records] == [
        (False, -450, date(2026, 10, 1), "EFTPOS BEAN THERE CAFE"),
        (True, -1200, date(2026, 10, 3), "CARD PURCHASE FRESHWAY"),
        (True, -310, date(2026, 10, 3), "CARD PURCHASE BAKERY"),
    ]
    assert savings.records == ()
    assert api.paths().count("/v1/transactions/pending") == 1


async def test_pending_ids_keep_identical_transactions_apart_and_hold_across_reads():
    """Two identical coffees get two ids in order, a different amount another, and asking again gives the same ids"""
    items = (pending("-4.50"), pending("-4.50"), pending("-4.51"), pending("-4.50"))
    first = await fetch(akahu_adapter(_api(*items).transport), "acc_chq", include_pending=True)
    again = await fetch(akahu_adapter(_api(*items).transport), "acc_chq", include_pending=True)

    ids = [record.external_id for record in first.accounts[0].records if record.pending]
    assert len(ids) == 4
    assert len(set(ids)) == 4
    assert ids == [record.external_id for record in again.accounts[0].records if record.pending]


async def test_pending_id_changes_with_the_account_the_date_the_amount_and_the_description():
    """Each part of a transaction's identity matters, so a change to any of them is a different pending item"""
    base = pending()
    variants = [
        pending(account_id="acc_sav"),
        pending(date="2026-10-03T12:00:00.000Z"),
        pending("-12.01"),
        pending(description="CARD PURCHASE FRESHWAY 2"),
    ]
    api = _api(base, *variants)

    result = await fetch(akahu_adapter(api.transport), "acc_chq", "acc_sav", include_pending=True)

    ids = [record.external_id for found in result.accounts for record in found.records if record.pending]
    assert len(ids) == 5
    assert len(set(ids)) == 5


async def test_fetch_asks_for_pending_only_when_the_sync_does_and_drops_other_accounts():
    """No pending request without include_pending, and a pending item of an account that wasn't chosen is left out"""
    quiet = _api(pending())
    asked = _api(pending(), pending(account_id="acc_elsewhere"))

    without = await fetch(akahu_adapter(quiet.transport), "acc_chq")
    with_pending = await fetch(akahu_adapter(asked.transport), "acc_chq", include_pending=True)

    assert "/v1/transactions/pending" not in quiet.paths()
    assert [record.pending for record in without.accounts[0].records] == [False]
    assert [record.pending for record in with_pending.accounts[0].records] == [False, True]


async def test_a_failing_pending_request_holds_back_the_accounts_so_their_pending_set_is_kept():
    """A pending set the sync couldn't read isn't an empty one, so the accounts are reported failed rather than returned without it"""
    api = _api().serve("/transactions/pending", '{"success": false, "message": "Down"}', 500)

    result = await fetch(akahu_adapter(api.transport), "acc_chq", include_pending=True)

    assert result.accounts == ()
    assert result.account_errors["acc_chq"].kind is ProviderErrorKind.TEMPORARY


async def test_a_pending_request_that_fails_without_an_outage_keeps_that_kind():
    """Only an outage retries without end, so a refusal that isn't one stays unknown"""
    api = _api().serve("/transactions/pending", '{"success": false}', 404)

    result = await fetch(akahu_adapter(api.transport), "acc_chq", include_pending=True)

    assert result.accounts == ()
    assert result.account_errors["acc_chq"].kind is ProviderErrorKind.UNKNOWN


async def test_an_unreadable_pending_answer_is_unknown():
    """A body that isn't the documented shape isn't an outage"""
    api = _api().serve("/transactions/pending", '{"success": true, "items": [{"nonsense": 1}]}')

    result = await fetch(akahu_adapter(api.transport), "acc_chq", include_pending=True)

    assert result.account_errors["acc_chq"].kind is ProviderErrorKind.UNKNOWN


async def test_a_rate_limit_on_the_pending_request_fails_the_whole_request():
    """A spent quota stops everything, as it does on any other request"""
    api = _api().serve("/transactions/pending", '{"success": false}', 429)

    result = await fetch(akahu_adapter(api.transport), "acc_chq", include_pending=True)

    assert result.accounts == ()
    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.RATE_LIMITED
    assert USER_ACCESS_TOKEN not in result.request_error.reason
    assert APP_ID_TOKEN not in result.request_error.reason
