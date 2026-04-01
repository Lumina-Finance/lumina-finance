from tests.routes.conftest import _create_user, _get_auth_header

# --- Helpers ---

NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000"

TAG_PAYLOAD = {
    "name": "vacation",
}


async def _create_tag(client, headers, **overrides):
    """Create a tag via the API. Returns the response."""
    payload = {**TAG_PAYLOAD, **overrides}
    return await client.post("/tags", json=payload, headers=headers)


async def _create_second_user(client):
    """Sign up a second user. Returns the signup response."""
    return await client.post("/auth/signup", json={
        "email": "other@example.com",
        "password": "securepassword123",
        "first_name": "Other",
        "tz": "America/Toronto",
        "base_currency": "CAD",
    })


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

    resp = await _create_tag(client, headers)

    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "vacation"
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
