"""Restoring the bank's date or amount on a bank-imported transaction the user edited

Restoring writes the bank's latest value to the same ledger transaction, sign included, rebuilds its
balances and aligns the field with the bank, so it no longer counts as edited and the bank's next
change is compared with it. A restore that wrote a stale bank value, skipped the alignment, bypassed a waiting
correction on a field the user left alone, or reached another user's ledger would leave the ledger
quietly differing from the bank or change money the user never asked to
"""

import asyncio
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import func, select, update

from app.models.bank_connection import BankAccountLink
from app.models.bank_transaction import BankTransactionDisposition, OpenReviewKind
from app.models.transaction import Transaction
from app.services.bank_sync import review_decisions
from app.services.bank_sync.ingestion import store_booked_records
from app.services.bank_sync.providers.contract import ProviderRecord
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    BANK_DATE,
    BANK_DESCRIPTION,
    _balances,
    _build_bank_transaction,
    _build_category,
    _build_ledger_transaction,
    _changed_at,
    _commit_other_users_account,
    _commit_review_item,
    _ledger_rows,
    _owner_session,
    _review_page,
    _stored_item,
)
from tests.routes.support.lock_helpers import _wait_until_waiting_on
from tests.routes.support.manual_entry_helpers import _commit_link, _Ledger, _ledger
from tests.routes.support.query_helpers import _recorded_statements, _writes
from tests.routes.support.transaction_helpers import _create_transaction

# The bank's own amount for the coffee, -42.10
_BANK_AMOUNT = -4210


@dataclass(frozen=True)
class _Imported:
    """A signed-up user's coffee in Everyday's ledger, and the bank transaction it came from"""

    ledger: _Ledger
    transaction_id: str
    record_id: uuid.UUID

    @property
    def headers(self) -> dict:
        """The user's auth headers"""
        return self.ledger.headers

    @property
    def account_id(self) -> str:
        """The Everyday account that holds the coffee"""
        return self.ledger.everyday_id


async def _bank_imported(client, *, ledger_date: date = BANK_DATE, ledger_amount: int = -4000, **record_values) -> _Imported:
    """Sign up with the bank's HARBOUR COFFEE 0412 at -42.10 on 3 October in Everyday's ledger, saved by the user on the date and amount given

    The bank transaction is accepted and aligned with the bank's 3 October and -42.10, with any of
    its values replaced
    """
    ledger = await _ledger(client)
    created = await _create_transaction(
        client, ledger.headers, ledger.everyday_id, ledger.category_id, dt=ledger_date.isoformat(), amount=ledger_amount
    )
    assert created.status_code == 201, created.text
    values = {
        "disposition": BankTransactionDisposition.ACCEPTED,
        "transaction_id": uuid.UUID(created.json()["id"]),
        "observed_amount": _BANK_AMOUNT,
        "aligned_date": BANK_DATE,
        "aligned_amount": _BANK_AMOUNT,
    }
    record_id = await _commit_review_item(ledger.everyday_id, **(values | record_values))
    return _Imported(ledger, created.json()["id"], record_id)


async def _restore(client, imported: _Imported, field: str, transaction_id: str | uuid.UUID | None = None):
    """Post a restore of one field of the coffee, or of another transaction"""
    return await client.post(
        f"/bank-sync/transaction-sources/{transaction_id or imported.transaction_id}/restore", json={"field": field}, headers=imported.headers
    )


def _bank_sends(amount: int) -> ProviderRecord:
    """Return the coffee as the bank sends it in a sync, at the amount given"""
    return ProviderRecord(
        external_id="TRN-1001",
        date=BANK_DATE,
        amount=amount,
        raw_amount=f"{amount / 100:.2f}",
        description=BANK_DESCRIPTION,
        pending=False,
    )


