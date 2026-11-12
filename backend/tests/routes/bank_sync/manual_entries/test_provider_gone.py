"""Writing into an account linked through a provider whose folder was deleted from the server

The refusals and the imported transaction's source name the provider by the name its connection
stored, never by the provider id the rows keep
"""

from sqlalchemy import update

from app.models.bank_transaction import BankTransaction
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import _record_bank_source
from tests.routes.support.manual_entry_helpers import COFFEE_DAY, IMPORT_START, _add, _added_id, _commit_link, _ledger

# A provider id no folder on this server carries, and the name its connection stored while it was installed
_GONE = "lunar_bank"
_GONE_NAME = "Lunar Bank"


async def _gone_ledger(client):
    """Sign up with Everyday linked from 1 June through a connection on the removed provider"""
    ledger = await _ledger(client)
    await _commit_link(ledger, ledger.everyday_id, provider=_GONE, provider_name=_GONE_NAME)
    return ledger


async def test_a_manual_transaction_on_a_supplied_day_is_refused_naming_the_stored_name(client):
    """Adding a Coffee to Everyday on a day the removed provider supplied names it as Lunar Bank"""
    ledger = await _gone_ledger(client)

    added = await _add(client, ledger, ledger.everyday_id, IMPORT_START)

    assert added.status_code == 422, added.text
    assert added.json()["detail"] == "Lunar Bank supplies this account's transactions from Jun 1, 2026 to today"


async def test_archiving_is_refused_naming_the_stored_name(client):
    """Everyday can't be archived while linked, and the refusal names Lunar Bank"""
    ledger = await _gone_ledger(client)

    refused = await client.patch(f"/accounts/{ledger.everyday_id}", json={"is_archived": True}, headers=ledger.headers)

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == "This account is linked to Lunar Bank. Please unlink the account first"


async def test_an_imported_transaction_names_the_stored_name_in_its_source_and_its_delete_refusal(client):
    """Everyday's imported Coffee reads as from Lunar Bank, and deleting it is refused naming Lunar Bank"""
    ledger = await _ledger(client)
    coffee_id = await _added_id(client, ledger, ledger.everyday_id, COFFEE_DAY)
    await _commit_link(ledger, ledger.everyday_id, provider=_GONE, provider_name=_GONE_NAME)
    record_id = await _record_bank_source(coffee_id)
    async with TestSession() as session:
        await session.execute(update(BankTransaction).where(BankTransaction.id == record_id).values(provider=_GONE))
        await session.commit()

    read = await client.get(f"/transactions/{coffee_id}", headers=ledger.headers)
    refused = await client.delete(f"/transactions/{coffee_id}", headers=ledger.headers)

    assert read.status_code == 200, read.text
    assert (read.json()["bank_source"]["provider"], read.json()["bank_source"]["provider_name"]) == (_GONE, _GONE_NAME)
    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == "Imported from Lunar Bank. While Everyday is linked, please edit this transaction instead"
