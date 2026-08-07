import uuid

from app.models.merchant import Merchant
from app.services.merchants.defaults import SELF_MERCHANT_NAME
from tests.conftest import TestSession
from tests.routes.merchants._helpers import (
    MERCHANT_PAYLOAD,
    NONEXISTENT_ID,
    _create_category,
    _create_merchant,
    _create_second_user,
    _get_system_category_id,
    _own_merchant_names,
)
from tests.routes.support import _create_user, _get_auth_header

# --- GET /merchants ---


async def test_list_merchants_returns_empty_list(client):
    """User with no merchants gets an empty list."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/merchants", headers=headers)

    assert resp.status_code == 200
    assert _own_merchant_names(resp) == []


async def test_list_merchants_returns_user_merchants(client):
    """User sees their own merchants and not another user's."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await _create_merchant(client, headers, name="Costco")
    await _create_merchant(client, headers, name="Walmart")

    other_headers = _get_auth_header(await _create_second_user(client))
    await _create_merchant(client, other_headers, name="Other Store")

    resp = await client.get("/merchants", headers=headers)

    assert resp.status_code == 200
    assert set(_own_merchant_names(resp)) == {"Costco", "Walmart"}


async def test_list_merchants_supports_limit_and_offset(client):
    """GET /merchants can return a sorted page of merchants."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await _create_merchant(client, headers, name="Charlie Market")
    await _create_merchant(client, headers, name="Alpha Market")
    await _create_merchant(client, headers, name="Bravo Market")

    first_page = await client.get("/merchants?limit=2", headers=headers)
    second_page = await client.get("/merchants?limit=2&offset=2", headers=headers)

    # Paging counts the system merchants too, since a page is what the endpoint returns rather than
    # what the user owns, and an unused one sorts by name among the rest
    assert first_page.status_code == 200
    assert [merchant["name"] for merchant in first_page.json()] == ["Alpha Market", "Bravo Market"]
    assert second_page.status_code == 200
    assert [merchant["name"] for merchant in second_page.json()] == ["Charlie Market", "Myself"]


async def test_list_merchants_searches_names_case_insensitively(client):
    """GET /merchants?q= filters merchant names without leaking other users' rows."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await _create_merchant(client, headers, name="Coffee Bar")
    await _create_merchant(client, headers, name="Book Shop")

    other_headers = _get_auth_header(await _create_second_user(client))
    await _create_merchant(client, other_headers, name="Coffee Other")

    resp = await client.get("/merchants?q=COF", headers=headers)

    assert resp.status_code == 200
    assert _own_merchant_names(resp) == ["Coffee Bar"]


async def test_list_merchants_rejects_invalid_pagination_params(client):
    """Pagination query params must stay within the route bounds."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    for url in ["/merchants?limit=0", "/merchants?limit=51", "/merchants?offset=-1"]:
        resp = await client.get(url, headers=headers)
        assert resp.status_code == 422


async def test_list_merchants_without_auth_returns_401(client):
    """GET /merchants without an Authorization header returns 401."""
    resp = await client.get("/merchants")
    assert resp.status_code == 401


# --- GET /merchants/{merchant_id} ---


async def test_get_merchant_returns_merchant(client):
    """Valid merchant ID returns the merchant with all fields."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    create_resp = await _create_merchant(client, headers)
    merchant_id = create_resp.json()["id"]

    resp = await client.get(f"/merchants/{merchant_id}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Costco"
    assert data["default_category_id"] is None


async def test_get_merchant_not_found_returns_404(client):
    """Non-existent merchant ID returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(f"/merchants/{NONEXISTENT_ID}", headers=headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Merchant not found"


async def test_get_merchant_other_user_returns_404(client):
    """Accessing another user's merchant returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_merchant(client, headers)
    merchant_id = create_resp.json()["id"]

    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await client.get(f"/merchants/{merchant_id}", headers=other_headers)

    assert resp.status_code == 404


async def test_get_merchant_without_auth_returns_401(client):
    """GET /merchants/{id} without an Authorization header returns 401."""
    resp = await client.get(f"/merchants/{NONEXISTENT_ID}")
    assert resp.status_code == 401


# --- POST /merchants ---


async def test_create_merchant_returns_201(client):
    """Valid payload creates a merchant with correct fields."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_merchant(client, headers)

    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Costco"
    assert data["default_category_id"] is None
    assert data["id"] is not None
    assert data["created_at"] is not None


async def test_create_merchant_with_default_category(client):
    """Merchant can be created with a valid default_category_id."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    resp = await _create_merchant(client, headers, default_category_id=category_id)

    assert resp.status_code == 201
    assert resp.json()["default_category_id"] == category_id


async def test_create_merchant_with_system_default_category(client):
    """Merchant can use a system category as default_category_id."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    category_id = await _get_system_category_id(client, headers)

    resp = await _create_merchant(client, headers, default_category_id=category_id)

    assert resp.status_code == 201
    assert resp.json()["default_category_id"] == category_id


async def test_create_personal_merchant_duplicate_returns_409(client):
    """Creating two personal merchants with the same name returns 409."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await _create_merchant(client, headers, name="Costco")
    resp = await _create_merchant(client, headers, name="Costco")

    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]


