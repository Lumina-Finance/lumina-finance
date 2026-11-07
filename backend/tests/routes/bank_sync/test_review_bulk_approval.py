"""Approving waiting bank items in bulk: the preview of what it would change, and applying exactly that

The preview groups the corrections and removals in scope, each group with its net effect on
balances per currency, and counts the new items it leaves waiting. Applying accepts each correction
and removes each transaction the preview listed, in one save, skipping any changed or decided since.
A preview that misstates a net effect shows the user the wrong money, one ignoring the account filter
approves another account's items, an approval applying a changed item decides values the bank no
longer sends, one applied twice moves money twice, one reaching another user's item changes their
ledger, and one taking its locks out of order deadlocks with a ledger edit made at the same moment
"""

import asyncio
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime

from fastapi import HTTPException, status
from sqlalchemy import func, select, text

from app.models.bank_connection import BankAccountLink
from app.models.bank_transaction import BankTransaction, BankTransactionDisposition, OpenReviewKind
from app.models.currency import Currency
from app.models.transaction import Transaction
from app.services.accounts.snapshots import recompute_account_snapshots, sort_by_snapshot_lock
from app.services.bank_sync import bulk_approval
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    BANK_DATE,
    _balances,
    _build_bank_transaction,
    _build_category,
    _build_ledger_transaction,
    _changed_at,
    _commit_other_users_account,
    _commit_review_item,
    _ledger_rows,
    _new_account,
    _new_group_account,
    _review_page,
    _still_stored,
    _stored_item,
)
from tests.routes.support.lock_helpers import _wait_until_waiting_on
from tests.routes.support.manual_entry_helpers import _commit_link, _Ledger, _ledger
from tests.routes.support.query_helpers import _recorded_statements, _writes
from tests.routes.support.transaction_helpers import _create_transaction

_COUNTDOWN = "COUNTDOWN 123 AUCKLAND"
_UBER = "UBER TRIP"
_FRESHCO = "FRESHCO GROCERIES"

# The day the bank moves the Uber trip to, from the bank's date of 3 October
_OCT_1 = date(2026, 10, 1)

# When the sync stored the bank's removal of the groceries
_REPORTED_AT = datetime(2026, 10, 4, 9, tzinfo=UTC)


@dataclass(frozen=True)
class _Waiting:
    """A ledger transaction and the bank's correction or removal of it waiting"""

    item_id: uuid.UUID
    transaction_id: str


@dataclass(frozen=True)
class _Everyday:
    """A signed-up user's linked Everyday, with four new items, two corrections and a removal waiting"""

    ledger: _Ledger

    # The bank's change from -42.10 to -45.10
    countdown: _Waiting

    # The bank's move from 3 to 1 October, with the amount unchanged
    uber: _Waiting

    # The bank's removal of a -18.00 transaction
    freshco: _Waiting

    @property
    def headers(self) -> dict:
        """The user's auth headers"""
        return self.ledger.headers

    @property
    def account_id(self) -> str:
        """Everyday"""
        return self.ledger.everyday_id


async def _record(client, ledger: _Ledger, account_id: str, amount: int, *, currency: str = "CAD") -> str:
    """Record a transaction of the amount on the bank's date in the account, and return its id"""
    created = await _create_transaction(
        client, ledger.headers, account_id, ledger.category_id, dt=BANK_DATE.isoformat(), amount=amount, currency=currency
    )
    assert created.status_code == 201, created.text
    return created.json()["id"]


async def _commit_bank_source(account_id: str, transaction_id: str, description: str, amount: int, **item_values) -> _Waiting:
    """Commit the accepted bank transaction a ledger transaction of the amount came from, with any of its values replaced"""
    values = {
        "disposition": BankTransactionDisposition.ACCEPTED,
        "transaction_id": uuid.UUID(transaction_id),
        "description": description,
        "aligned_date": BANK_DATE,
        "aligned_amount": amount,
        "observed_amount": amount,
    }
    item_id = await _commit_review_item(account_id, f"TRN-{description}", **(values | item_values))
    return _Waiting(item_id, transaction_id)


async def _commit_accepted(
    client, ledger: _Ledger, account_id: str, description: str, amount: int, *, currency: str = "CAD", **item_values
) -> _Waiting:
    """Record a transaction of the amount on the bank's date and the accepted bank transaction it came from, with any of its values replaced"""
    transaction_id = await _record(client, ledger, account_id, amount, currency=currency)
    return await _commit_bank_source(account_id, transaction_id, description, amount, **item_values)


