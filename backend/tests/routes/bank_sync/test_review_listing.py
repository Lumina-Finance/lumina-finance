"""Listing the bank items waiting for review

The review block reads this a page at a time, so an import that leaves hundreds of items never
loads at once, and its header and bulk approval read the counts by kind. Each item carries what the
review modal compares. A page continues after the last item it returned, so deciding items between
pages neither repeats nor skips one, and only the user's own personal accounts have items
"""

import uuid
from datetime import UTC, date, datetime

from sqlalchemy import delete, null

from app.models.account import Account
from app.models.bank_transaction import OBSERVATION_COLUMNS, BankTransaction, BankTransactionDisposition, OpenReviewKind
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    BANK_DESCRIPTION,
    _build_account,
    _build_bank_transaction,
    _build_category,
    _build_ledger_transaction,
    _build_user,
    _commit_review_item,
    _new_account,
    _review_page,
    _sign_up,
)
from tests.routes.support.query_helpers import _get_with_selects

_NONE_WAITING = {"new": 0, "correction": 0, "removal": 0}
_RECEIVED_AT = datetime(2026, 10, 4, 9, 30, tzinfo=UTC)


async def _everyday(client) -> tuple[dict, uuid.UUID, str]:
    """Sign up with an empty Everyday account in CAD"""
    headers, user_id = await _sign_up(client)
    return headers, user_id, await _new_account(client, headers, "Everyday")


def _bank_values(day: date, amount: int, description: str = BANK_DESCRIPTION) -> dict:
    """Return the bank values of an item whose amount the currency holds and that has no merchant or category hint"""
    return {
        "date": day.isoformat(),
        "amount": amount,
        "raw_amount": None,
        "description": description,
        "merchant_name": None,
        "category_hint": None,
    }


async def test_review_list_reads_100_new_items_in_two_pages_of_50_newest_first(client):
    """An import left 100 items over three days, and two leave after the first page, which the second neither repeats nor skips past"""
    headers, _, account_id = await _everyday(client)
    days = [date(2026, 10, 3)] * 30 + [date(2026, 10, 2)] * 40 + [date(2026, 10, 1)] * 30
    async with TestSession() as session:
        account = await session.get_one(Account, uuid.UUID(account_id))
        records = [_build_bank_transaction(account, f"TRN-{index}") for index in range(len(days))]
        for record, day in zip(records, days, strict=True):
            record.observed_date = day
        session.add_all(records)
        await session.commit()
    newest_first = [str(record.id) for record in sorted(records, key=lambda record: (record.observed_date, record.id), reverse=True)]

    first = await _review_page(client, headers)
    async with TestSession() as session:
        # Two items from the first page leave the inbox, but not the last one it returned
        await session.execute(delete(BankTransaction).where(BankTransaction.id.in_([uuid.UUID(newest_first[0]), uuid.UUID(newest_first[48])])))
        await session.commit()
    second = await _review_page(client, headers, cursor=first["next_cursor"])

    assert [item["id"] for item in first["items"]] == newest_first[:50]
    assert first["counts"] == {"new": 100, "correction": 0, "removal": 0}
    assert first["next_cursor"] is not None
    assert [item["id"] for item in second["items"]] == newest_first[50:]
    assert second["counts"] == {"new": 98, "correction": 0, "removal": 0}
    assert second["next_cursor"] is None


async def test_review_list_refuses_a_cursor_no_page_returned(client):
    """A cursor without a bank date and item id reads nothing"""
    headers, _, account_id = await _everyday(client)
    await _commit_review_item(account_id)

    refused = await client.get("/bank-review/items", params={"cursor": "page-2"}, headers=headers)

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == "Unknown review list cursor"