async def test_restoring_the_amount_writes_the_banks_amount_and_its_sign_to_the_same_transaction(client):
    """The bank sent -42.10, and the user turned it into +42.10 and moved it to 2 October

    Restoring the amount brings back -42.10 on the same transaction, its balance follows, the date
    stays edited, and the cache mark is the last write
    """
    imported = await _bank_imported(client, ledger_date=date(2026, 10, 2), ledger_amount=4210)
    before = await _changed_at(client, imported.headers)

    with _recorded_statements() as statements:
        restored = await _restore(client, imported, "amount")

    assert restored.status_code == 200, restored.text
    body = restored.json()
    assert (body["id"], body["dt"], body["amount"]) == (imported.transaction_id, "2026-10-02", _BANK_AMOUNT)
    assert (body["bank_source"]["bank_values"]["amount"], body["bank_source"]["edited_fields"]) == (_BANK_AMOUNT, ["date"])
    assert await _ledger_rows(imported.account_id) == [(date(2026, 10, 2), _BANK_AMOUNT)]
    assert await _balances(imported.account_id) == [(date(2026, 10, 2), _BANK_AMOUNT)]
    stored = await _stored_item(imported.record_id)
    assert (stored.aligned_date, stored.aligned_amount) == (BANK_DATE, _BANK_AMOUNT)
    assert await _changed_at(client, imported.headers) != before
    assert "user_cache_states" in _writes(statements)[-1]


async def test_restoring_the_date_moves_the_transaction_and_its_balance_to_the_banks_date(client):
    """The user moved the coffee from 3 to 1 October, and restoring the date moves it and its balance back to 3 October"""
    imported = await _bank_imported(client, ledger_date=date(2026, 10, 1), ledger_amount=_BANK_AMOUNT)

    restored = await _restore(client, imported, "date")

    assert restored.status_code == 200, restored.text
    assert (restored.json()["dt"], restored.json()["amount"], restored.json()["bank_source"]["edited_fields"]) == (
        BANK_DATE.isoformat(),
        _BANK_AMOUNT,
        [],
    )
    assert await _ledger_rows(imported.account_id) == [(BANK_DATE, _BANK_AMOUNT)]
    assert await _balances(imported.account_id) == [(BANK_DATE, _BANK_AMOUNT)]


async def test_a_restored_amount_takes_the_banks_latest_and_the_next_bank_change_is_compared_with_it(client):
    """The user saved -40.00, and the bank has since sent -45.10 with nothing waiting on it

    Restoring sets the bank's latest -45.10 rather than the -42.10 the user first edited, so when the
    bank next changes the coffee to -46.00 a correction opens against -45.10 and the ledger keeps it
    """
    imported = await _bank_imported(client, observed_amount=-4510)
    await _commit_link(imported.ledger, imported.account_id)

    restored = await _restore(client, imported, "amount")
    async with _owner_session(imported.ledger.user_id) as syncing:
        link = await syncing.scalar(select(BankAccountLink).where(BankAccountLink.account_id == uuid.UUID(imported.account_id)))
        await store_booked_records(syncing, [(link, [_bank_sends(-4600)])], observed_at=datetime(2026, 10, 5, 9, 0, tzinfo=UTC))
        await syncing.commit()

    assert restored.status_code == 200, restored.text
    assert (restored.json()["amount"], restored.json()["bank_source"]["edited_fields"]) == (-4510, [])
    assert await _ledger_rows(imported.account_id) == [(BANK_DATE, -4510)]
    stored = await _stored_item(imported.record_id)
    assert (stored.open_kind, stored.previous_values) == (OpenReviewKind.CORRECTION, {"amount": -4510})


