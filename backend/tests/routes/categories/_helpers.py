from tests.routes.support import _create_user, _get_auth_header

NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000"

CATEGORY_PAYLOAD = {
    "name": "Custom Test Category",
    "kind": "expense",
}

async def _create_category(client, headers, **overrides):
    """Create a category via POST /categories.

    Defaults: name="Custom Test Category", kind="expense".

    Args:
        client: The async test client.
        headers: Auth headers for the requesting user.
        **overrides: Fields to override in the default payload.

    Returns:
        The HTTP response from the API
    """
    payload = {**CATEGORY_PAYLOAD, **overrides}
    return await client.post("/categories", json=payload, headers=headers)

async def _create_second_user(client):
    """Sign up a second user for ownership-isolation tests.

    Args:
        client: The async test client.

    Returns:
        The HTTP response from the signup endpoint
    """
    return await client.post("/auth/signup", json={
        "email": "other@example.com",
        "password": "SecurePassword123!",
        "first_name": "Other",
        "tz": "America/Toronto",
        "base_currency": "CAD",
    })

async def _create_group(client, headers):
    """Create a group and return its ID.

    Args:
        client: The async test client.
        headers: Auth headers for the requesting user.

    Returns:
        The created group's ID
    """
    resp = await client.post("/groups", json={"name": "Smith Family"}, headers=headers)
    return resp.json()["id"]

async def _setup_group_with_member(client):
    """Create a group with an admin (owner) and a regular member.

    Args:
        client: The async test client.

    Returns:
        Tuple of (admin_headers, member_headers, member_user_id, group_id)
    """
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, admin_headers)

    member_resp = await client.post("/auth/signup", json={
        "email": "member@example.com",
        "password": "SecurePassword123!",
        "first_name": "Member",
        "tz": "America/Toronto",
        "base_currency": "CAD",
    })
    member_headers = _get_auth_header(member_resp)
    member_user_id = member_resp.json()["user"]["id"]

    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": member_user_id},
        headers=admin_headers,
    )

    return admin_headers, member_headers, member_user_id, group_id