async def test_create_merchant_invalid_category_returns_422(client):
    """Non-existent default_category_id returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_merchant(client, headers, default_category_id=NONEXISTENT_ID)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Category not found"


async def test_create_merchant_other_users_category_returns_422(client):
    """Using another user's category as default_category_id returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await _create_merchant(client, other_headers, default_category_id=category_id)

    assert resp.status_code == 422


async def test_create_merchant_empty_name_returns_422(client):
    """Empty name returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_merchant(client, headers, name="")

    assert resp.status_code == 422


async def test_create_merchant_without_auth_returns_401(client):
    """POST /merchants without an Authorization header returns 401."""
    resp = await client.post("/merchants", json=MERCHANT_PAYLOAD)
    assert resp.status_code == 401


# --- PATCH /merchants/{merchant_id} ---


async def test_patch_merchant_updates_name(client):
    """PATCH updates name and returns the updated merchant."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_merchant(client, headers)
    merchant_id = create_resp.json()["id"]

    resp = await client.patch(f"/merchants/{merchant_id}", json={"name": "Renamed"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["name"] == "Renamed"


async def test_patch_merchant_updates_default_category(client):
    """PATCH can set a default_category_id."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    create_resp = await _create_merchant(client, headers)
    merchant_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/merchants/{merchant_id}",
        json={"default_category_id": category_id},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["default_category_id"] == category_id


async def test_patch_merchant_updates_system_default_category(client):
    """PATCH can set default_category_id to a system category."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    category_id = await _get_system_category_id(client, headers)

    create_resp = await _create_merchant(client, headers)
    merchant_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/merchants/{merchant_id}",
        json={"default_category_id": category_id},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["default_category_id"] == category_id


async def test_patch_merchant_clears_default_category(client):
    """PATCH with default_category_id=null clears the category link."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    create_resp = await _create_merchant(client, headers, default_category_id=category_id)
    merchant_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/merchants/{merchant_id}",
        json={"default_category_id": None},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["default_category_id"] is None


async def test_patch_merchant_invalid_category_returns_422(client):
    """PATCH with non-existent default_category_id returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_merchant(client, headers)
    merchant_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/merchants/{merchant_id}",
        json={"default_category_id": NONEXISTENT_ID},
        headers=headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Category not found"


async def test_patch_merchant_empty_body_returns_unchanged(client):
    """PATCH with empty body returns 200 with no changes."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_merchant(client, headers)
    merchant_id = create_resp.json()["id"]

    before = await client.get(f"/merchants/{merchant_id}", headers=headers)
    resp = await client.patch(f"/merchants/{merchant_id}", json={}, headers=headers)

    assert resp.status_code == 200
    assert resp.json() == before.json()


async def test_patch_merchant_not_found_returns_404(client):
    """PATCH non-existent merchant returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch(f"/merchants/{NONEXISTENT_ID}", json={"name": "X"}, headers=headers)

    assert resp.status_code == 404


async def test_patch_merchant_other_user_returns_404(client):
    """PATCH on another user's merchant returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_merchant(client, headers)
    merchant_id = create_resp.json()["id"]

    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await client.patch(f"/merchants/{merchant_id}", json={"name": "Hacked"}, headers=other_headers)

    assert resp.status_code == 404


async def test_patch_merchant_rename_to_duplicate_returns_409(client):
    """Renaming a merchant to an existing name returns 409."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await _create_merchant(client, headers, name="Costco")
    create_resp = await _create_merchant(client, headers, name="Walmart")
    merchant_id = create_resp.json()["id"]

    resp = await client.patch(f"/merchants/{merchant_id}", json={"name": "Costco"}, headers=headers)

    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]

    # Verify the merchant was not mutated
    get_resp = await client.get(f"/merchants/{merchant_id}", headers=headers)
    assert get_resp.json()["name"] == "Walmart"


async def test_patch_merchant_recapitalises_its_own_name(client):
    """The duplicate check leaves the merchant itself out, so correcting its capitalisation is a rename it can make."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    merchant_id = (await _create_merchant(client, headers, name="corner shop")).json()["id"]

    resp = await client.patch(f"/merchants/{merchant_id}", json={"name": "Corner Shop"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["name"] == "Corner Shop"


async def test_creating_a_merchant_beside_a_personal_and_a_shared_one_returns_409(client):
    """Two rows can answer the check at once, since each scope has an index of its own."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    created = (await _create_merchant(client, headers, name="Corner Shop")).json()

    # Inserted past the route, which refuses a name a shared merchant holds whatever the scope. The
    # unique indexes still allow the pair, so this is what a database looks like where someone had
    # their own merchant before the app shipped one reading the same
    async with TestSession() as session:
        session.add(Merchant(owner_id=uuid.UUID(created["owner_id"]), name=SELF_MERCHANT_NAME.lower()))
        await session.commit()

    resp = await _create_merchant(client, headers, name=SELF_MERCHANT_NAME.upper())

    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]