async def test_review_list_shows_each_kind_with_the_values_its_review_compares(client):
    """A new item, a correction to an edited amount and the description, and a removal wait, but settled and dismissed ones don't"""
    headers, user_id, account_id = await _everyday(client)
    async with TestSession() as session:
        account = await session.get_one(Account, uuid.UUID(account_id))
        category = _build_category(user_id)
        session.add(category)
        await session.flush()
        corrected = _build_ledger_transaction(account, category.id, amount=-400)
        corrected.dt = date(2026, 10, 2)
        removed = _build_ledger_transaction(account, category.id)
        removed.dt = date(2026, 10, 1)
        settled = _build_ledger_transaction(account, category.id)
        session.add_all([corrected, removed, settled])
        await session.flush()

        new = _build_bank_transaction(account, "TRN-NEW")

        # Added as $4.00 though the bank said $4.50, and the bank now says $4.75 under a new description
        correction = _build_bank_transaction(account, "TRN-CORRECTED", amount=-475, transaction=corrected)
        correction.observed_date = correction.aligned_date = date(2026, 10, 2)
        correction.aligned_amount = -450
        correction.description = "BLUE BOTTLE COFFEE"
        correction.open_kind = OpenReviewKind.CORRECTION
        correction.proposed_fields = {"amount": -450, "description": "SQ *BLUE BOTTLE"}

        removal = _build_bank_transaction(account, "TRN-REMOVED", transaction=removed)
        removal.observed_date = removal.aligned_date = date(2026, 10, 1)
        removal.open_kind = OpenReviewKind.REMOVAL

        dismissed = _build_bank_transaction(account, "TRN-DISMISSED")
        dismissed.disposition = BankTransactionDisposition.DISMISSED
        for column in OBSERVATION_COLUMNS:
            setattr(dismissed, column, null())
        records = [new, correction, removal, dismissed, _build_bank_transaction(account, "TRN-SETTLED", transaction=settled)]
        for record in records:
            record.received_at = _RECEIVED_AT
        session.add_all(records)
        await session.commit()

    page = await _review_page(client, headers)

    assert [datetime.fromisoformat(listed.pop("received_at")) for listed in page["items"]] == [_RECEIVED_AT] * 3
    item = {"account_id": account_id, "provider": "simplefin", "provider_name": "SimpleFIN", "version": 1}
    assert page == {
        "items": [
            {
                **item,
                "id": str(new.id),
                "kind": "new",
                "external_transaction_id": "TRN-NEW",
                "bank": _bank_values(date(2026, 10, 3), -1250),
                "transaction_id": None,
                "current": None,
                "changed_fields": [],
                "protected_fields": [],
                "needs_merchant_or_category": True,
            },
            {
                **item,
                "id": str(correction.id),
                "kind": "correction",
                "external_transaction_id": "TRN-CORRECTED",
                "bank": _bank_values(date(2026, 10, 2), -475, "BLUE BOTTLE COFFEE"),
                "transaction_id": str(corrected.id),
                "current": _bank_values(date(2026, 10, 2), -400, "SQ *BLUE BOTTLE"),
                "changed_fields": ["amount", "description"],
                "protected_fields": ["amount"],
                "needs_merchant_or_category": False,
            },
            {
                **item,
                "id": str(removal.id),
                "kind": "removal",
                "external_transaction_id": "TRN-REMOVED",
                "bank": _bank_values(date(2026, 10, 1), -1250),
                "transaction_id": str(removed.id),
                "current": _bank_values(date(2026, 10, 1), -1250),
                "changed_fields": [],
                "protected_fields": [],
                "needs_merchant_or_category": False,
            },
        ],
        "counts": {"new": 1, "correction": 1, "removal": 1},
        "next_cursor": None,
    }