@pytest.mark.parametrize(
    ("open_kind", "previous_values", "waiting", "kept_for_later"),
    [
        (OpenReviewKind.CORRECTION, {"amount": _BANK_AMOUNT}, [], None),
        (
            OpenReviewKind.CORRECTION,
            {"amount": _BANK_AMOUNT, "description": "HARBOUR CAFE"},
            [("correction", ["description"])],
            {"description": "HARBOUR CAFE"},
        ),
        (OpenReviewKind.REMOVAL, {"amount": _BANK_AMOUNT}, [("removal", [])], None),
    ],
    ids=["correction to the amount", "correction to the amount and description", "removal over a correction to the amount"],
)
async def test_restoring_an_amount_a_correction_waits_on_settles_that_field(client, open_kind, previous_values, waiting, kept_for_later):
    """The user saved -40.00 over the bank's -42.10, and the bank has since changed it to -45.10

    Restoring writes -45.10, so nothing is left to decide about the amount: a correction to it alone
    leaves the review list, one that also changed the description waits for that alone, and a
    removal that took a correction's place stays, with no amount left to bring back after it
    """
    imported = await _bank_imported(
        client,
        observed_amount=-4510,
        open_kind=open_kind,
        previous_values=previous_values,
        removed_at=datetime(2026, 10, 4, 9, 0, tzinfo=UTC) if open_kind == OpenReviewKind.REMOVAL else None,
    )

    restored = await _restore(client, imported, "amount")

    assert restored.status_code == 200, restored.text
    assert (restored.json()["amount"], restored.json()["bank_source"]["review_item_id"]) == (
        -4510,
        str(imported.record_id) if waiting else None,
    )
    assert [(item["kind"], item["changed_fields"]) for item in (await _review_page(client, imported.headers))["items"]] == waiting
    assert (await _stored_item(imported.record_id)).previous_values == kept_for_later
    assert await _ledger_rows(imported.account_id) == [(BANK_DATE, -4510)]


async def test_restoring_a_field_the_user_left_alone_changes_nothing(client):
    """The ledger still holds the bank's -42.10 while a correction to -45.10 waits for review

    The amount isn't edited, so restoring answers with the transaction as it stands and leaves the
    correction for the user to decide rather than applying it without review
    """
    imported = await _bank_imported(
        client, ledger_amount=_BANK_AMOUNT, observed_amount=-4510, open_kind=OpenReviewKind.CORRECTION, previous_values={"amount": _BANK_AMOUNT}
    )

    restored = await _restore(client, imported, "amount")

    assert restored.status_code == 200, restored.text
    assert (restored.json()["amount"], restored.json()["bank_source"]["review_item_id"]) == (_BANK_AMOUNT, str(imported.record_id))
    assert await _ledger_rows(imported.account_id) == [(BANK_DATE, _BANK_AMOUNT)]
    stored = await _stored_item(imported.record_id)
    assert (stored.open_kind, stored.version) == (OpenReviewKind.CORRECTION, 1)


async def test_restoring_an_amount_the_currency_cant_hold_is_refused(client):
    """The bank sent -12.505 and CAD can't hold it, so the user entered -12.51 and there is no bank amount to put back"""
    imported = await _bank_imported(client, ledger_amount=-1251, observed_amount=None, raw_amount="-12.505", aligned_amount=None)

    refused = await _restore(client, imported, "amount")

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == "The bank's amount has more decimal places than CAD allows, so it can't be restored"
    assert await _ledger_rows(imported.account_id) == [(BANK_DATE, -1251)]


async def test_restoring_another_users_or_a_hand_entered_transaction_is_not_found(client):
    """Another user's imported coffee and a lunch the user entered by hand both have no bank source the user can restore from

    Each would have its amount restored if the check were missing, and stays as it was
    """
    imported = await _bank_imported(client)
    theirs = await _commit_other_users_account()
    async with TestSession() as session:
        their_category = _build_category(theirs.owner_id)
        session.add(their_category)
        await session.flush()
        their_coffee = _build_ledger_transaction(theirs, their_category.id, amount=-4000)
        session.add(their_coffee)
        await session.flush()
        session.add(_build_bank_transaction(theirs, amount=_BANK_AMOUNT, transaction=their_coffee))
        await session.commit()
    lunch = await _create_transaction(client, imported.headers, imported.account_id, imported.ledger.category_id, amount=-1500)
    assert lunch.status_code == 201, lunch.text

    responses = [await _restore(client, imported, "amount", transaction_id) for transaction_id in (their_coffee.id, lunch.json()["id"])]

    assert [response.status_code for response in responses] == [404, 404]
    assert [response.json()["detail"] for response in responses] == ["Bank source not found"] * 2
    assert await _ledger_rows(theirs.id) == [(BANK_DATE, -4000)]


