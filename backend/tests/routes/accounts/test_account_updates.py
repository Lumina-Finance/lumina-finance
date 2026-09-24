import importlib
from datetime import timedelta

from app.models.base import CategoryKind
from tests.routes.accounts._account_helpers import (
    NONEXISTENT_ID,
    _archive_adjustment_rows,
    _clock_on_account_day,
    _created_at_in_tz,
    _latest_snapshot_balance,
    _seed_institution,
)
from tests.routes.accounts._balance_snapshot_helpers import _create_category, _create_transaction
from tests.routes.support import ACCOUNT_PAYLOAD, _create_account, _create_user, _get_auth_header

# --- PATCH /accounts/{account_id} ---


async def test_patch_account_updates_name(client):
    """PATCH updates name and returns the updated account."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    resp = await client.patch(f"/accounts/{account_id}", json={"name": "Renamed"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["name"] == "Renamed"
    assert resp.json()["can_write"] is True


async def test_patch_account_updates_is_archived(client):
    """PATCH toggles is_archived."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    resp = await client.patch(f"/accounts/{account_id}", json={"is_archived": True}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["is_archived"] is True
    assert resp.json()["can_write"] is True


async def test_patch_account_archiving_non_zero_balance_creates_balance_adjustment(client, monkeypatch):
    """Archiving a non-zero account records a balance adjustment to zero it out."""
    account_routes = importlib.import_module("app.routes.accounts.router")

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers, starting_balance=12_500)
    account_data = create_resp.json()
    account_id = account_data["id"]
    archive_dt = _created_at_in_tz(account_data, "America/Toronto")
    monkeypatch.setattr(account_routes, "datetime", _clock_on_account_day(account_data, "America/Toronto"))

    resp = await client.patch(f"/accounts/{account_id}", json={"is_archived": True}, headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["is_archived"] is True
    assert data["current_balance"] == 0
    assert await _latest_snapshot_balance(account_id) == 0

    rows = await _archive_adjustment_rows(account_id)
    assert len(rows) == 1
    txn, category = rows[0]
    assert txn.amount == -12_500
    assert txn.currency == "CAD"
    assert txn.dt == archive_dt
    assert category.name == "Balance Adjustment"
    assert category.kind == CategoryKind.TRANSFER


async def test_patch_account_archiving_zero_balance_skips_balance_adjustment(client, monkeypatch):
    """Archiving an already-zero account does not create a balance adjustment."""
    account_routes = importlib.import_module("app.routes.accounts.router")

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_data = create_resp.json()
    account_id = account_data["id"]
    monkeypatch.setattr(account_routes, "datetime", _clock_on_account_day(account_data, "America/Toronto"))

    resp = await client.patch(f"/accounts/{account_id}", json={"is_archived": True}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["is_archived"] is True
    assert resp.json()["current_balance"] == 0
    assert await _archive_adjustment_rows(account_id) == []


async def test_patch_account_archiving_is_blocked_by_transactions_dated_after_today(client, monkeypatch):
    """A later-dated transaction flags the account and refuses archiving, which would leave it off zero."""
    account_routes = importlib.import_module("app.routes.accounts.router")

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers, starting_balance=12_500)
    account_data = create_resp.json()
    account_id = account_data["id"]
    archive_dt = _created_at_in_tz(account_data, "America/Toronto")
    monkeypatch.setattr(account_routes, "datetime", _clock_on_account_day(account_data, "America/Toronto"))

    # The starting balance is dated today, which does not block archiving
    same_day = await client.get(f"/accounts/{account_id}", headers=headers)
    assert same_day.json()["has_transactions_after_today"] is False

    category_id = (await _create_category(client, headers)).json()["id"]
    future = await _create_transaction(
        client, headers, account_id, category_id, dt=(archive_dt + timedelta(days=1)).isoformat(), amount=5_000,
    )
    assert future.status_code == 201
    blocked = await client.get(f"/accounts/{account_id}", headers=headers)
    assert blocked.json()["has_transactions_after_today"] is True

    resp = await client.patch(f"/accounts/{account_id}", json={"is_archived": True}, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == (
        "This account can't be archived because it has future dated transactions. "
        "Please delete them or adjust date before archiving the account."
    )
    assert await _archive_adjustment_rows(account_id) == []
    account = await client.get(f"/accounts/{account_id}", headers=headers)
    assert account.json()["is_archived"] is False


async def test_patch_account_archiving_is_idempotent(client, monkeypatch):
    """Archiving an already-archived account does not create another adjustment."""
    account_routes = importlib.import_module("app.routes.accounts.router")

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers, starting_balance=25_000)
    account_data = create_resp.json()
    account_id = account_data["id"]
    monkeypatch.setattr(account_routes, "datetime", _clock_on_account_day(account_data, "America/Toronto"))

    first = await client.patch(f"/accounts/{account_id}", json={"is_archived": True}, headers=headers)
    second = await client.patch(f"/accounts/{account_id}", json={"is_archived": True}, headers=headers)

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["current_balance"] == 0
    rows = await _archive_adjustment_rows(account_id)
    assert len(rows) == 1
    assert rows[0][0].amount == -25_000


async def test_patch_account_unarchiving_keeps_zeroed_balance(client, monkeypatch):
    """Unarchiving does not reverse the archive balance adjustment."""
    account_routes = importlib.import_module("app.routes.accounts.router")

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers, starting_balance=42_000)
    account_data = create_resp.json()
    account_id = account_data["id"]
    monkeypatch.setattr(account_routes, "datetime", _clock_on_account_day(account_data, "America/Toronto"))

    archive_resp = await client.patch(f"/accounts/{account_id}", json={"is_archived": True}, headers=headers)
    unarchive_resp = await client.patch(f"/accounts/{account_id}", json={"is_archived": False}, headers=headers)

    assert archive_resp.status_code == 200
    assert unarchive_resp.status_code == 200
    assert unarchive_resp.json()["is_archived"] is False
    assert unarchive_resp.json()["current_balance"] == 0
    rows = await _archive_adjustment_rows(account_id)
    assert len(rows) == 1
    assert rows[0][0].amount == -42_000