async def test_review_list_for_one_account_leaves_out_the_others(client):
    """Everyday's two items list without Savings' one, which every account's list includes"""
    headers, _, everyday_id = await _everyday(client)
    savings_id = await _new_account(client, headers, "Savings")
    everyday_items = [await _commit_review_item(everyday_id, "TRN-1"), await _commit_review_item(everyday_id, "TRN-2")]
    savings_item = await _commit_review_item(savings_id, "TRN-1")

    everyday = await _review_page(client, headers, account_id=everyday_id)
    every_account = await _review_page(client, headers)

    assert sorted(item["id"] for item in everyday["items"]) == sorted(str(item_id) for item_id in everyday_items)
    assert everyday["counts"] == {"new": 2, "correction": 0, "removal": 0}
    assert sorted(item["id"] for item in every_account["items"]) == sorted(str(item_id) for item_id in [*everyday_items, savings_item])
    assert every_account["counts"] == {"new": 3, "correction": 0, "removal": 0}


async def test_review_list_never_shows_another_users_items(client):
    """Another user's waiting item is in neither list, and their account reads as not found"""
    headers, _, _ = await _everyday(client)
    async with TestSession() as session:
        other = _build_user("other@example.com")
        session.add(other)
        await session.flush()
        theirs = _build_account(other.id, name="Theirs")
        session.add(theirs)
        await session.commit()
    await _commit_review_item(theirs.id)

    every_account = await _review_page(client, headers)
    their_account = await client.get("/bank-review/items", params={"account_id": str(theirs.id)}, headers=headers)

    assert every_account == {"items": [], "counts": _NONE_WAITING, "next_cursor": None}
    assert their_account.status_code == 404, their_account.text
    assert their_account.json()["detail"] == "Account not found"


async def test_review_list_leaves_out_group_accounts_even_for_their_admin(client):
    """A group account's list is refused, and an item recorded on it as the admin's own isn't in theirs"""
    headers, user_id, _ = await _everyday(client)
    group = await client.post("/groups", json={"name": "Smith Family"}, headers=headers)
    assert group.status_code == 201, group.text
    joint_id = await _new_account(client, headers, "Joint", group_id=group.json()["id"])
    await _commit_review_item(joint_id, owner_id=user_id)

    refused = await client.get("/bank-review/items", params={"account_id": joint_id}, headers=headers)
    every_account = await _review_page(client, headers)

    assert refused.status_code == 403, refused.text
    assert refused.json()["detail"] == "Accounts shared with a group can't be linked to a bank yet"
    assert every_account == {"items": [], "counts": _NONE_WAITING, "next_cursor": None}


async def test_review_list_reads_a_page_of_50_in_as_many_queries_as_a_page_of_one(client):
    """Fifty items of every kind, the corrections and removals with their ledger rows, run the same SELECTs as one new item"""
    headers, user_id, account_id = await _everyday(client)
    await _commit_review_item(account_id, "TRN-0")
    one_page, one_selects = await _get_with_selects(client, "/bank-review/items", headers)
    async with TestSession() as session:
        account = await session.get_one(Account, uuid.UUID(account_id))
        category = _build_category(user_id)
        session.add(category)
        await session.flush()
        ledger = [_build_ledger_transaction(account, category.id) for _ in range(30)]
        session.add_all(ledger)
        await session.flush()
        accepted = [_build_bank_transaction(account, f"TRN-ACCEPTED-{index}", transaction=txn) for index, txn in enumerate(ledger)]
        for index, record in enumerate(accepted):
            record.open_kind = OpenReviewKind.CORRECTION if index % 2 else OpenReviewKind.REMOVAL
            record.proposed_fields = {"amount": -1000} if index % 2 else None
        session.add_all([*accepted, *(_build_bank_transaction(account, f"TRN-{index}") for index in range(1, 20))])
        await session.commit()

    full_page, full_selects = await _get_with_selects(client, "/bank-review/items", headers)

    assert len(one_page["items"]) == 1
    assert len(full_page["items"]) == 50
    assert full_page["counts"] == {"new": 20, "correction": 15, "removal": 15}

    # Exactly a page's worth leaves no page after it
    assert full_page["next_cursor"] is None
    assert len(full_selects) == len(one_selects)
