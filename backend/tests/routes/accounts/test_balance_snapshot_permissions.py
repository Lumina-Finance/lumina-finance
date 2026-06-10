"""Route tests for the account balance snapshot endpoints and lifecycle hooks."""


from tests.routes.accounts._balance_snapshot_helpers import (
    NONEXISTENT_ID,
    _create_group,
    _create_second_user,
    _grant_account_permission,
)
from tests.routes.support import _create_account, _create_user, _get_auth_header

# --- GET /accounts/{account_id}/snapshots — auth and permissions ---


async def test_list_snapshots_unauthenticated_returns_401(client):
    """Anonymous requests are rejected before reaching the handler."""
    resp = await client.get(f"/accounts/{NONEXISTENT_ID}/snapshots")
    assert resp.status_code == 401


async def test_list_snapshots_unknown_account_returns_404(client):
    """A nonexistent account UUID returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(f"/accounts/{NONEXISTENT_ID}/snapshots", headers=headers)
    assert resp.status_code == 404


async def test_list_snapshots_other_users_personal_account_returns_404(client):
    """A second user cannot enumerate the existence of a personal account they don't own."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    account_resp = await _create_account(client, headers)
    account_id = account_resp.json()["id"]

    other_headers, _ = await _create_second_user(client)

    resp = await client.get(f"/accounts/{account_id}/snapshots", headers=other_headers)
    assert resp.status_code == 404


async def test_list_snapshots_personal_owner_can_read_own_account(client):
    """A personal account owner can read their own snapshots."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = account_resp.json()["id"]

    resp = await client.get(f"/accounts/{account_id}/snapshots", headers=headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["balance"] == 0


async def test_list_snapshots_group_admin_can_read_group_account(client):
    """A group admin has implicit access to read group account snapshots."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, admin_headers)
    account_resp = await _create_account(client, admin_headers, group_id=group_id)
    account_id = account_resp.json()["id"]

    resp = await client.get(f"/accounts/{account_id}/snapshots", headers=admin_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["balance"] == 0


async def test_list_snapshots_non_group_user_returns_404(client):
    """A user who is not a member of the account's group at all gets 404.

    Distinct code path from "group member without permission": this user
    fails the membership lookup before any AccountPermission check.
    """
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, admin_headers)
    account_resp = await _create_account(client, admin_headers, group_id=group_id)
    account_id = account_resp.json()["id"]

    # Other user is intentionally NOT added to the group
    other_headers, _ = await _create_second_user(client)

    resp = await client.get(f"/accounts/{account_id}/snapshots", headers=other_headers)
    assert resp.status_code == 404


async def test_list_snapshots_group_member_with_read_permission_can_access(client):
    """A group member granted explicit READ on the account can read its snapshots."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, admin_headers)
    account_resp = await _create_account(client, admin_headers, group_id=group_id)
    account_id = account_resp.json()["id"]

    member_headers, member_user_id = await _create_second_user(client)
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": member_user_id},
        headers=admin_headers,
    )
    await _grant_account_permission(client, admin_headers, account_id, member_user_id, "read")

    resp = await client.get(f"/accounts/{account_id}/snapshots", headers=member_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["balance"] == 0


async def test_list_snapshots_group_member_without_permission_returns_404(client):
    """A group member with no explicit permission on the account gets 404, not 403."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, admin_headers)
    account_resp = await _create_account(client, admin_headers, group_id=group_id)
    account_id = account_resp.json()["id"]

    member_headers, member_user_id = await _create_second_user(client)
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": member_user_id},
        headers=admin_headers,
    )

    resp = await client.get(f"/accounts/{account_id}/snapshots", headers=member_headers)
    assert resp.status_code == 404


async def test_list_snapshots_group_member_with_write_permission_can_read(client):
    """WRITE access implies READ — a member with WRITE can read snapshots."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, admin_headers)
    account_resp = await _create_account(client, admin_headers, group_id=group_id)
    account_id = account_resp.json()["id"]

    member_headers, member_user_id = await _create_second_user(client)
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": member_user_id},
        headers=admin_headers,
    )
    await _grant_account_permission(client, admin_headers, account_id, member_user_id, "write")

    resp = await client.get(f"/accounts/{account_id}/snapshots", headers=member_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["balance"] == 0


async def test_list_snapshots_group_member_with_admin_permission_can_read(client):
    """ADMIN access also implies READ — locks in the WRITE < ADMIN ladder ordering."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, admin_headers)
    account_resp = await _create_account(client, admin_headers, group_id=group_id)
    account_id = account_resp.json()["id"]

    member_headers, member_user_id = await _create_second_user(client)
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": member_user_id},
        headers=admin_headers,
    )
    await _grant_account_permission(client, admin_headers, account_id, member_user_id, "admin")

    resp = await client.get(f"/accounts/{account_id}/snapshots", headers=member_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["balance"] == 0
