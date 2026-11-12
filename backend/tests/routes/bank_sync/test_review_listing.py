"""Listing the bank items waiting for review

The review block reads this a page at a time, so an import that leaves hundreds of items never
loads at once, and its header reads the counts by kind. Each item carries what the
review modal compares. A page continues after the last item it returned, so deciding items between
pages neither repeats nor skips one, and only the user's own personal accounts have items
"""

import uuid
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import delete

from app.models.account import Account
from app.models.bank_transaction import OBSERVATION_COLUMNS, BankTransaction, BankTransactionDisposition, OpenReviewKind
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    BANK_DESCRIPTION,
    EMPTY_REVIEW_PAGE,
    _build_bank_transaction,
    _build_category,
    _build_ledger_transaction,
    _commit_other_users_account,
    _commit_review_item,
    _new_account,
    _new_group_account,
    _review_page,
    _sign_up,
)
from tests.routes.support.query_helpers import _get_with_selects

_RECEIVED_AT = datetime(2026, 10, 4, 9, 30, tzinfo=UTC)


async def _everyday(client) -> tuple[dict, uuid.UUID, str]:
    """Sign up with an empty Everyday account in CAD"""
    headers, user_id = await _sign_up(client)
    return headers, user_id, await _new_account(client, headers, "Everyday")


def _bank_values(day: date, amount: int | None, description: str = BANK_DESCRIPTION, **values) -> dict:
    """Return the bank values of an item, with an amount the currency holds unless given another"""
    return {
        "date": day.isoformat(),
        "amount": amount,
        "raw_amount": None,
        "description": description,
        **values,
    }


async def _commit_open_item(
    account: Account,
    category_id: uuid.UUID,
    kind: OpenReviewKind,
    *,
    ledger: tuple[date, int],
    aligned: tuple[date, int],
    **values,
) -> uuid.UUID:
    """Commit a ledger row and the accepted bank transaction it came from, with a correction or removal open and any of its values replaced

    Returns:
        The item's id
    """
    async with TestSession() as session:
        txn = _build_ledger_transaction(account, category_id, amount=ledger[1])
        txn.dt = ledger[0]
        session.add(txn)
        await session.flush()
        record = _build_bank_transaction(account, f"TRN-{txn.id}", transaction=txn)
        record.aligned_date, record.aligned_amount = aligned
        record.open_kind = kind
        for field, value in values.items():
            setattr(record, field, value)
        session.add(record)
        await session.commit()
    return record.id


async def test_review_list_reads_100_new_items_in_two_pages_of_50_newest_first(client):
    """An import left 100 items over three days, and two leave after the first page. The second neither repeats nor skips past it"""
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


async def test_review_list_reads_as_few_as_one_item_at_a_time(client):
    """Asked for one item, the newest of two comes back with a cursor to the other"""
    headers, _, account_id = await _everyday(client)
    older = await _commit_review_item(account_id, "TRN-1", observed_date=date(2026, 10, 2))
    newer = await _commit_review_item(account_id, "TRN-2")

    first = await _review_page(client, headers, limit=1)
    second = await _review_page(client, headers, limit=1, cursor=first["next_cursor"])

    assert [item["id"] for item in first["items"]] == [str(newer)]
    assert first["counts"] == {"new": 2, "correction": 0, "removal": 0}
    assert [item["id"] for item in second["items"]] == [str(older)]
    assert second["next_cursor"] is None


@pytest.mark.parametrize("limit", [0, 51])
async def test_review_list_refuses_a_page_of_none_or_more_than_50(client, limit):
    """A page holds from one item to 50"""
    headers, _, _ = await _everyday(client)

    refused = await client.get("/bank-review/items", params={"limit": limit}, headers=headers)

    assert refused.status_code == 422, refused.text
    assert [error["loc"] for error in refused.json()["detail"]] == [["query", "limit"]]


