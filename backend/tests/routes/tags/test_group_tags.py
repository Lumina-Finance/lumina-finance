from tests.routes.support import _create_user, _get_auth_header
from tests.routes.tags._helpers import (
    NONEXISTENT_ID,
    _create_group,
    _create_tag,
    _setup_group_with_member,
)

# --- Group tags: POST /tags ---


async def test_create_group_tag_as_member_returns_201(client):
    """Any group member can create a group tag. Owner is the creating member."""
    _, member_headers, member_user_id, group_id = await _setup_group_with_member(client)

    resp = await _create_tag(client, member_headers, name="shared-expense", group_id=group_id)

    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "shared-expense"
    assert data["group_id"] == group_id
    assert data["owner_id"] == member_user_id


async def test_create_group_tag_as_admin_returns_201(client):
    """Admin can create a group tag."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    resp = await _create_tag(client, admin_headers, name="household", group_id=group_id)

    assert resp.status_code == 201
    assert resp.json()["group_id"] == group_id


async def test_create_group_tag_non_member_returns_404(client):
    """Non-member cannot create a tag in a group."""
    _, _, _, group_id = await _setup_group_with_member(client)

    outsider_resp = await client.post("/auth/signup", json={
        "email": "outsider@example.com", "password": "SecurePassword123!",
        "first_name": "Outsider", "tz": "America/Toronto", "base_currency": "CAD",
    })
    outsider_headers = _get_auth_header(outsider_resp)

    resp = await _create_tag(client, outsider_headers, group_id=group_id)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Group not found"


async def test_create_group_tag_duplicate_returns_409(client):
    """Duplicate name within the same group returns 409."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    await _create_tag(client, admin_headers, name="shared", group_id=group_id)
    resp = await _create_tag(client, admin_headers, name="shared", group_id=group_id)

    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]


async def test_create_group_tag_same_name_as_personal_allowed(client):
    """Personal and group tags with the same name can coexist."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    personal = await _create_tag(client, admin_headers, name="vacation")
    group = await _create_tag(client, admin_headers, name="vacation", group_id=group_id)

    assert personal.status_code == 201
    assert group.status_code == 201
    assert personal.json()["id"] != group.json()["id"]


async def test_create_group_tag_nonexistent_group_returns_404(client):
    """Creating a tag with a fake group_id returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_tag(client, headers, group_id=NONEXISTENT_ID)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Group not found"


# --- Group tags: GET /tags ---


async def test_list_tags_with_group_filter_as_admin(client):
    """Admin passing group_id returns personal + that group's tags."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    await _create_tag(client, admin_headers, name="personal-tag")
    await _create_tag(client, admin_headers, name="shared-tag", group_id=group_id)

    resp = await client.get(f"/tags?group_id={group_id}", headers=admin_headers)

    assert resp.status_code == 200
    names = {t["name"] for t in resp.json()}
    assert "personal-tag" in names
    assert "shared-tag" in names


async def test_list_tags_with_group_filter_as_member(client):
    """Non-admin member passing group_id also sees group tags."""
    admin_headers, member_headers, _, group_id = await _setup_group_with_member(client)

    await _create_tag(client, admin_headers, name="shared-tag", group_id=group_id)

    resp = await client.get(f"/tags?group_id={group_id}", headers=member_headers)

    assert resp.status_code == 200
    names = {t["name"] for t in resp.json()}
    assert "shared-tag" in names


async def test_list_tags_without_group_filter_excludes_group(client):
    """Without group_id filter, only personal tags are returned."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    await _create_tag(client, admin_headers, name="personal-tag")
    await _create_tag(client, admin_headers, name="shared-tag", group_id=group_id)

    resp = await client.get("/tags", headers=admin_headers)

    assert resp.status_code == 200
    names = {t["name"] for t in resp.json()}
    assert "personal-tag" in names
    assert "shared-tag" not in names


async def test_list_tags_group_filter_supports_search_and_pagination(client):
    """group_id, q, limit, and offset compose for lazy-loaded group tag pickers."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    await _create_tag(client, admin_headers, name="shared-alpha", group_id=group_id)
    await _create_tag(client, admin_headers, name="shared-bravo", group_id=group_id)
    await _create_tag(client, admin_headers, name="shared-charlie", group_id=group_id)
    await _create_tag(client, admin_headers, name="personal-shared")
    await _create_tag(client, admin_headers, name="private")

    first_page = await client.get(
        f"/tags?group_id={group_id}&q=shared&limit=2",
        headers=admin_headers,
    )
    second_page = await client.get(
        f"/tags?group_id={group_id}&q=shared&limit=2&offset=2",
        headers=admin_headers,
    )

    assert first_page.status_code == 200
    assert second_page.status_code == 200
    assert [tag["name"] for tag in first_page.json()] == ["personal-shared", "shared-alpha"]
    assert [tag["name"] for tag in second_page.json()] == ["shared-bravo", "shared-charlie"]


async def test_list_tags_group_filter_non_member_returns_404(client):
    """Non-member passing group_id filter returns 404."""
    _, _, _, group_id = await _setup_group_with_member(client)

    outsider_resp = await client.post("/auth/signup", json={
        "email": "outsider@example.com", "password": "SecurePassword123!",
        "first_name": "Outsider", "tz": "America/Toronto", "base_currency": "CAD",
    })
    outsider_headers = _get_auth_header(outsider_resp)

    resp = await client.get(f"/tags?group_id={group_id}", headers=outsider_headers)

    assert resp.status_code == 404


async def test_get_group_tag_as_member(client):
    """Non-admin member can view a group tag."""
    admin_headers, member_headers, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_tag(client, admin_headers, name="shared", group_id=group_id)
    tag_id = create_resp.json()["id"]

    resp = await client.get(f"/tags/{tag_id}", headers=member_headers)

    assert resp.status_code == 200
    assert resp.json()["name"] == "shared"
    assert resp.json()["group_id"] == group_id


async def test_get_group_tag_non_member_returns_404(client):
    """Non-member cannot view a group tag."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_tag(client, admin_headers, name="shared", group_id=group_id)
    tag_id = create_resp.json()["id"]

    outsider_resp = await client.post("/auth/signup", json={
        "email": "outsider@example.com", "password": "SecurePassword123!",
        "first_name": "Outsider", "tz": "America/Toronto", "base_currency": "CAD",
    })
    outsider_headers = _get_auth_header(outsider_resp)

    resp = await client.get(f"/tags/{tag_id}", headers=outsider_headers)

    assert resp.status_code == 404


