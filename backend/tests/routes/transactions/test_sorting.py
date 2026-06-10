import uuid
from datetime import UTC, datetime

from sqlalchemy import update

from app.models.transaction import Transaction
from tests.conftest import TestSession
from tests.routes.support import _create_user, _get_auth_header
from tests.routes.transactions._helpers import (
    _create_category,
    _create_merchant,
    _create_tag,
    _create_transaction,
    _setup_user_with_deps,
)

# --- Sorting ---


async def test_list_transactions_default_sort_dt_desc(client):
    """Transactions default to most recent first."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    await _create_transaction(client, headers, account_id, category_id, dt="2026-01-01")
    await _create_transaction(client, headers, account_id, category_id, dt="2026-03-01")
    await _create_transaction(client, headers, account_id, category_id, dt="2026-02-01")

    resp = await client.get("/transactions", headers=headers)

    dates = [t["dt"] for t in resp.json()]
    assert dates == sorted(dates, reverse=True)


async def test_list_transactions_default_sort_uses_created_at_within_day(client):
    """Same-day transactions are sorted by creation time, newest first."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    older = await _create_transaction(client, headers, account_id, category_id, dt="2026-03-15", amount=-1000)
    newer = await _create_transaction(client, headers, account_id, category_id, dt="2026-03-15", amount=-2000)
    next_day = await _create_transaction(client, headers, account_id, category_id, dt="2026-03-16", amount=-3000)

    async with TestSession() as session:
        await session.execute(
            update(Transaction)
            .where(Transaction.id == uuid.UUID(older.json()["id"]))
            .values(created_at=datetime(2026, 1, 1, 10, tzinfo=UTC)),
        )
        await session.execute(
            update(Transaction)
            .where(Transaction.id == uuid.UUID(newer.json()["id"]))
            .values(created_at=datetime(2026, 1, 1, 11, tzinfo=UTC)),
        )
        await session.execute(
            update(Transaction)
            .where(Transaction.id == uuid.UUID(next_day.json()["id"]))
            .values(created_at=datetime(2026, 1, 1, 9, tzinfo=UTC)),
        )
        await session.commit()

    resp = await client.get("/transactions", headers=headers)

    ids = [t["id"] for t in resp.json()]
    assert ids == [next_day.json()["id"], newer.json()["id"], older.json()["id"]]


async def test_list_transactions_default_sort_breaks_import_timestamp_ties(client):
    """Imported same-timestamp rows sort by amount, category, merchant, notes, then tags."""
    headers, account_id, _category_id = await _setup_user_with_deps(client)
    alpha_category = (await _create_category(client, headers, name="Alpha")).json()["id"]
    beta_category = (await _create_category(client, headers, name="Beta")).json()["id"]
    zeta_category = (await _create_category(client, headers, name="Zeta")).json()["id"]
    alpha_merchant = (await _create_merchant(client, headers, name="Alpha Merchant")).json()["id"]
    zed_merchant = (await _create_merchant(client, headers, name="Zed Merchant")).json()["id"]
    alpha_tag = (await _create_tag(client, headers, name="alpha-tag")).json()["id"]
    zed_tag = (await _create_tag(client, headers, name="zed-tag")).json()["id"]

    tag_zed = await _create_transaction(
        client, headers, account_id, beta_category,
        amount=-5000, merchant_id=zed_merchant, notes="z", tag_ids=[zed_tag],
    )
    tag_alpha = await _create_transaction(
        client, headers, account_id, beta_category,
        amount=-5000, merchant_id=zed_merchant, notes="z", tag_ids=[alpha_tag],
    )
    notes_first = await _create_transaction(
        client, headers, account_id, beta_category,
        amount=-5000, merchant_id=zed_merchant, notes="a", tag_ids=[zed_tag],
    )
    merchant_first = await _create_transaction(
        client, headers, account_id, beta_category,
        amount=-5000, merchant_id=alpha_merchant, notes="z", tag_ids=[zed_tag],
    )
    category_first = await _create_transaction(
        client, headers, account_id, alpha_category,
        amount=-5000, merchant_id=zed_merchant, notes="z", tag_ids=[zed_tag],
    )
    amount_first = await _create_transaction(
        client, headers, account_id, zeta_category,
        amount=-7000, merchant_id=zed_merchant, notes="z", tag_ids=[zed_tag],
    )
    transaction_ids = [
        tag_zed.json()["id"],
        tag_alpha.json()["id"],
        notes_first.json()["id"],
        merchant_first.json()["id"],
        category_first.json()["id"],
        amount_first.json()["id"],
    ]

    async with TestSession() as session:
        await session.execute(
            update(Transaction)
            .where(Transaction.id.in_([uuid.UUID(transaction_id) for transaction_id in transaction_ids]))
            .values(created_at=datetime(2026, 1, 1, 10, tzinfo=UTC)),
        )
        await session.commit()

    resp = await client.get("/transactions", headers=headers)

    ids = [t["id"] for t in resp.json()[:6]]
    assert ids == [
        amount_first.json()["id"],
        category_first.json()["id"],
        merchant_first.json()["id"],
        notes_first.json()["id"],
        tag_alpha.json()["id"],
        tag_zed.json()["id"],
    ]


async def test_list_transactions_sort_by_amount_asc(client):
    """Sorting by amount ascending returns smallest first."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    await _create_transaction(client, headers, account_id, category_id, amount=-5000)
    await _create_transaction(client, headers, account_id, category_id, amount=-1000)
    await _create_transaction(client, headers, account_id, category_id, amount=-3000)

    resp = await client.get("/transactions?sort_by=amount&sort_order=asc", headers=headers)

    amounts = [t["amount"] for t in resp.json()]
    assert amounts == [-5000, -3000, -1000]


async def test_list_transactions_sort_by_created_at(client):
    """Sorting by created_at returns transactions in insertion order."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    resp1 = await _create_transaction(client, headers, account_id, category_id, amount=-1000, dt="2026-03-01")
    resp2 = await _create_transaction(client, headers, account_id, category_id, amount=-2000, dt="2026-01-01")

    resp = await client.get("/transactions?sort_by=created_at&sort_order=asc", headers=headers)

    ids = [t["id"] for t in resp.json()]
    assert ids == [resp1.json()["id"], resp2.json()["id"]]


async def test_list_transactions_sort_by_updated_at(client):
    """Sorting by updated_at reflects edit order."""
    import asyncio

    headers, account_id, category_id = await _setup_user_with_deps(client)

    resp1 = await _create_transaction(client, headers, account_id, category_id, amount=-1000)
    await _create_transaction(client, headers, account_id, category_id, amount=-2000)

    await asyncio.sleep(0.01)
    await client.patch(f"/transactions/{resp1.json()['id']}", json={"notes": "edited"}, headers=headers)

    resp = await client.get("/transactions?sort_by=updated_at&sort_order=desc", headers=headers)

    ids = [t["id"] for t in resp.json()]
    assert ids[0] == resp1.json()["id"]


async def test_list_transactions_invalid_sort_by_returns_422(client):
    """Invalid sort_by field returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/transactions?sort_by=invalid", headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Invalid sort field"


async def test_list_transactions_invalid_sort_order_returns_422(client):
    """Invalid sort_order returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/transactions?sort_order=sideways", headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Sort order must be 'asc' or 'desc'"