async def test_creating_a_merchant_differing_only_in_surrounding_spaces_returns_409(client):
    """A name is stored trimmed, so spaces around it cannot make a second merchant."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    await _create_merchant(client, headers, name="Corner Shop")

    resp = await _create_merchant(client, headers, name="  Corner Shop  ")

    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]


async def test_creating_a_merchant_stores_its_name_without_surrounding_spaces(client):
    """Trimming happens on the way in, so the stored name is what every comparison reads."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_merchant(client, headers, name="  Corner Shop  ")

    assert resp.status_code == 201
    assert resp.json()["name"] == "Corner Shop"


async def test_creating_a_merchant_named_only_spaces_is_refused(client):
    """Nothing is left after trimming, so it is refused rather than stored empty."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_merchant(client, headers, name="   ")

    assert resp.status_code == 422


async def test_patch_merchant_without_auth_returns_401(client):
    """PATCH /merchants/{id} without an Authorization header returns 401."""
    resp = await client.patch(f"/merchants/{NONEXISTENT_ID}", json={"name": "X"})
    assert resp.status_code == 401


# --- DELETE /merchants/{merchant_id} ---


async def test_delete_merchant_returns_204(client):
    """DELETE removes the merchant and returns 204."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_merchant(client, headers)
    merchant_id = create_resp.json()["id"]

    resp = await client.delete(f"/merchants/{merchant_id}", headers=headers)

    assert resp.status_code == 204

    get_resp = await client.get(f"/merchants/{merchant_id}", headers=headers)
    assert get_resp.status_code == 404


async def test_delete_merchant_not_found_returns_404(client):
    """DELETE non-existent merchant returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.delete(f"/merchants/{NONEXISTENT_ID}", headers=headers)

    assert resp.status_code == 404


async def test_delete_merchant_other_user_returns_404(client):
    """Deleting another user's merchant returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_merchant(client, headers)
    merchant_id = create_resp.json()["id"]

    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await client.delete(f"/merchants/{merchant_id}", headers=other_headers)

    assert resp.status_code == 404


async def test_delete_merchant_without_auth_returns_401(client):
    """DELETE /merchants/{id} without an Authorization header returns 401."""
    resp = await client.delete(f"/merchants/{NONEXISTENT_ID}")
    assert resp.status_code == 401


# --- System merchants ---


async def _system_merchant(client, headers, name="Myself"):
    """Return the system merchant with the given name from the listing."""
    resp = await client.get("/merchants", headers=headers)
    return next(merchant for merchant in resp.json() if merchant["name"] == name)


async def test_system_merchant_is_listed_for_every_user(client):
    """A merchant that ships with the app belongs to everyone rather than to one user."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers = _get_auth_header(await _create_second_user(client))

    for user_headers in (headers, other_headers):
        merchant = await _system_merchant(client, user_headers)
        assert merchant["is_system"] is True
        assert merchant["owner_id"] is None
        assert merchant["default_category_id"] is None


async def test_creating_a_merchant_with_a_system_name_returns_409(client):
    """The seeded name is taken everywhere, so a second Myself cannot appear beside it."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_merchant(client, headers, name="Myself")

    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]


async def test_renaming_a_system_merchant_returns_403(client):
    """A merchant that ships with the app is not one user's to rename."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    merchant = await _system_merchant(client, headers)

    resp = await client.patch(f"/merchants/{merchant['id']}", json={"name": "Me"}, headers=headers)

    assert resp.status_code == 403


async def test_deleting_a_system_merchant_returns_403(client):
    """Nor is it one user's to delete out from under everyone else."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    merchant = await _system_merchant(client, headers)

    resp = await client.delete(f"/merchants/{merchant['id']}", headers=headers)

    assert resp.status_code == 403


async def test_creating_a_merchant_with_a_system_name_in_any_case_returns_409(client):
    """A different capitalisation would read as a second copy of the same merchant."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_merchant(client, headers, name="mYsElF")

    assert resp.status_code == 409


async def test_renaming_a_merchant_onto_a_system_name_returns_409(client):
    """The reserved name holds on rename, not only on create."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    merchant_id = (await _create_merchant(client, headers, name="Corner Shop")).json()["id"]

    resp = await client.patch(f"/merchants/{merchant_id}", json={"name": "Myself"}, headers=headers)

    assert resp.status_code == 409


async def test_merging_a_system_merchant_away_returns_403(client):
    """Merging deletes the source, so it is refused for the merchant everyone shares."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    replacement_id = (await _create_merchant(client, headers, name="Corner Shop")).json()["id"]
    system_merchant = await _system_merchant(client, headers)

    resp = await client.post(
        f"/merchants/{system_merchant['id']}/merge",
        json={"replacement_merchant_id": replacement_id},
        headers=headers,
    )

    assert resp.status_code == 403
