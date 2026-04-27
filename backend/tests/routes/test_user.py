from datetime import UTC, date, datetime
from uuid import UUID

from sqlalchemy import update

from app.models.account import AccountBalanceSnapshot
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.currency import Currency
from app.models.transaction import Transaction
from tests.conftest import TestSession
from tests.routes.conftest import (
    SIGNUP_PAYLOAD,
    _create_account,
    _create_user,
    _get_auth_header,
)

# --- Helpers ---


async def _seed_usd():
    """Insert the USD currency row for currency-change tests."""
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()


# --- GET /me ---


async def test_get_me_returns_full_profile(client):
    """Authenticated GET /me returns all user profile fields."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/me", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["email"] == SIGNUP_PAYLOAD["email"]
    assert data["first_name"] == SIGNUP_PAYLOAD["first_name"]
    assert data["last_name"] is None
    assert data["profile_pic"] is None
    assert data["tz"] == SIGNUP_PAYLOAD["tz"]
    assert data["base_currency"] == SIGNUP_PAYLOAD["base_currency"]
    assert data["id"] is not None
    assert data["created_at"] is not None


async def test_get_me_without_auth_returns_401(client):
    """GET /me without an Authorization header returns 401."""
    resp = await client.get("/me")
    assert resp.status_code == 401


async def test_get_me_with_invalid_token_returns_401(client):
    """GET /me with a garbage Bearer token returns 401."""
    resp = await client.get("/me", headers={"Authorization": "Bearer garbage"})
    assert resp.status_code == 401


# --- PATCH /me ---


async def test_patch_updates_first_name(client):
    """PATCH /me updates first_name and returns the updated profile."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch("/me", json={"first_name": "Updated"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["first_name"] == "Updated"


async def test_patch_updates_last_name(client):
    """PATCH /me updates last_name."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch("/me", json={"last_name": "NewLast"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["last_name"] == "NewLast"


async def test_patch_updates_timezone(client):
    """PATCH /me updates timezone."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch("/me", json={"tz": "Europe/London"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["tz"] == "Europe/London"