def _amount_change(bank_amount: int, ledger_amount: int) -> dict:
    """Return the values of a correction that changes the amount the ledger holds to the bank's"""
    return {"observed_amount": bank_amount, "open_kind": OpenReviewKind.CORRECTION, "previous_values": {"amount": ledger_amount}}


async def _everyday_waiting(client, **countdown_values) -> _Everyday:
    """Sign up with Everyday holding the Countdown, Uber and FreshCo transactions, the bank's decisions on them and four new items waiting

    Everyday is linked once its transactions are recorded, and any of the Countdown item's values are replaced
    """
    ledger = await _ledger(client)
    countdown = await _commit_accepted(
        client, ledger, ledger.everyday_id, _COUNTDOWN, -4210, **(_amount_change(-4510, -4210) | countdown_values)
    )
    uber = await _commit_accepted(
        client,
        ledger,
        ledger.everyday_id,
        _UBER,
        -1600,
        observed_date=_OCT_1,
        open_kind=OpenReviewKind.CORRECTION,
        previous_values={"date": BANK_DATE.isoformat()},
    )
    freshco = await _commit_accepted(
        client, ledger, ledger.everyday_id, _FRESHCO, -1800, open_kind=OpenReviewKind.REMOVAL, removed_at=_REPORTED_AT
    )
    for number in range(4):
        await _commit_review_item(ledger.everyday_id, f"TRN-NEW-{number}")
    await _commit_link(ledger, ledger.everyday_id)
    return _Everyday(ledger, countdown, uber, freshco)


async def _preview(client, headers, account_ids: list[str] | None = None) -> dict:
    """Return the bulk approval preview for the accounts given, or for every account"""
    preview = await client.post("/bank-review/bulk-approve/preview", json={"account_ids": account_ids}, headers=headers)
    assert preview.status_code == 200, preview.text
    return preview.json()


def _groups(preview: dict) -> list[tuple]:
    """Return each group's kind, count, net effect and the ids of its items"""
    return [
        (group["kind"], group["count"], group["net_effect"], [uuid.UUID(item["id"]) for item in group["items"]]) for group in preview["groups"]
    ]


async def _approve(client, headers, preview: dict):
    """Apply what the preview listed, each item at the version it showed"""
    items = [{"id": item["id"], "version": item["version"]} for group in preview["groups"] for item in group["items"]]
    return await client.post("/bank-review/bulk-approve", json={"items": items}, headers=headers)


def _outcome(approved) -> tuple[dict, set[uuid.UUID]]:
    """Return the counts an approval answered with, and the ids of the items it applied"""
    body = approved.json()
    return {count: body[count] for count in ("corrected", "removed", "failed")}, {uuid.UUID(item_id) for item_id in body["applied_ids"]}


def _cad(amount: int) -> list[dict]:
    """Return a net effect of the amount on balances in Canadian dollars"""
    return [{"currency": "CAD", "amount": amount}]


async def test_preview_groups_the_corrections_and_removal_with_their_net_effects_and_counts_the_new_items_left(client):
    """The corrections net -3.00, since only Countdown's amount changes, and taking out FreshCo's -18.00 nets +18.00

    Each item is listed as the review list shows it, version included, and the four new items stay
    waiting
    """
    everyday = await _everyday_waiting(client)

    preview = await _preview(client, everyday.headers)

    assert _groups(preview) == [
        ("correction", 2, _cad(-300), [everyday.countdown.item_id, everyday.uber.item_id]),
        ("removal", 1, _cad(1800), [everyday.freshco.item_id]),
    ]
    assert preview["excluded_count"] == 4
    listed = {item["id"]: item for item in (await _review_page(client, everyday.headers))["items"]}
    assert all(item == listed[item["id"]] for group in preview["groups"] for item in group["items"])


