"""Route tests for the account balance snapshot endpoints and lifecycle hooks."""
from datetime import date

from tests.routes.accounts._balance_snapshot_helpers import (
    _creation_day,
    _seed_three_day_history,
)
from tests.routes.support import _create_account, _create_user, _get_auth_header

# --- GET /accounts/{account_id}/snapshots — listing and date filters ---


async def test_list_snapshots_returns_all_in_ascending_order(client):
    """The endpoint returns every snapshot for the account ordered dt ascending."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = account_resp.json()["id"]
    await _seed_three_day_history(client, headers, account_id)

    resp = await client.get(f"/accounts/{account_id}/snapshots", headers=headers)
    assert resp.status_code == 200

    snapshots = resp.json()
    assert len(snapshots) == 3
    timestamps = [s["dt"] for s in snapshots]
    assert timestamps == sorted(timestamps)
    assert snapshots[0]["balance"] == 1000
    assert snapshots[1]["balance"] == 3000
    assert snapshots[2]["balance"] == 6000


async def test_list_snapshots_filters_by_from_date(client):
    """from_date excludes snapshots strictly before the bound (inclusive boundary)

    Passing from_date equal to a snapshot's ts includes that snapshot
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = account_resp.json()["id"]
    await _seed_three_day_history(client, headers, account_id)

    resp = await client.get(
        f"/accounts/{account_id}/snapshots",
        params={"from_date": "2026-03-05"},
        headers=headers,
    )
    assert resp.status_code == 200

    snapshots = resp.json()
    assert len(snapshots) == 2
    assert snapshots[0]["balance"] == 3000
    assert snapshots[1]["balance"] == 6000


async def test_list_snapshots_filters_by_to_date(client):
    """to_date excludes snapshots strictly after the bound (inclusive boundary)

    Passing to_date equal to a snapshot's ts includes that snapshot
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = account_resp.json()["id"]
    await _seed_three_day_history(client, headers, account_id)

    resp = await client.get(
        f"/accounts/{account_id}/snapshots",
        params={"to_date": "2026-03-05"},
        headers=headers,
    )
    assert resp.status_code == 200

    snapshots = resp.json()
    assert len(snapshots) == 2
    assert snapshots[0]["balance"] == 1000
    assert snapshots[1]["balance"] == 3000


async def test_list_snapshots_filters_by_both_date_bounds(client):
    """Both bounds combined return only snapshots inside the inclusive range."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = account_resp.json()["id"]
    await _seed_three_day_history(client, headers, account_id)

    resp = await client.get(
        f"/accounts/{account_id}/snapshots",
        params={
            "from_date": "2026-03-04",
            "to_date": "2026-03-06",
        },
        headers=headers,
    )
    assert resp.status_code == 200

    snapshots = resp.json()
    assert len(snapshots) == 1
    assert snapshots[0]["balance"] == 3000


async def test_list_snapshots_with_zero_width_date_range_returns_only_that_day(client):
    """from_date == to_date covering one snapshot's day returns exactly that snapshot."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = account_resp.json()["id"]
    await _seed_three_day_history(client, headers, account_id)

    resp = await client.get(
        f"/accounts/{account_id}/snapshots",
        params={
            "from_date": "2026-03-05",
            "to_date": "2026-03-05",
        },
        headers=headers,
    )
    assert resp.status_code == 200

    snapshots = resp.json()
    assert len(snapshots) == 1
    assert snapshots[0]["balance"] == 3000


async def test_list_snapshots_returns_empty_when_no_snapshots_in_range(client):
    """A date range that excludes all snapshots returns an empty list, not 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = account_resp.json()["id"]
    await _seed_three_day_history(client, headers, account_id)

    resp = await client.get(
        f"/accounts/{account_id}/snapshots",
        params={
            "from_date": "2027-01-01",
            "to_date": "2027-12-31",
        },
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_snapshots_returns_zero_anchor_for_new_account(client):
    """A brand-new account with no transactions returns just the zero anchor on its creation day."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = account_resp.json()["id"]
    expected_anchor_dt = _creation_day(account_resp)

    resp = await client.get(f"/accounts/{account_id}/snapshots", headers=headers)
    assert resp.status_code == 200

    snapshots = resp.json()
    assert len(snapshots) == 1
    assert snapshots[0]["balance"] == 0
    assert date.fromisoformat(snapshots[0]["dt"]) == expected_anchor_dt


async def test_list_snapshots_on_closed_account_still_returns_history(client):
    """Read-only endpoint must return snapshots even after the account is closed

    Closed accounts are still meaningful for historical balance charts; the
    handler intentionally does NOT pass require_open=True to check_account_access
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = account_resp.json()["id"]
    await _seed_three_day_history(client, headers, account_id)

    # Close the account
    close_resp = await client.patch(
        f"/accounts/{account_id}",
        json={"closed_at": "2026-04-01"},
        headers=headers,
    )
    assert close_resp.status_code == 200

    resp = await client.get(f"/accounts/{account_id}/snapshots", headers=headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 3
