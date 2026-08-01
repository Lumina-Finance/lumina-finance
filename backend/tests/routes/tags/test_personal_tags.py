from tests.routes.support import _create_account, _create_user, _get_auth_header, _get_system_merchant_id
from tests.routes.tags._helpers import (
    NONEXISTENT_ID,
    TAG_PAYLOAD,
    _create_second_user,
    _create_tag,
)

# --- GET /tags ---


async def test_list_tags_returns_empty_list(client):
    """User with no tags gets an empty list."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/tags", headers=headers)

    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_tags_returns_user_tags(client):
    """User sees their own tags and not another user's."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await _create_tag(client, headers, name="vacation")
    await _create_tag(client, headers, name="reimbursable")

    other_headers = _get_auth_header(await _create_second_user(client))
    await _create_tag(client, other_headers, name="other-tag")

    resp = await client.get("/tags", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    names = {t["name"] for t in data}
    assert names == {"vacation", "reimbursable"}


async def test_list_tags_supports_search(client):
    """Q filters the user's tags by case-insensitive partial name."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await _create_tag(client, headers, name="Vacation")
    await _create_tag(client, headers, name="reimbursable")

    other_headers = _get_auth_header(await _create_second_user(client))
    await _create_tag(client, other_headers, name="reimbursable")

    resp = await client.get("/tags?q=IMB", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert [tag["name"] for tag in data] == ["reimbursable"]


async def test_list_tags_supports_limit_and_offset(client):
    """Limit and offset return deterministic name-sorted pages."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    for name in ["charlie", "alpha", "bravo"]:
        await _create_tag(client, headers, name=name)

    first_page = await client.get("/tags?limit=2", headers=headers)
    second_page = await client.get("/tags?limit=2&offset=2", headers=headers)

    assert first_page.status_code == 200
    assert second_page.status_code == 200
    assert [tag["name"] for tag in first_page.json()] == ["alpha", "bravo"]
    assert [tag["name"] for tag in second_page.json()] == ["charlie"]


async def test_list_tags_rejects_invalid_pagination_params(client):
    """Invalid limit and offset query params return 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    for url in ["/tags?limit=0", "/tags?limit=51", "/tags?offset=-1"]:
        resp = await client.get(url, headers=headers)
        assert resp.status_code == 422


async def test_list_tags_without_auth_returns_401(client):
    """GET /tags without an Authorization header returns 401."""
    resp = await client.get("/tags")
    assert resp.status_code == 401


# --- GET /tags/{tag_id} ---


async def test_get_tag_returns_tag(client):
    """Valid tag ID returns the tag with all fields."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    create_resp = await _create_tag(client, headers)
    tag_id = create_resp.json()["id"]

    resp = await client.get(f"/tags/{tag_id}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "vacation"
    assert data["id"] is not None
    assert data["created_at"] is not None


async def test_get_tag_not_found_returns_404(client):
    """Non-existent tag ID returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(f"/tags/{NONEXISTENT_ID}", headers=headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Tag not found"


async def test_get_tag_other_user_returns_404(client):
    """Accessing another user's tag returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_tag(client, headers)
    tag_id = create_resp.json()["id"]

    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await client.get(f"/tags/{tag_id}", headers=other_headers)

    assert resp.status_code == 404


async def test_get_tag_without_auth_returns_401(client):
    """GET /tags/{id} without an Authorization header returns 401."""
    resp = await client.get(f"/tags/{NONEXISTENT_ID}")
    assert resp.status_code == 401


# --- POST /tags ---


async def test_create_tag_returns_201(client):
    """Valid payload creates a tag with correct fields."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]

    resp = await _create_tag(client, headers)

    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "vacation"
    assert data["group_id"] is None
    assert data["owner_id"] == user_id
    assert data["id"] is not None
    assert data["created_at"] is not None


async def test_create_tag_duplicate_name_returns_409(client):
    """Same name for the same user returns 409."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await _create_tag(client, headers, name="vacation")
    resp = await _create_tag(client, headers, name="vacation")

    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]


async def test_create_tag_same_name_different_user_allowed(client):
    """Two different users can have tags with the same name."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    other_headers = _get_auth_header(await _create_second_user(client))

    resp1 = await _create_tag(client, headers, name="vacation")
    resp2 = await _create_tag(client, other_headers, name="vacation")

    assert resp1.status_code == 201
    assert resp2.status_code == 201
    assert resp1.json()["id"] != resp2.json()["id"]


async def test_create_tag_empty_name_returns_422(client):
    """Empty name returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_tag(client, headers, name="")

    assert resp.status_code == 422


async def test_create_tag_without_auth_returns_401(client):
    """POST /tags without an Authorization header returns 401."""
    resp = await client.post("/tags", json=TAG_PAYLOAD)
    assert resp.status_code == 401


# --- PATCH /tags/{tag_id} ---


async def test_patch_tag_updates_name(client):
    """PATCH updates name and returns the updated tag."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_tag(client, headers)
    tag_id = create_resp.json()["id"]

    resp = await client.patch(f"/tags/{tag_id}", json={"name": "renamed"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["name"] == "renamed"


async def test_patch_tag_empty_body_returns_unchanged(client):
    """PATCH with empty body returns 200 with no changes."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_tag(client, headers)
    tag_id = create_resp.json()["id"]

    before = await client.get(f"/tags/{tag_id}", headers=headers)
    resp = await client.patch(f"/tags/{tag_id}", json={}, headers=headers)

    assert resp.status_code == 200
    assert resp.json() == before.json()


async def test_patch_tag_not_found_returns_404(client):
    """PATCH non-existent tag returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch(f"/tags/{NONEXISTENT_ID}", json={"name": "X"}, headers=headers)

    assert resp.status_code == 404


async def test_patch_tag_other_user_returns_404(client):
    """PATCH on another user's tag returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_tag(client, headers)
    tag_id = create_resp.json()["id"]

    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await client.patch(f"/tags/{tag_id}", json={"name": "hacked"}, headers=other_headers)

    assert resp.status_code == 404


async def test_patch_tag_rename_to_duplicate_returns_409(client):
    """Renaming a tag to an existing name returns 409."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await _create_tag(client, headers, name="alpha")
    create_resp = await _create_tag(client, headers, name="beta")
    tag_id = create_resp.json()["id"]

    resp = await client.patch(f"/tags/{tag_id}", json={"name": "alpha"}, headers=headers)

    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]


async def test_patch_tag_without_auth_returns_401(client):
    """PATCH /tags/{id} without an Authorization header returns 401."""
    resp = await client.patch(f"/tags/{NONEXISTENT_ID}", json={"name": "X"})
    assert resp.status_code == 401


# --- DELETE /tags/{tag_id} ---


async def test_delete_tag_returns_204(client):
    """DELETE removes the tag and returns 204."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_tag(client, headers)
    tag_id = create_resp.json()["id"]

    resp = await client.delete(f"/tags/{tag_id}", headers=headers)

    assert resp.status_code == 204

    get_resp = await client.get(f"/tags/{tag_id}", headers=headers)
    assert get_resp.status_code == 404


async def test_delete_tag_not_found_returns_404(client):
    """DELETE non-existent tag returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.delete(f"/tags/{NONEXISTENT_ID}", headers=headers)

    assert resp.status_code == 404


async def test_delete_tag_other_user_returns_404(client):
    """Deleting another user's tag returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_tag(client, headers)
    tag_id = create_resp.json()["id"]

    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await client.delete(f"/tags/{tag_id}", headers=other_headers)

    assert resp.status_code == 404


async def test_delete_tag_without_auth_returns_401(client):
    """DELETE /tags/{id} without an Authorization header returns 401."""
    resp = await client.delete(f"/tags/{NONEXISTENT_ID}")
    assert resp.status_code == 401


async def test_delete_tag_referenced_by_transaction_returns_409(client):
    """Deleting a tag that is linked to a transaction returns 409."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    tag_resp = await _create_tag(client, headers)
    tag_id = tag_resp.json()["id"]

    acct_resp = await _create_account(client, headers)
    account_id = acct_resp.json()["id"]

    cat_resp = await client.post("/categories", json={
        "name": "Misc", "kind": "expense",
    }, headers=headers)
    category_id = cat_resp.json()["id"]

    txn_resp = await client.post("/transactions", json={
        "account_id": account_id,
        "category_id": category_id,
        "dt": "2026-03-15",
        "amount": -5000,
        "currency": "CAD",
        "tag_ids": [tag_id],
        "merchant_id": await _get_system_merchant_id(client, headers),
    }, headers=headers)
    assert txn_resp.status_code == 201

    resp = await client.delete(f"/tags/{tag_id}", headers=headers)

    assert resp.status_code == 409
    assert resp.json()["detail"] == "Tag is referenced by existing transactions"


# --- POST /tags/{tag_id}/merge ---


async def test_merge_tag_moves_transaction_references_and_deletes_source(client):
    """Merge rewrites transaction tag references and deletes the source tag."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    source_resp = await _create_tag(client, headers, name="source")
    replacement_resp = await _create_tag(client, headers, name="replacement")
    source_id = source_resp.json()["id"]
    replacement_id = replacement_resp.json()["id"]

    account_resp = await _create_account(client, headers)
    category_resp = await client.post("/categories", json={
        "name": "Misc", "kind": "expense",
    }, headers=headers)
    transaction_resp = await client.post("/transactions", json={
        "account_id": account_resp.json()["id"],
        "category_id": category_resp.json()["id"],
        "dt": "2026-03-15",
        "amount": -5000,
        "currency": "CAD",
        "tag_ids": [source_id],
        "merchant_id": await _get_system_merchant_id(client, headers),
    }, headers=headers)
    transaction_id = transaction_resp.json()["id"]

    resp = await client.post(
        f"/tags/{source_id}/merge",
        json={"replacement_tag_id": replacement_id},
        headers=headers,
    )

    assert resp.status_code == 204

    get_transaction_resp = await client.get(f"/transactions/{transaction_id}", headers=headers)
    assert get_transaction_resp.status_code == 200
    assert get_transaction_resp.json()["tag_ids"] == [replacement_id]

    source_check = await client.get(f"/tags/{source_id}", headers=headers)
    assert source_check.status_code == 404


async def test_merge_tag_deduplicates_existing_replacement_reference(client):
    """Merge does not violate the transaction/tag primary key when replacement is already linked."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    source_resp = await _create_tag(client, headers, name="source")
    replacement_resp = await _create_tag(client, headers, name="replacement")
    source_id = source_resp.json()["id"]
    replacement_id = replacement_resp.json()["id"]

    account_resp = await _create_account(client, headers)
    category_resp = await client.post("/categories", json={
        "name": "Misc", "kind": "expense",
    }, headers=headers)
    transaction_resp = await client.post("/transactions", json={
        "account_id": account_resp.json()["id"],
        "category_id": category_resp.json()["id"],
        "dt": "2026-03-15",
        "amount": -5000,
        "currency": "CAD",
        "tag_ids": [source_id, replacement_id],
        "merchant_id": await _get_system_merchant_id(client, headers),
    }, headers=headers)
    transaction_id = transaction_resp.json()["id"]

    resp = await client.post(
        f"/tags/{source_id}/merge",
        json={"replacement_tag_id": replacement_id},
        headers=headers,
    )

    assert resp.status_code == 204

    get_transaction_resp = await client.get(f"/transactions/{transaction_id}", headers=headers)
    assert get_transaction_resp.status_code == 200
    assert get_transaction_resp.json()["tag_ids"] == [replacement_id]


async def test_merge_tag_rejects_same_tag_replacement(client):
    """A tag cannot be merged into itself."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    tag_resp = await _create_tag(client, headers)
    tag_id = tag_resp.json()["id"]

    resp = await client.post(
        f"/tags/{tag_id}/merge",
        json={"replacement_tag_id": tag_id},
        headers=headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Replacement tag must be different"