async def test_review_list_refuses_a_cursor_no_page_returned(client):
    """A cursor without a bank date and item id reads nothing"""
    headers, _, account_id = await _everyday(client)
    await _commit_review_item(account_id)

    refused = await client.get("/bank-review/items", params={"cursor": "page-2"}, headers=headers)

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == "Unknown review list cursor"


async def test_review_list_shows_each_kind_with_the_values_its_review_compares(client):
    """New items, one in USD that cents can't hold, a date-moving correction and a removal wait, but settled and dismissed ones don't"""
    headers, user_id, account_id = await _everyday(client)
    usd_id = await _new_account(client, headers, "US Chequing", currency="USD")
    async with TestSession() as session:
        account = await session.get_one(Account, uuid.UUID(account_id))
        category = _build_category(user_id)
        session.add(category)
        await session.flush()
        corrected = _build_ledger_transaction(account, category.id, amount=-400)
        corrected.dt = date(2026, 10, 1)
        removed = _build_ledger_transaction(account, category.id)
        removed.dt = date(2026, 10, 1)
        settled = _build_ledger_transaction(account, category.id)
        session.add_all([corrected, removed, settled])
        await session.flush()

        new = _build_bank_transaction(account, "TRN-NEW")

        usd = _build_bank_transaction(await session.get_one(Account, uuid.UUID(usd_id)), "TRN-USD")
        usd.observed_date = date(2026, 10, 4)
        usd.observed_amount = None
        usd.raw_amount = "-12.345"
        usd.description = "AMZN MKTP US"

        # Added on 1 October as $4.00 though the bank said $4.50, and the bank now says $4.75 on 2
        # October under a new description
        correction = _build_bank_transaction(account, "TRN-CORRECTED", amount=-475, transaction=corrected)
        correction.observed_date = date(2026, 10, 2)
        correction.aligned_date = date(2026, 10, 1)
        correction.aligned_amount = -450
        correction.description = "BLUE BOTTLE COFFEE"
        correction.open_kind = OpenReviewKind.CORRECTION
        correction.previous_values = {"date": "2026-10-01", "amount": -450, "description": "SQ *BLUE BOTTLE"}

        removal = _build_bank_transaction(account, "TRN-REMOVED", transaction=removed)
        removal.observed_date = removal.aligned_date = date(2026, 10, 1)
        removal.open_kind = OpenReviewKind.REMOVAL
        removal.removed_at = _RECEIVED_AT

        dismissed = _build_bank_transaction(account, "TRN-DISMISSED")
        dismissed.disposition = BankTransactionDisposition.DISMISSED
        for column in OBSERVATION_COLUMNS:
            setattr(dismissed, column, None)
        records = [usd, new, correction, removal, dismissed, _build_bank_transaction(account, "TRN-SETTLED", transaction=settled)]
        for record in records:
            record.received_at = _RECEIVED_AT
        session.add_all(records)
        await session.commit()

    page = await _review_page(client, headers)

    assert [datetime.fromisoformat(listed.pop("received_at")) for listed in page["items"]] == [_RECEIVED_AT] * 4
    item = {"provider": "fake", "provider_name": "Fake Bank", "version": 1}
    new_item = {"transaction_id": None, "current": None, "changed_fields": [], "protected_fields": []}
    assert page == {
        "items": [
            {
                **item,
                **new_item,
                "id": str(usd.id),
                "kind": "new",
                "account_id": usd_id,
                "bank": _bank_values(date(2026, 10, 4), None, "AMZN MKTP US", raw_amount="-12.345"),
            },
            {
                **item,
                **new_item,
                "id": str(new.id),
                "kind": "new",
                "account_id": account_id,
                "bank": _bank_values(date(2026, 10, 3), -1250),
            },
            {
                **item,
                "id": str(correction.id),
                "kind": "correction",
                "account_id": account_id,
                "bank": _bank_values(date(2026, 10, 2), -475, "BLUE BOTTLE COFFEE"),
                "transaction_id": str(corrected.id),
                "current": _bank_values(date(2026, 10, 1), -400, "SQ *BLUE BOTTLE"),
                "changed_fields": ["date", "amount", "description"],
                "protected_fields": ["amount"],
            },
            {
                **item,
                "id": str(removal.id),
                "kind": "removal",
                "account_id": account_id,
                "bank": _bank_values(date(2026, 10, 1), -1250),
                "transaction_id": str(removed.id),
                "current": _bank_values(date(2026, 10, 1), -1250),
                "changed_fields": [],
                "protected_fields": [],
            },
        ],
        "counts": {"new": 2, "correction": 1, "removal": 1},
        "next_cursor": None,
    }


