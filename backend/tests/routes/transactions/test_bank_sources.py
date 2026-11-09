"""Every transaction response carries a bank-imported transaction's bank source

The list markers and the transaction modal read the source from the response itself, so each
route returning a transaction carries it, a page reads its sources in the page's own query, a new
transaction reads none, and the source outlives the link and connection it came through
"""

from datetime import UTC, datetime
from uuid import UUID

from app.models.account import Account
from app.models.bank_connection import BankAccountLink, BankConnection, BankLinkState
from app.models.bank_transaction import BankTransaction, OpenReviewKind
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    BANK_DATE,
    BANK_DESCRIPTION,
    BANK_RECEIVED_AT,
    _build_bank_connection,
    _build_bank_link,
    _build_bank_transaction,
    _build_ledger_transaction,
    _record_bank_source,
)
from tests.routes.support.query_helpers import _get_with_selects, _recorded_statements
from tests.routes.transactions._helpers import _create_transaction, _setup_user_with_deps


def _bank_source(
    *,
    amount: int | None = -1250,
    raw_amount: str | None = None,
    edited_fields: list[str] | None = None,
    review_item_id: UUID | None = None,
) -> dict:
    """Return the bank source a Fake Bank coffee purchase on the bank's date carries"""
    return {
        "provider": "fake",
        "provider_name": "Fake Bank",
        "bank_values": {
            "date": BANK_DATE.isoformat(),
            "amount": amount,
            "raw_amount": raw_amount,
            "description": BANK_DESCRIPTION,
        },
        "received_at": "2026-10-04T09:05:00Z",
        "edited_fields": edited_fields or [],
        "review_item_id": str(review_item_id) if review_item_id else None,
    }


async def _create_on_bank_date(client, headers, account_id, category_id, amount):
    """Create a ledger transaction on the bank's date and return its id"""
    created = await _create_transaction(client, headers, account_id, category_id, dt=BANK_DATE.isoformat(), amount=amount)
    assert created.status_code == 201, created.text
    return created.json()["id"]


async def test_manual_transaction_responses_carry_no_bank_source(client):
    """A hand-entered $30.00 lunch has no bank source when created, read or listed"""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    created = await _create_transaction(client, headers, account_id, category_id, amount=-3000)
    assert created.status_code == 201, created.text

    detail = await client.get(f"/transactions/{created.json()['id']}", headers=headers)
    listed = await client.get("/transactions", headers=headers)

    assert detail.status_code == 200, detail.text
    assert listed.status_code == 200, listed.text
    assert created.json()["bank_source"] is None
    assert detail.json()["bank_source"] is None
    assert [row["bank_source"] for row in listed.json()] == [None]


async def test_bank_source_marks_the_amount_edited_while_the_ledger_differs_from_the_bank(client):
    """Sent as a $12.50 debit and added as $10.00, the amount is edited and the date isn't"""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    transaction_id = await _create_on_bank_date(client, headers, account_id, category_id, -1000)
    await _record_bank_source(transaction_id, bank_amount=-1250)

    detail = await client.get(f"/transactions/{transaction_id}", headers=headers)
    listed = await client.get("/transactions", headers=headers)

    assert detail.status_code == 200, detail.text
    assert listed.status_code == 200, listed.text
    assert detail.json()["bank_source"] == _bank_source(edited_fields=["amount"])
    assert [row["bank_source"] for row in listed.json()] == [_bank_source(edited_fields=["amount"])]


async def test_bank_source_with_an_amount_cad_cannot_hold_shows_it_as_sent_and_edited(client):
    """The bank sent -12.505, an amount cents can't hold, so the user entered the ledger amount"""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    transaction_id = await _create_on_bank_date(client, headers, account_id, category_id, -1251)
    record_id = await _record_bank_source(transaction_id)
    async with TestSession() as session:
        record = await session.get(BankTransaction, record_id)
        record.observed_amount = None
        record.raw_amount = "-12.505"
        record.aligned_amount = None
        await session.commit()

    detail = await client.get(f"/transactions/{transaction_id}", headers=headers)
    listed = await client.get("/transactions", headers=headers)

    expected = _bank_source(amount=None, raw_amount="-12.505", edited_fields=["amount"])
    assert detail.status_code == 200, detail.text
    assert listed.status_code == 200, listed.text
    assert detail.json()["bank_source"] == expected
    assert [row["bank_source"] for row in listed.json()] == [expected]


