"""Route tests for insights saved relative ranges."""

from tests.routes.support import _create_user, _get_auth_header

SAVED_RANGE_PAYLOAD = {"name": "Half-year review", "amount": 6, "unit": "month"}


async def _create_second_user(client):
    """Sign up a second user so saved-range isolation can be exercised

    Args:
        client: Async test client

    Returns:
        Authorization header for the second user
    """
    resp = await client.post("/auth/signup", json={
        "email": "second@example.com",
        "password": "securepassword123",
        "first_name": "Second",
        "tz": "America/Toronto",
        "base_currency": "CAD",
    })
    return _get_auth_header(resp)


async def test_create_saved_range_returns_payload(client):
    """Saving a range echoes the stored name, amount, and unit."""
    headers = _get_auth_header(await _create_user(client))

    resp = await client.post("/insights/saved-ranges", json=SAVED_RANGE_PAYLOAD, headers=headers)

    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Half-year review"
    assert data["amount"] == 6
    assert data["unit"] == "month"
    assert data["qualifier"] == "past"
    assert "id" in data
    assert "created_at" in data


async def test_create_saved_range_stores_qualifier(client):
    """Saving a previous-complete range echoes the chosen qualifier back."""
    headers = _get_auth_header(await _create_user(client))

    resp = await client.post(
        "/insights/saved-ranges",
        json={"name": "Last quarter", "amount": 1, "unit": "quarter", "qualifier": "last"},
        headers=headers,
    )

    assert resp.status_code == 201
    assert resp.json()["qualifier"] == "last"


async def test_create_saved_range_rejects_unknown_qualifier(client):
    """An unsupported qualifier is rejected before reaching the database."""
    headers = _get_auth_header(await _create_user(client))

    resp = await client.post(
        "/insights/saved-ranges",
        json={"name": "Rolling", "amount": 1, "unit": "quarter", "qualifier": "rolling"},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_list_saved_ranges_returns_newest_first(client):
    """Saved ranges list with the most recently created range first."""
    headers = _get_auth_header(await _create_user(client))
    await client.post(
        "/insights/saved-ranges",
        json={"name": "Weekly", "amount": 7, "unit": "day"},
        headers=headers,
    )
    await client.post(
        "/insights/saved-ranges",
        json={"name": "Yearly", "amount": 1, "unit": "year"},
        headers=headers,
    )

    resp = await client.get("/insights/saved-ranges", headers=headers)

    assert resp.status_code == 200
    names = [item["name"] for item in resp.json()]
    assert names == ["Yearly", "Weekly"]


async def test_create_saved_range_rejects_duplicate_name(client):
    """A second range reusing a name returns a conflict."""
    headers = _get_auth_header(await _create_user(client))
    await client.post("/insights/saved-ranges", json=SAVED_RANGE_PAYLOAD, headers=headers)

    resp = await client.post("/insights/saved-ranges", json=SAVED_RANGE_PAYLOAD, headers=headers)

    assert resp.status_code == 409


async def test_create_saved_range_rejects_unknown_unit(client):
    """An unsupported unit is rejected before reaching the database."""
    headers = _get_auth_header(await _create_user(client))

    resp = await client.post(
        "/insights/saved-ranges",
        json={"name": "Decade", "amount": 1, "unit": "decade"},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_create_saved_range_rejects_non_positive_amount(client):
    """An amount below one is rejected."""
    headers = _get_auth_header(await _create_user(client))

    resp = await client.post(
        "/insights/saved-ranges",
        json={"name": "Zero", "amount": 0, "unit": "month"},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_delete_saved_range_removes_it(client):
    """Deleting a saved range drops it from the list."""
    headers = _get_auth_header(await _create_user(client))
    created = (await client.post("/insights/saved-ranges", json=SAVED_RANGE_PAYLOAD, headers=headers)).json()

    delete_resp = await client.delete(f"/insights/saved-ranges/{created['id']}", headers=headers)
    list_resp = await client.get("/insights/saved-ranges", headers=headers)

    assert delete_resp.status_code == 204
    assert list_resp.json() == []


async def test_delete_missing_saved_range_returns_not_found(client):
    """Deleting an unknown range returns not found."""
    headers = _get_auth_header(await _create_user(client))

    resp = await client.delete(
        "/insights/saved-ranges/00000000-0000-0000-0000-000000000000",
        headers=headers,
    )

    assert resp.status_code == 404


async def test_saved_ranges_are_isolated_per_user(client):
    """A user never sees or deletes another user's saved ranges."""
    owner_headers = _get_auth_header(await _create_user(client))
    created = (await client.post("/insights/saved-ranges", json=SAVED_RANGE_PAYLOAD, headers=owner_headers)).json()
    other_headers = await _create_second_user(client)

    other_list = await client.get("/insights/saved-ranges", headers=other_headers)
    other_delete = await client.delete(f"/insights/saved-ranges/{created['id']}", headers=other_headers)

    assert other_list.json() == []
    assert other_delete.status_code == 404


async def test_saved_ranges_require_auth(client):
    """Saved range endpoints require an authenticated user."""
    resp = await client.get("/insights/saved-ranges")

    assert resp.status_code == 401