async def test_restoring_waits_for_an_edit_to_the_ledger_row_and_rebuilds_balances_from_its_date(client):
    """The user is moving the coffee to 1 October as they restore the bank's -42.10 over their -40.00

    Restoring waits for the move, then writes -42.10 to the moved transaction and rebuilds its
    balances from 1 October, the date it now sits on, leaving the moved date edited
    """
    imported = await _bank_imported(client)
    ledger_row = Transaction.id == uuid.UUID(imported.transaction_id)

    async with asyncio.timeout(10), TestSession() as editing:
        await editing.execute(select(Transaction.id).where(ledger_row).with_for_update())
        editing_pid = await editing.scalar(select(func.pg_backend_pid()))
        restoring = asyncio.create_task(_restore(client, imported, "amount"))
        await _wait_until_waiting_on(editing_pid, restoring)
        await editing.execute(update(Transaction).where(ledger_row).values(dt=date(2026, 10, 1)))
        await editing.commit()
        restored = await restoring

    assert restored.status_code == 200, restored.text
    assert (restored.json()["dt"], restored.json()["amount"], restored.json()["bank_source"]["edited_fields"]) == (
        "2026-10-01",
        _BANK_AMOUNT,
        ["date"],
    )
    assert await _balances(imported.account_id) == [(date(2026, 10, 1), _BANK_AMOUNT)]


async def test_restoring_writes_nothing_when_the_save_fails_after_the_ledger_row(client, monkeypatch):
    """A failure once the ledger row and its balances are written leaves the coffee at the user's -40.00, still edited"""

    async def fail(db, user_id):
        """Fail where the cache is marked, after every other write"""
        raise RuntimeError("cache mark failed")

    imported = await _bank_imported(client)
    monkeypatch.setattr(review_decisions, "mark_user_cache_changed", fail)

    with pytest.raises(RuntimeError, match="cache mark failed"):
        await _restore(client, imported, "amount")

    assert await _ledger_rows(imported.account_id) == [(BANK_DATE, -4000)]
    assert await _balances(imported.account_id) == [(BANK_DATE, -4000)]
    stored = await _stored_item(imported.record_id)
    assert (stored.aligned_amount, stored.version) == (_BANK_AMOUNT, 1)


async def test_a_restore_waiting_on_a_sync_restores_the_value_the_sync_stored(client):
    """A sync stores the bank's change from -42.10 to -46.00, opening a correction and leaving the user's -40.00 as edited

    The restore waits for the sync to commit, then puts the bank's newest -46.00 on the ledger rather
    than the -42.10 it would have read before the sync finished. That would leave the ledger
    differing from the bank with nothing marked edited
    """
    imported = await _bank_imported(client)
    await _commit_link(imported.ledger, imported.account_id)

    async with asyncio.timeout(10), _owner_session(imported.ledger.user_id) as syncing:
        link = await syncing.scalar(
            select(BankAccountLink).where(BankAccountLink.account_id == uuid.UUID(imported.account_id)).with_for_update()
        )
        await store_booked_records(syncing, [(link, [_bank_sends(-4600)])], observed_at=datetime(2026, 10, 5, 9, 0, tzinfo=UTC))
        syncing_pid = await syncing.scalar(select(func.pg_backend_pid()))
        restoring = asyncio.create_task(_restore(client, imported, "amount"))
        await _wait_until_waiting_on(syncing_pid, restoring)
        await syncing.commit()
        restored = await restoring

    assert restored.status_code == 200, restored.text
    assert restored.json()["amount"] == -4600
    assert await _ledger_rows(imported.account_id) == [(BANK_DATE, -4600)]
    assert await _balances(imported.account_id) == [(BANK_DATE, -4600)]
    stored = await _stored_item(imported.record_id)
    assert (stored.observed_amount, stored.aligned_amount) == (-4600, -4600)