async def test_preview_gives_one_net_effect_per_currency_and_none_for_a_currency_whose_balances_dont_move(client):
    """A USD correction of +5.00 and an NZD one of -2.50 each net in their own currency, and Everyday's date-only change moves no balance"""
    ledger = await _ledger(client)
    async with TestSession() as session:
        session.add(Currency(id="NZD", name="New Zealand Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()
    wallet_id = await _new_account(client, ledger.headers, "Wallet", currency="USD")
    kiwi_id = await _new_account(client, ledger.headers, "Kiwi", currency="NZD")
    await _commit_accepted(client, ledger, wallet_id, "REFUND", 1000, currency="USD", **_amount_change(1500, 1000))
    await _commit_accepted(client, ledger, kiwi_id, "PAKNSAVE", -2000, currency="NZD", **_amount_change(-2250, -2000))
    await _commit_accepted(
        client,
        ledger,
        ledger.everyday_id,
        _UBER,
        -1600,
        observed_date=_OCT_1,
        open_kind=OpenReviewKind.CORRECTION,
        previous_values={"date": BANK_DATE.isoformat()},
    )

    preview = await _preview(client, ledger.headers)

    assert [(group["count"], group["net_effect"]) for group in preview["groups"]] == [
        (3, [{"currency": "NZD", "amount": -250}, {"currency": "USD", "amount": 500}]),
    ]


async def test_preview_leaves_out_a_correction_whose_bank_amount_the_currency_cant_hold(client):
    """Accepting it would be refused, so it stays waiting in the review list and isn't counted with the new items"""
    everyday = await _everyday_waiting(client, observed_amount=None, raw_amount="-45.105")

    preview = await _preview(client, everyday.headers)

    assert [(kind, count) for kind, count, _, _ in _groups(preview)] == [("correction", 1), ("removal", 1)]
    assert preview["excluded_count"] == 4
    assert str(everyday.countdown.item_id) in {item["id"] for item in (await _review_page(client, everyday.headers))["items"]}


async def test_preview_gives_no_balance_change_for_a_date_correction_of_an_amount_the_user_edited(client):
    """The bank moves a -42.10 trip the user changed to -50.00 to 1 October, and accepting a date leaves the user's amount as it is"""
    ledger = await _ledger(client)
    trip = await _commit_accepted(
        client,
        ledger,
        ledger.everyday_id,
        _UBER,
        -5000,
        observed_amount=-4210,
        aligned_amount=-4210,
        observed_date=_OCT_1,
        open_kind=OpenReviewKind.CORRECTION,
        previous_values={"date": BANK_DATE.isoformat()},
    )

    preview = await _preview(client, ledger.headers)

    assert _groups(preview) == [("correction", 1, [], [trip.item_id])]


async def test_preview_follows_the_account_filter(client):
    """Savings has only new items, so filtered to it nothing can be approved, and filtered to Everyday only Everyday's items are previewed"""
    everyday = await _everyday_waiting(client)
    for number in range(2):
        await _commit_review_item(everyday.ledger.savings_id, f"TRN-SAVINGS-{number}")

    savings = await _preview(client, everyday.headers, [everyday.ledger.savings_id])
    filtered = await _preview(client, everyday.headers, [everyday.account_id])
    every_account = await _preview(client, everyday.headers)

    assert (savings["groups"], savings["excluded_count"]) == ([], 2)
    assert (filtered["groups"], filtered["excluded_count"]) == (every_account["groups"], 4)
    assert every_account["excluded_count"] == 6


async def test_preview_of_another_users_account_is_not_found_and_of_a_group_account_is_refused(client):
    """Only the user's own personal accounts have bank items, as in the review list"""
    everyday = await _everyday_waiting(client)
    theirs = await _commit_other_users_account()
    joint_id = await _new_group_account(client, everyday.headers)

    responses = [
        await client.post("/bank-review/bulk-approve/preview", json={"account_ids": [account_id]}, headers=everyday.headers)
        for account_id in (str(theirs.id), joint_id)
    ]

    assert [(response.status_code, response.json()["detail"]) for response in responses] == [
        (status.HTTP_404_NOT_FOUND, "Account not found"),
        (status.HTTP_403_FORBIDDEN, "Bank items aren't listed for accounts shared with a group"),
    ]


async def test_approving_applies_the_previewed_corrections_and_removal_in_one_save(client):
    """Countdown takes the bank's -45.10, Uber moves to 1 October, FreshCo leaves the ledger, and the balances follow

    The four new items stay waiting, and the cache mark is the save's last write
    """
    everyday = await _everyday_waiting(client)
    preview = await _preview(client, everyday.headers)
    before = await _changed_at(client, everyday.headers)

    with _recorded_statements() as statements:
        approved = await _approve(client, everyday.headers, preview)

    assert approved.status_code == status.HTTP_200_OK, approved.text
    assert _outcome(approved) == (
        {"corrected": 2, "removed": 1, "failed": 0},
        {everyday.countdown.item_id, everyday.uber.item_id, everyday.freshco.item_id},
    )
    assert sorted(await _ledger_rows(everyday.account_id)) == [(_OCT_1, -1600), (BANK_DATE, -4510)]
    assert await _balances(everyday.account_id) == [(_OCT_1, -1600), (BANK_DATE, -6110)]
    assert (await _review_page(client, everyday.headers))["counts"] == {"new": 4, "correction": 0, "removal": 0}
    assert not await _still_stored(everyday.freshco.item_id)
    assert await _changed_at(client, everyday.headers) != before
    assert "user_cache_states" in _writes(statements)[-1]


async def test_approving_a_new_bank_description_ends_the_one_the_user_kept(client):
    """The user kept COUNTDOWN AKL over the bank's COUNTDOWN AUCKLAND, and the bank now sends COUNTDOWN 123 AUCKLAND with its -45.10

    Approving makes the ledger follow the bank's description, as accepting it alone does, so
    COUNTDOWN AKL sent again later is a change to ask about
    """
    everyday = await _everyday_waiting(
        client, previous_values={"amount": -4210, "description": "COUNTDOWN AUCKLAND"}, kept_description="COUNTDOWN AKL"
    )

    approved = await _approve(client, everyday.headers, await _preview(client, everyday.headers))

    assert approved.status_code == status.HTTP_200_OK, approved.text
    assert everyday.countdown.item_id in _outcome(approved)[1]
    stored = await _stored_item(everyday.countdown.item_id)
    assert (stored.open_kind, stored.kept_description) == (None, None)


async def test_approving_waits_for_a_sync_changing_a_correction_and_leaves_it_waiting(client):
    """The bank sends -46.10 for Countdown while the approval waits, so Countdown stays waiting with it and the others apply"""
    everyday = await _everyday_waiting(client)
    preview = await _preview(client, everyday.headers)

    async with asyncio.timeout(10), TestSession() as syncing:
        # The sync's order: the link, then the bank transactions
        await syncing.execute(select(BankAccountLink.id).where(BankAccountLink.account_id == uuid.UUID(everyday.account_id)).with_for_update())
        record = await syncing.scalar(select(BankTransaction).where(BankTransaction.id == everyday.countdown.item_id).with_for_update())
        record.observed_amount = -4610
        await syncing.flush()
        syncing_pid = await syncing.scalar(select(func.pg_backend_pid()))
        approving = asyncio.create_task(_approve(client, everyday.headers, preview))
        await _wait_until_waiting_on(syncing_pid, approving)
        await syncing.commit()
        approved = await approving

    assert approved.status_code == status.HTTP_200_OK, approved.text
    assert _outcome(approved) == ({"corrected": 1, "removed": 1, "failed": 1}, {everyday.uber.item_id, everyday.freshco.item_id})
    assert sorted(await _ledger_rows(everyday.account_id)) == [(_OCT_1, -1600), (BANK_DATE, -4210)]
    stored = await _stored_item(everyday.countdown.item_id)
    assert (stored.open_kind, stored.observed_amount) == (OpenReviewKind.CORRECTION, -4610)


async def test_approving_leaves_an_item_decided_since_the_preview_as_it_is_and_counts_it_nowhere(client):
    """Uber's current date was kept from its comparison after the preview, so it stays on 3 October and no longer waits"""
    everyday = await _everyday_waiting(client)
    preview = await _preview(client, everyday.headers)
    kept = await client.post(f"/bank-review/items/{everyday.uber.item_id}/keep-current", headers=everyday.headers)
    assert kept.status_code == status.HTTP_200_OK, kept.text

    approved = await _approve(client, everyday.headers, preview)

    assert approved.status_code == status.HTTP_200_OK, approved.text
    assert _outcome(approved) == ({"corrected": 1, "removed": 1, "failed": 0}, {everyday.countdown.item_id, everyday.freshco.item_id})
    assert sorted(await _ledger_rows(everyday.account_id)) == [(BANK_DATE, -4510), (BANK_DATE, -1600)]


async def test_approving_undoes_an_item_a_check_refuses_after_writing_and_applies_the_rest(client, monkeypatch):
    """The first correction applied is refused once written, so its transaction and balance stay as they were and it still waits

    The other correction, applied after the refusal, and the removal still go through
    """
    everyday = await _everyday_waiting(client)
    preview = await _preview(client, everyday.headers)
    write_bank_change = bulk_approval.write_bank_change
    refused: list[uuid.UUID] = []

    async def refuse_the_first_once_written(db, user, record, account):
        txn = await write_bank_change(db, user, record, account)
        if not refused:
            refused.append(record.id)
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Refused")
        return txn

    monkeypatch.setattr(bulk_approval, "write_bank_change", refuse_the_first_once_written)

    approved = await _approve(client, everyday.headers, preview)

    assert approved.status_code == status.HTTP_200_OK, approved.text
    corrections = {everyday.countdown.item_id, everyday.uber.item_id}
    assert _outcome(approved) == ({"corrected": 1, "removed": 1, "failed": 1}, (corrections - set(refused)) | {everyday.freshco.item_id})
    stored = await _stored_item(refused[0])
    assert (stored.open_kind, stored.version) == (OpenReviewKind.CORRECTION, 1)
    expected = {
        everyday.countdown.item_id: ([(_OCT_1, -1600), (BANK_DATE, -4210)], [(_OCT_1, -1600), (BANK_DATE, -5810)]),
        everyday.uber.item_id: ([(BANK_DATE, -4510), (BANK_DATE, -1600)], [(BANK_DATE, -6110)]),
    }
    rows, balances = expected[stored.id]
    assert sorted(await _ledger_rows(everyday.account_id), key=lambda row: row[1]) == sorted(rows, key=lambda row: row[1])
    assert await _balances(everyday.account_id) == balances


async def test_approving_counts_a_new_item_sent_as_still_waiting_and_changes_nothing(client):
    """A new item needs a merchant and category, so one sent at its version stays waiting, counted as failed, and nothing is saved"""
    ledger = await _ledger(client)
    item_id = await _commit_review_item(ledger.everyday_id, "TRN-NEW")
    before = await _changed_at(client, ledger.headers)

    approved = await client.post("/bank-review/bulk-approve", json={"items": [{"id": str(item_id), "version": 1}]}, headers=ledger.headers)

    assert approved.status_code == status.HTTP_200_OK, approved.text
    assert _outcome(approved) == ({"corrected": 0, "removed": 0, "failed": 1}, set())
    stored = await _stored_item(item_id)
    assert (stored.disposition, stored.transaction_id, stored.version) == (BankTransactionDisposition.AWAITING_REVIEW, None, 1)
    assert await _changed_at(client, ledger.headers) == before


async def test_approving_leaves_another_users_removal_alone(client):
    """Their transaction stays in their ledger and their removal still waits, counted nowhere"""
    everyday = await _everyday_waiting(client)
    theirs = await _commit_other_users_account()
    async with TestSession() as session:
        category = _build_category(theirs.owner_id)
        session.add(category)
        await session.flush()
        transaction = _build_ledger_transaction(theirs, category.id)
        session.add(transaction)
        await session.flush()
        record = _build_bank_transaction(theirs, transaction=transaction)
        record.open_kind = OpenReviewKind.REMOVAL
        record.removed_at = _REPORTED_AT
        session.add(record)
        await session.commit()

    approved = await client.post("/bank-review/bulk-approve", json={"items": [{"id": str(record.id), "version": 1}]}, headers=everyday.headers)

    assert approved.status_code == status.HTTP_200_OK, approved.text
    assert _outcome(approved) == ({"corrected": 0, "removed": 0, "failed": 0}, set())
    assert await _ledger_rows(theirs.id) == [(BANK_DATE, -1250)]
    assert (await _stored_item(record.id)).open_kind == OpenReviewKind.REMOVAL


async def test_approving_twice_at_once_applies_each_item_once(client):
    """Both approvals queue behind a lock on FreshCo's bank transaction, and the second finds nothing left once the first applies everything"""
    everyday = await _everyday_waiting(client)
    preview = await _preview(client, everyday.headers)

    async with asyncio.timeout(10), TestSession() as holder:
        await holder.execute(select(BankTransaction.id).where(BankTransaction.id == everyday.freshco.item_id).with_for_update())
        holder_pid = await holder.scalar(select(func.pg_backend_pid()))
        both = asyncio.gather(_approve(client, everyday.headers, preview), _approve(client, everyday.headers, preview))
        await _wait_until_waiting_on(holder_pid, both, waiters=2)
        await holder.commit()

        # Either approval may reach the items first
        nothing, applied = sorted(await both, key=lambda response: response.json()["corrected"])

    assert _outcome(applied) == (
        {"corrected": 2, "removed": 1, "failed": 0},
        {everyday.countdown.item_id, everyday.uber.item_id, everyday.freshco.item_id},
    )
    assert _outcome(nothing) == ({"corrected": 0, "removed": 0, "failed": 0}, set())
    assert await _balances(everyday.account_id) == [(_OCT_1, -1600), (BANK_DATE, -6110)]

    # Created at version 1 and written once
    assert (await _stored_item(everyday.countdown.item_id)).version == 2


async def test_approving_locks_every_ledger_transaction_before_writing_any(client):
    """A bulk edit of the ledger holds the lower of two ledger transactions and then takes the higher, as it locks them in id order

    The approval waits for the lower without having written the higher, though its correction comes
    first by bank transaction id, so the edit takes it at once rather than deadlocking
    """
    ledger = await _ledger(client)
    lower, higher = sorted([await _record(client, ledger, ledger.everyday_id, -4210) for _ in range(2)], key=uuid.UUID)
    first_item, second_item = sorted(uuid.uuid4() for _ in range(2))
    await _commit_bank_source(ledger.everyday_id, higher, _COUNTDOWN, -4210, id=first_item, **_amount_change(-4510, -4210))
    await _commit_bank_source(ledger.everyday_id, lower, _UBER, -4210, id=second_item, **_amount_change(-4310, -4210))
    preview = await _preview(client, ledger.headers)

    async with asyncio.timeout(10), TestSession() as editing:
        await editing.execute(text("SET LOCAL lock_timeout = '2s'"))
        await editing.execute(select(Transaction.id).where(Transaction.id == uuid.UUID(lower)).with_for_update())
        editing_pid = await editing.scalar(select(func.pg_backend_pid()))
        approving = asyncio.create_task(_approve(client, ledger.headers, preview))
        await _wait_until_waiting_on(editing_pid, approving)
        await editing.execute(select(Transaction.id).where(Transaction.id == uuid.UUID(higher)).with_for_update())
        await editing.commit()
        approved = await approving

    assert approved.status_code == status.HTTP_200_OK, approved.text
    assert _outcome(approved) == ({"corrected": 2, "removed": 0, "failed": 0}, {first_item, second_item})


async def test_approving_rebuilds_balances_account_by_account_in_the_order_a_rebuild_of_several_takes_them(client):
    """A rebuild of Everyday's and Savings' balances holds the account it takes first, then takes the other

    The approval waits for the first account without having rebuilt the other, though that one's
    correction comes first by bank transaction id, so the rebuild takes it at once rather than
    deadlocking
    """
    ledger = await _ledger(client)
    first_account, second_account = sort_by_snapshot_lock([uuid.UUID(ledger.everyday_id), uuid.UUID(ledger.savings_id)])
    first_item, second_item = sorted(uuid.uuid4() for _ in range(2))
    await _commit_accepted(client, ledger, str(first_account), _COUNTDOWN, -4210, id=second_item, **_amount_change(-4510, -4210))
    await _commit_accepted(client, ledger, str(second_account), "REFUND", 1000, id=first_item, **_amount_change(1500, 1000))
    preview = await _preview(client, ledger.headers)

    async with asyncio.timeout(10), TestSession() as rebuilding:
        await rebuilding.execute(text("SET LOCAL lock_timeout = '2s'"))
        await recompute_account_snapshots(rebuilding, {first_account: BANK_DATE})
        rebuilding_pid = await rebuilding.scalar(select(func.pg_backend_pid()))
        approving = asyncio.create_task(_approve(client, ledger.headers, preview))
        await _wait_until_waiting_on(rebuilding_pid, approving)
        await recompute_account_snapshots(rebuilding, {second_account: BANK_DATE})
        await rebuilding.commit()
        approved = await approving

    assert approved.status_code == status.HTTP_200_OK, approved.text
    assert _outcome(approved) == ({"corrected": 2, "removed": 0, "failed": 0}, {first_item, second_item})
    assert await _balances(first_account) == [(BANK_DATE, -4510)]
    assert await _balances(second_account) == [(BANK_DATE, 1500)]