async def test_editing_the_date_keeps_the_source_and_marks_the_date_edited(client):
    """Moving a bank-sourced transaction a day edits that same row, and it stays bank-sourced"""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    transaction_id = await _create_on_bank_date(client, headers, account_id, category_id, -1250)
    await _record_bank_source(transaction_id)

    updated = await client.patch(f"/transactions/{transaction_id}", headers=headers, json={"dt": "2026-10-02"})

    assert updated.status_code == 200, updated.text
    assert updated.json()["id"] == transaction_id
    assert updated.json()["bank_source"] == _bank_source(edited_fields=["date"])


async def test_bank_source_names_the_waiting_correction_about_the_transaction(client):
    """The bank now says $13.00, so the list can show Needs review and jump to the correction"""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    transaction_id = await _create_on_bank_date(client, headers, account_id, category_id, -1250)
    record_id = await _record_bank_source(transaction_id)
    async with TestSession() as session:
        record = await session.get(BankTransaction, record_id)
        record.observed_amount = -1300
        record.open_kind = OpenReviewKind.CORRECTION
        await session.commit()

    listed = await client.get("/transactions", headers=headers)

    assert listed.status_code == 200, listed.text
    assert [row["bank_source"] for row in listed.json()] == [_bank_source(amount=-1300, review_item_id=record_id)]


async def test_bank_source_stays_readable_after_unlinking_and_disconnecting(client):
    """Everyday's imported transaction still shows Fake Bank and the bank's values"""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    transaction_id = await _create_on_bank_date(client, headers, account_id, category_id, -1250)
    async with TestSession() as session:
        account = await session.get(Account, UUID(account_id))
        connection = _build_bank_connection(account.owner_id)
        session.add(connection)
        await session.flush()
        link = _build_bank_link(account, connection)
        session.add(link)
        await session.commit()
    await _record_bank_source(transaction_id)

    async with TestSession() as session:
        stored_link = await session.get(BankAccountLink, link.id)
        stored_link.state = BankLinkState.UNLINKED
        stored_link.unlinked_at = datetime(2026, 10, 4, 12, 0, tzinfo=UTC)
        await session.flush()
        await session.delete(await session.get(BankConnection, connection.id))
        await session.commit()
    detail = await client.get(f"/transactions/{transaction_id}", headers=headers)

    assert detail.status_code == 200, detail.text
    assert detail.json()["bank_source"] == _bank_source()


async def _seed_bank_sourced(account_id: str, category_id: str, count: int, first: int) -> None:
    """Commit ledger rows, each with the bank transaction it came from"""
    async with TestSession() as session:
        account = await session.get(Account, UUID(account_id))
        ledger = [_build_ledger_transaction(account, UUID(category_id)) for _ in range(count)]
        session.add_all(ledger)
        await session.flush()
        records = [_build_bank_transaction(account, f"TRN-{first + index}", transaction=txn) for index, txn in enumerate(ledger)]
        for record in records:
            record.received_at = BANK_RECEIVED_AT
        session.add_all(records)
        await session.commit()


async def test_listing_loads_a_pages_bank_sources_in_its_own_query(client):
    """A page of 50 bank-sourced transactions runs as many SELECTs as a page of one

    The bank transactions are read only in the page's own query
    """
    headers, account_id, category_id = await _setup_user_with_deps(client)
    await _seed_bank_sourced(account_id, category_id, 1, first=0)
    one_page, one_selects = await _get_with_selects(client, "/transactions", headers, limit=50)
    await _seed_bank_sourced(account_id, category_id, 49, first=1)

    full_page, full_selects = await _get_with_selects(client, "/transactions", headers, limit=50)

    assert [row["bank_source"]["provider"] for row in one_page] == ["fake"]
    assert len(full_page) == 50
    assert all(row["bank_source"] == _bank_source() for row in full_page)
    assert len(full_selects) == len(one_selects)
    assert [_reads_bank_transactions(statement) for statement in full_selects].count(True) == 1
    assert next(statement for statement in full_selects if _reads_bank_transactions(statement)).startswith("SELECT transactions.")


def _reads_bank_transactions(statement: str) -> bool:
    """Whether a statement reads the bank transactions table, on its own or joined in"""
    return "bank_transactions" in statement


async def test_creating_a_transaction_reads_no_bank_transaction(client):
    """A hand-entered $30.00 lunch is new, so no bank transaction can point at it yet"""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    with _recorded_statements() as statements:
        created = await _create_transaction(client, headers, account_id, category_id, amount=-3000)

    assert created.status_code == 201, created.text
    assert created.json()["bank_source"] is None
    assert not any(_reads_bank_transactions(statement) for statement in statements)