async def test_list_tags_with_group_filter_excludes_other_groups(client):
    """Tag created in Group A must not appear when listing with Group B's filter."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    group_a = await _create_group(client, headers)
    group_b = await _create_group(client, headers)

    await _create_tag(client, headers, name="personal-tag")
    await _create_tag(client, headers, name="group-a-tag", group_id=group_a)
    await _create_tag(client, headers, name="group-b-tag", group_id=group_b)

    resp = await client.get(f"/tags?group_id={group_b}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    names = {t["name"] for t in data}
    assert len(data) == 2
    assert "personal-tag" in names
    assert "group-b-tag" in names
    assert "group-a-tag" not in names


# --- Group tags: PATCH /tags ---


async def test_patch_group_tag_as_admin(client):
    """Admin can update a group tag."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_tag(client, admin_headers, name="old-name", group_id=group_id)
    tag_id = create_resp.json()["id"]

    resp = await client.patch(f"/tags/{tag_id}", json={"name": "new-name"}, headers=admin_headers)

    assert resp.status_code == 200
    assert resp.json()["name"] == "new-name"


async def test_patch_group_tag_as_non_admin_returns_403(client):
    """Non-admin member cannot update a group tag."""
    admin_headers, member_headers, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_tag(client, admin_headers, name="shared", group_id=group_id)
    tag_id = create_resp.json()["id"]

    resp = await client.patch(f"/tags/{tag_id}", json={"name": "hacked"}, headers=member_headers)

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Admin role required"

    # Verify the tag was not mutated
    get_resp = await client.get(f"/tags/{tag_id}", headers=admin_headers)
    assert get_resp.json()["name"] == "shared"


async def test_patch_group_tag_non_member_returns_404(client):
    """Non-member cannot see or update a group tag."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_tag(client, admin_headers, name="shared", group_id=group_id)
    tag_id = create_resp.json()["id"]

    outsider_resp = await client.post("/auth/signup", json={
        "email": "outsider@example.com", "password": "SecurePassword123!",
        "first_name": "Outsider", "tz": "America/Toronto", "base_currency": "CAD",
    })
    outsider_headers = _get_auth_header(outsider_resp)

    resp = await client.patch(f"/tags/{tag_id}", json={"name": "hacked"}, headers=outsider_headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Tag not found"


async def test_patch_group_tag_rename_to_duplicate_returns_409(client):
    """Renaming a group tag to an existing group tag name returns 409."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    await _create_tag(client, admin_headers, name="alpha", group_id=group_id)
    create_resp = await _create_tag(client, admin_headers, name="beta", group_id=group_id)
    tag_id = create_resp.json()["id"]

    resp = await client.patch(f"/tags/{tag_id}", json={"name": "alpha"}, headers=admin_headers)

    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]


# --- Group tags: DELETE /tags ---


async def test_delete_group_tag_as_admin(client):
    """Admin can delete a group tag."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_tag(client, admin_headers, name="to-delete", group_id=group_id)
    tag_id = create_resp.json()["id"]

    resp = await client.delete(f"/tags/{tag_id}", headers=admin_headers)

    assert resp.status_code == 204

    get_resp = await client.get(f"/tags/{tag_id}", headers=admin_headers)
    assert get_resp.status_code == 404


async def test_delete_group_tag_as_non_admin_returns_403(client):
    """Non-admin member cannot delete a group tag."""
    admin_headers, member_headers, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_tag(client, admin_headers, name="shared", group_id=group_id)
    tag_id = create_resp.json()["id"]

    resp = await client.delete(f"/tags/{tag_id}", headers=member_headers)

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Admin role required"

    # Verify the tag still exists
    get_resp = await client.get(f"/tags/{tag_id}", headers=admin_headers)
    assert get_resp.status_code == 200


async def test_delete_group_tag_non_member_returns_404(client):
    """Non-member cannot see or delete a group tag."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_tag(client, admin_headers, name="shared", group_id=group_id)
    tag_id = create_resp.json()["id"]

    outsider_resp = await client.post("/auth/signup", json={
        "email": "outsider@example.com", "password": "SecurePassword123!",
        "first_name": "Outsider", "tz": "America/Toronto", "base_currency": "CAD",
    })
    outsider_headers = _get_auth_header(outsider_resp)

    resp = await client.delete(f"/tags/{tag_id}", headers=outsider_headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Tag not found"