async def test_patch_invalid_timezone_returns_422(client):
    """PATCH /me rejects non-IANA timezone names."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch("/me", json={"tz": "Toronto"}, headers=headers)

    assert resp.status_code == 422


async def test_patch_updates_base_currency(client):
    """PATCH /me updates base_currency when the new currency exists."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    await _seed_usd()

    resp = await client.patch("/me", json={"base_currency": "USD"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["base_currency"] == "USD"


async def test_patch_updates_multiple_fields(client):
    """PATCH /me updates multiple fields at once."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch("/me", json={"first_name": "Multi", "tz": "Asia/Tokyo"}, headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["first_name"] == "Multi"
    assert data["tz"] == "Asia/Tokyo"


async def test_patch_empty_body_returns_unchanged_profile(client):
    """PATCH /me with empty body returns 200 with no changes."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    before = await client.get("/me", headers=headers)
    resp = await client.patch("/me", json={}, headers=headers)

    assert resp.status_code == 200
    assert resp.json() == before.json()


async def test_patch_null_clears_nullable_field(client):
    """PATCH /me with null clears a nullable field."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    # Set last_name first
    await client.patch("/me", json={"last_name": "Temporary"}, headers=headers)
    # Clear it
    resp = await client.patch("/me", json={"last_name": None}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["last_name"] is None


async def test_patch_invalid_currency_returns_422(client):
    """PATCH /me with a non-existent currency code returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch("/me", json={"base_currency": "XXX"}, headers=headers)

    assert resp.status_code == 422


async def test_patch_empty_first_name_returns_422(client):
    """PATCH /me with empty first_name violates min_length and returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch("/me", json={"first_name": ""}, headers=headers)

    assert resp.status_code == 422


async def test_patch_short_currency_code_returns_422(client):
    """PATCH /me with a currency code shorter than 3 chars returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch("/me", json={"base_currency": "X"}, headers=headers)

    assert resp.status_code == 422


async def test_patch_null_first_name_returns_422(client):
    """PATCH /me with null first_name returns 422 (non-nullable field)."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch("/me", json={"first_name": None}, headers=headers)

    assert resp.status_code == 422


async def test_patch_null_tz_returns_422(client):
    """PATCH /me with null tz returns 422 (non-nullable field)."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch("/me", json={"tz": None}, headers=headers)

    assert resp.status_code == 422


async def test_patch_null_base_currency_returns_422(client):
    """PATCH /me with null base_currency returns 422 (non-nullable field)."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch("/me", json={"base_currency": None}, headers=headers)

    assert resp.status_code == 422


async def test_patch_extra_fields_are_ignored(client):
    """PATCH /me with unknown fields ignores them and doesn't change the profile."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    before = await client.get("/me", headers=headers)
    resp = await client.patch("/me", json={"foo": "bar"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json() == before.json()


async def test_patch_email_is_ignored(client):
    """PATCH /me cannot change email even if included in the body."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch("/me", json={"email": "hacker@evil.com"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["email"] == SIGNUP_PAYLOAD["email"]


async def test_patch_updates_profile_pic(client):
    """PATCH /me updates profile_pic."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch("/me", json={"profile_pic": "https://example.com/pic.jpg"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["profile_pic"] == "https://example.com/pic.jpg"


async def test_patch_without_auth_returns_401(client):
    """PATCH /me without an Authorization header returns 401."""
    resp = await client.patch("/me", json={"first_name": "Hacker"})
    assert resp.status_code == 401


async def test_patch_persists_across_requests(client):
    """PATCH /me changes are visible on subsequent GET /me."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await client.patch("/me", json={"first_name": "Persisted"}, headers=headers)
    resp = await client.get("/me", headers=headers)

    assert resp.status_code == 200
    assert resp.json()["first_name"] == "Persisted"


# --- PUT /me/runway-accounts ---


async def _signup_second_user(client):
    """Sign up a second user (assumes CAD currency is already seeded) and return auth headers."""
    resp = await client.post("/auth/signup", json={
        "email": "other@example.com",
        "password": "securepassword123",
        "first_name": "Other",
        "tz": "America/Toronto",
        "base_currency": "CAD",
    })
    return _get_auth_header(resp)


async def test_put_runway_accounts_isolates_across_users(client):
    """Each user's runway selection is scoped to themselves — A's PUT doesn't surface in B's GET."""
    signup_a = await _create_user(client)
    headers_a = _get_auth_header(signup_a)
    headers_b = await _signup_second_user(client)

    account_a_id = (await _create_account(client, headers_a, name="A's account")).json()["id"]
    account_b_id = (await _create_account(client, headers_b, name="B's account")).json()["id"]

    await client.put("/me/runway-accounts", json={"account_ids": [account_a_id]}, headers=headers_a)
    await client.put("/me/runway-accounts", json={"account_ids": [account_b_id]}, headers=headers_b)

    resp_a = await client.get("/me/runway-accounts", headers=headers_a)
    resp_b = await client.get("/me/runway-accounts", headers=headers_b)

    assert resp_a.status_code == 200
    assert resp_b.status_code == 200
    assert resp_a.json() == [account_a_id]
    assert resp_b.json() == [account_b_id]


async def test_put_runway_accounts_rejects_other_users_account(client):
    """User A cannot pin user B's account into their runway — returns 422 and A's selection stays empty."""
    signup_a = await _create_user(client)
    headers_a = _get_auth_header(signup_a)
    headers_b = await _signup_second_user(client)

    account_b_id = (await _create_account(client, headers_b, name="B's account")).json()["id"]

    resp = await client.put(
        "/me/runway-accounts",
        json={"account_ids": [account_b_id]},
        headers=headers_a,
    )

    assert resp.status_code == 422

    get_resp = await client.get("/me/runway-accounts", headers=headers_a)
    assert get_resp.json() == []


async def test_hidden_runway_selection_is_inactive_but_restorable(client, monkeypatch):
    """Hidden selected accounts are omitted from runway responses without deleting the stored pick."""
    from app.routes import user as user_routes

    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            instant = datetime(2026, 4, 15, 16, 0, tzinfo=UTC)
            return instant.astimezone(tz) if tz else instant

    monkeypatch.setattr(user_routes, "datetime", FixedDateTime)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]
    visible_account = (await _create_account(client, headers, name="Visible Cash")).json()
    hidden_account = (await _create_account(client, headers, name="Temporarily Hidden")).json()
    visible_account_id = visible_account["id"]
    hidden_account_id = hidden_account["id"]

    async with TestSession() as session:
        category = Category(owner_id=user_id, name="Test Expense", kind=CategoryKind.EXPENSE)
        session.add(category)
        await session.flush()
        session.add_all([
            Transaction(
                created_by_user_id=user_id,
                account_id=UUID(visible_account_id),
                category_id=category.id,
                dt=date(2026, 4, 1),
                amount=-12_000,
                currency="CAD",
            ),
            Transaction(
                created_by_user_id=user_id,
                account_id=UUID(hidden_account_id),
                category_id=category.id,
                dt=date(2026, 4, 2),
                amount=-24_000,
                currency="CAD",
            ),
            AccountBalanceSnapshot(account_id=UUID(visible_account_id), dt=date(2026, 4, 15), balance=120_000),
            AccountBalanceSnapshot(account_id=UUID(hidden_account_id), dt=date(2026, 4, 15), balance=48_000),
        ])
        for account, balance in [(visible_account, 120_000), (hidden_account, 48_000)]:
            await session.execute(
                update(AccountBalanceSnapshot)
                .where(
                    AccountBalanceSnapshot.account_id == UUID(account["id"]),
                    AccountBalanceSnapshot.dt == date.fromisoformat(account["created_at"][:10]),
                )
                .values(balance=balance),
            )
        await session.commit()

    await client.put(
        "/me/runway-accounts",
        json={"account_ids": [visible_account_id, hidden_account_id]},
        headers=headers,
    )
    await client.patch(f"/accounts/{hidden_account_id}", json={"is_hidden": True}, headers=headers)
    await client.put("/me/runway-accounts", json={"account_ids": [visible_account_id]}, headers=headers)

    hidden_list_resp = await client.get("/me/runway-accounts", headers=headers)
    hidden_runway_resp = await client.get("/me/runway", headers=headers)

    assert hidden_list_resp.status_code == 200
    assert hidden_list_resp.json() == [visible_account_id]
    assert hidden_runway_resp.status_code == 200
    hidden_runway = hidden_runway_resp.json()
    assert hidden_runway["liquid_balance"] == 120_000
    assert hidden_runway["avg_monthly_expense"] == 12_000

    await client.patch(f"/accounts/{hidden_account_id}", json={"is_hidden": False}, headers=headers)

    restored_list_resp = await client.get("/me/runway-accounts", headers=headers)
    restored_runway_resp = await client.get("/me/runway", headers=headers)

    assert restored_list_resp.status_code == 200
    assert set(restored_list_resp.json()) == {visible_account_id, hidden_account_id}
    restored_runway = restored_runway_resp.json()
    assert restored_runway["liquid_balance"] == 168_000
    assert restored_runway["avg_monthly_expense"] == 36_000


async def test_get_runway_uses_viewer_timezone_for_window_start(client, monkeypatch):
    """A Toronto viewer still treats Jan 1 01:00 UTC as Dec 31 for runway history."""
    from app.routes import user as user_routes

    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            instant = datetime(2026, 1, 1, 1, 0, tzinfo=UTC)
            return instant.astimezone(tz) if tz else instant

    monkeypatch.setattr(user_routes, "datetime", FixedDateTime)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]
    account_id = (await _create_account(client, headers)).json()["id"]

    async with TestSession() as session:
        category = Category(owner_id=user_id, name="Test Expense", kind=CategoryKind.EXPENSE)
        session.add(category)
        await session.flush()
        session.add(Transaction(
            created_by_user_id=user_id,
            account_id=account_id,
            category_id=category.id,
            dt=date(2025, 1, 1),
            amount=-12000,
            currency="CAD",
        ))
        session.add(AccountBalanceSnapshot(account_id=account_id, dt=date(2026, 12, 31), balance=120000))
        await session.commit()

    await client.put("/me/runway-accounts", json={"account_ids": [account_id]}, headers=headers)
    resp = await client.get("/me/runway", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["months_covered"] == 1
    assert data["avg_monthly_expense"] == 12000
    assert data["reason"] is None
