"""Recording a starting balance on a linked account

A starting balance is dated today in the user's zone, so it is refused once the import has started
and taken before it starts or once the account is unlinked
"""

from datetime import timedelta

from tests.routes.support import _record_starting_balance
from tests.routes.support.manual_entry_helpers import TODAY, _commit_link, _dates_in, _ledger, _unlink


async def test_a_starting_balance_is_refused_once_the_import_has_started(client):
    """Everyday linked from 3 October can't take a starting balance, which would be dated 3 October"""
    ledger = await _ledger(client)
    await _commit_link(ledger, ledger.everyday_id, import_start=TODAY)

    recorded = await _record_starting_balance(client, ledger.headers, ledger.everyday_id, 1_250_00)

    assert recorded.status_code == 422, recorded.text
    assert recorded.json()["detail"] == "Fake Bank supplies this account's transactions from Oct 3, 2026 to today"
    assert await _dates_in(ledger.everyday_id) == []


async def test_a_starting_balance_saves_before_the_import_starts_and_after_unlinking(client):
    """Everyday linked from 4 October takes one on 3 October, and so does Savings once its link from 3 October is ended"""
    ledger = await _ledger(client)
    await _commit_link(ledger, ledger.everyday_id, import_start=TODAY + timedelta(days=1))
    await _commit_link(ledger, ledger.savings_id, import_start=TODAY, external_account_id="ACT-2")
    await _unlink(client, ledger, ledger.savings_id)

    everyday = await _record_starting_balance(client, ledger.headers, ledger.everyday_id, 1_250_00)
    savings = await _record_starting_balance(client, ledger.headers, ledger.savings_id, 1_250_00)

    assert everyday.status_code == 200, everyday.text
    assert savings.status_code == 200, savings.text
    assert await _dates_in(ledger.everyday_id) == [TODAY]
    assert await _dates_in(ledger.savings_id) == [TODAY]