async def test_review_list_shows_the_description_the_user_kept_as_the_current_one(client):
    """The user kept SQ *BLUE BOTTLE over the bank's BLUE BOTTLE COFFEE, and a correction to BLUE BOTTLE CAFE now waits

    The comparison's current description is the one kept, not the bank's from before the
    correction. The user declined it
    """
    headers, user_id, account_id = await _everyday(client)
    async with TestSession() as session:
        account = await session.get_one(Account, uuid.UUID(account_id))
        category = _build_category(user_id)
        session.add(category)
        await session.commit()
    await _commit_open_item(
        account,
        category.id,
        OpenReviewKind.CORRECTION,
        ledger=(date(2026, 10, 3), -1250),
        aligned=(date(2026, 10, 3), -1250),
        description="BLUE BOTTLE CAFE",
        previous_values={"description": "BLUE BOTTLE COFFEE"},
        kept_description="SQ *BLUE BOTTLE",
    )

    [item] = (await _review_page(client, headers))["items"]

    assert (item["changed_fields"], item["current"]["description"], item["bank"]["description"]) == (
        ["description"],
        "SQ *BLUE BOTTLE",
        "BLUE BOTTLE CAFE",
    )


async def test_review_list_protects_only_the_edited_fields_a_correction_changes(client):
    """An edited amount isn't protected from a new description or a removal, and an edited date is from a new date

    A removal changes no field, even one taking the place of a correction to the edited amount
    """
    headers, user_id, account_id = await _everyday(client)
    october_1, october_2, october_3 = date(2026, 10, 1), date(2026, 10, 2), date(2026, 10, 3)
    async with TestSession() as session:
        account = await session.get_one(Account, uuid.UUID(account_id))
        category = _build_category(user_id)
        session.add(category)
        await session.commit()

    # The user entered $4.00 for the bank's $4.50, and the bank resends only a new description
    new_description = await _commit_open_item(
        account,
        category.id,
        OpenReviewKind.CORRECTION,
        ledger=(october_3, -400),
        aligned=(october_3, -450),
        observed_amount=-450,
        description="BLUE BOTTLE COFFEE",
        previous_values={"description": "SQ *BLUE BOTTLE"},
    )
    # The same edit, and the bank removes the transaction while its change to $4.75 waits. The removal
    # takes the place of that change
    removal = await _commit_open_item(
        account,
        category.id,
        OpenReviewKind.REMOVAL,
        ledger=(october_2, -400),
        aligned=(october_2, -450),
        observed_amount=-475,
        observed_date=october_2,
        previous_values={"amount": -450},
        removed_at=_RECEIVED_AT,
    )
    # The user moved the bank's 1 October to 2 October, and the bank now says 3 October
    new_date = await _commit_open_item(
        account,
        category.id,
        OpenReviewKind.CORRECTION,
        ledger=(october_2, -1250),
        aligned=(october_1, -1250),
        observed_date=october_3,
        previous_values={"date": "2026-10-01"},
    )

    page = await _review_page(client, headers)

    assert sorted((item["id"], item["kind"], item["changed_fields"], item["protected_fields"]) for item in page["items"]) == sorted(
        [
            (str(new_description), "correction", ["description"], []),
            (str(removal), "removal", [], []),
            (str(new_date), "correction", ["date"], ["date"]),
        ]
    )


async def test_review_list_for_one_account_leaves_out_the_others(client):
    """Everyday's two items list without Savings' one. Every account's list includes it"""
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


