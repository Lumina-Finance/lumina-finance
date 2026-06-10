

from tests.routes.support import _create_user, _get_auth_header
from tests.routes.transactions._helpers import (
    _create_tag,
    _create_transaction,
    _setup_user_with_deps,
)

# --- Pagination ---


async def test_list_transactions_pagination_limit(client):
    """Limit controls the number of returned transactions."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    for i in range(5):
        await _create_transaction(
            client, headers, account_id, category_id,
            amount=-(i + 1) * 1000, dt=f"2026-03-{i + 1:02d}",
        )

    # Default sort is dt desc, so we expect the 3 most recent (Mar 5, 4, 3)
    resp = await client.get("/transactions?limit=3", headers=headers)
    data = resp.json()
    assert len(data) == 3
    amounts = [t["amount"] for t in data]
    assert amounts == [-5000, -4000, -3000]


async def test_list_transactions_pagination_offset(client):
    """Offset skips the first N transactions."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    for i in range(5):
        await _create_transaction(
            client, headers, account_id, category_id,
            amount=-(i + 1) * 1000, dt=f"2026-03-{i + 1:02d}",
        )

    # Default sort is dt desc: [Mar 5, 4, 3, 2, 1]. Offset 3 skips first 3, leaving Mar 2 and 1.
    resp = await client.get("/transactions?limit=3&offset=3", headers=headers)
    data = resp.json()
    assert len(data) == 2
    amounts = [t["amount"] for t in data]
    assert amounts == [-2000, -1000]


async def test_list_transactions_limit_zero_returns_422(client):
    """limit=0 is below the minimum and returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/transactions?limit=0", headers=headers)
    assert resp.status_code == 422


async def test_list_transactions_limit_over_max_returns_422(client):
    """limit=51 exceeds the maximum and returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/transactions?limit=51", headers=headers)
    assert resp.status_code == 422


async def test_list_transactions_includes_tag_ids(client):
    """List endpoint returns correct tag IDs and summaries for each transaction."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    tag_resp = await _create_tag(client, headers, name="listed-tag")
    tag_id = tag_resp.json()["id"]

    await _create_transaction(client, headers, account_id, category_id, tag_ids=[tag_id])
    await _create_transaction(client, headers, account_id, category_id)

    resp = await client.get("/transactions", headers=headers)

    tagged = [t for t in resp.json() if t["tag_ids"]]
    untagged = [t for t in resp.json() if not t["tag_ids"]]
    assert len(tagged) == 1
    assert tagged[0]["tag_ids"] == [tag_id]
    assert tagged[0]["tags"] == [{"id": tag_id, "group_id": None, "name": "listed-tag"}]
    assert len(untagged) == 1
    assert untagged[0]["tags"] == []