async def test_patch_account_empty_body_returns_unchanged(client):
    """PATCH with empty body returns 200 with no changes."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    before = await client.get(f"/accounts/{account_id}", headers=headers)
    resp = await client.patch(f"/accounts/{account_id}", json={}, headers=headers)

    assert resp.status_code == 200
    assert resp.json() == before.json()


async def test_patch_account_explicit_null_name_returns_422(client):
    """Explicit null on name would violate NOT NULL — reject with 422 before touching the DB."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    resp = await client.patch(f"/accounts/{account_id}", json={"name": None}, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "name cannot be null"


async def test_patch_account_explicit_null_is_archived_returns_422(client):
    """Explicit null on is_archived would violate NOT NULL — reject with 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    resp = await client.patch(f"/accounts/{account_id}", json={"is_archived": None}, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "is_archived cannot be null"


async def test_patch_account_not_found_returns_404(client):
    """PATCH non-existent account returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch(f"/accounts/{NONEXISTENT_ID}", json={"name": "X"}, headers=headers)

    assert resp.status_code == 404


async def test_patch_account_without_auth_returns_401(client):
    """PATCH /accounts/{id} without an Authorization header returns 401."""
    resp = await client.patch(f"/accounts/{NONEXISTENT_ID}", json={"name": "X"})
    assert resp.status_code == 401


async def test_patch_account_clears_institution(client):
    """PATCH with institution_id=null detaches the account from its institution."""
    inst = await _seed_institution()
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers, institution_id=str(inst.id))
    account_id = create_resp.json()["id"]

    resp = await client.patch(f"/accounts/{account_id}", json={"institution_id": None}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["institution"] is None


async def test_patch_account_invalid_institution_returns_422(client):
    """PATCH with non-existent institution_id returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/accounts/{account_id}",
        json={"institution_id": NONEXISTENT_ID},
        headers=headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Institution not found"


async def test_patch_account_immutable_fields_ignored(client):
    """PATCH cannot change account_kind, account_type, or currency — extra fields are ignored."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/accounts/{account_id}",
        json={"account_kind": "revolving", "account_type": "credit_card", "currency": "USD"},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["account_kind"] == ACCOUNT_PAYLOAD["account_kind"]
    assert data["account_type"] == ACCOUNT_PAYLOAD["account_type"]
    assert data["currency"] == ACCOUNT_PAYLOAD["currency"]