async def test_review_list_for_several_accounts_counts_only_theirs(client):
    """A list filtered to Everyday and Savings shows and counts their items without Travel's"""
    headers, _, everyday_id = await _everyday(client)
    savings_id = await _new_account(client, headers, "Savings")
    travel_id = await _new_account(client, headers, "Travel")
    listed = [await _commit_review_item(everyday_id, "TRN-1"), await _commit_review_item(savings_id, "TRN-1")]
    await _commit_review_item(travel_id, "TRN-1")

    page = await _review_page(client, headers, account_id=[everyday_id, savings_id])

    assert sorted(item["id"] for item in page["items"]) == sorted(str(item_id) for item_id in listed)
    assert page["counts"] == {"new": 2, "correction": 0, "removal": 0}


@pytest.mark.parametrize(
    ("second", "status_code", "detail"),
    [
        ("group", 403, "Bank items aren't listed for accounts shared with a group"),
        ("theirs", 404, "Account not found"),
    ],
)
async def test_review_list_refuses_several_accounts_when_any_isnt_the_users_own(client, second, status_code, detail):
    """Everyday listed with the Joint group account is refused, and with another user's account is not found"""
    headers, _, everyday_id = await _everyday(client)
    second_id = await _new_group_account(client, headers) if second == "group" else str((await _commit_other_users_account()).id)

    response = await client.get("/bank-review/items", params={"account_id": [everyday_id, second_id]}, headers=headers)

    assert response.status_code == status_code, response.text
    assert response.json()["detail"] == detail


async def test_review_list_checks_three_accounts_in_as_many_queries_as_one(client):
    """Filtered to Everyday, Savings and Travel, the list reads in as many queries as filtered to Everyday alone"""
    headers, _, everyday_id = await _everyday(client)
    savings_id = await _new_account(client, headers, "Savings")
    travel_id = await _new_account(client, headers, "Travel")

    _, one_selects = await _get_with_selects(client, "/bank-review/items", headers, account_id=[everyday_id])
    _, three_selects = await _get_with_selects(client, "/bank-review/items", headers, account_id=[everyday_id, savings_id, travel_id])

    assert len(three_selects) == len(one_selects)


async def test_review_list_never_shows_another_users_items(client):
    """Another user's waiting item is in neither list, and their account reads as not found"""
    headers, _, _ = await _everyday(client)
    theirs = await _commit_other_users_account()
    await _commit_review_item(theirs.id)

    every_account = await _review_page(client, headers)
    their_account = await client.get("/bank-review/items", params={"account_id": str(theirs.id)}, headers=headers)

    assert every_account == EMPTY_REVIEW_PAGE
    assert their_account.status_code == 404, their_account.text
    assert their_account.json()["detail"] == "Account not found"


async def test_review_list_leaves_out_group_accounts_even_for_their_admin(client):
    """A group account's list is refused, and an item recorded on it as the admin's own isn't in theirs"""
    headers, user_id, _ = await _everyday(client)
    joint_id = await _new_group_account(client, headers)
    await _commit_review_item(joint_id, owner_id=user_id)

    refused = await client.get("/bank-review/items", params={"account_id": joint_id}, headers=headers)
    every_account = await _review_page(client, headers)

    assert refused.status_code == 403, refused.text
    assert refused.json()["detail"] == "Bank items aren't listed for accounts shared with a group"
    assert every_account == EMPTY_REVIEW_PAGE


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
            record.previous_values = {"amount": -1000} if index % 2 else None
            record.removed_at = None if index % 2 else _RECEIVED_AT
        session.add_all([*accepted, *(_build_bank_transaction(account, f"TRN-{index}") for index in range(1, 20))])
        await session.commit()

    full_page, full_selects = await _get_with_selects(client, "/bank-review/items", headers)

    assert len(one_page["items"]) == 1
    assert len(full_page["items"]) == 50
    assert full_page["counts"] == {"new": 20, "correction": 15, "removal": 15}

    # Exactly a page's worth leaves no page after it
    assert full_page["next_cursor"] is None
    assert len(full_selects) == len(one_selects)
