from datetime import date, datetime
from decimal import Decimal
from uuid import UUID
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import delete, func, select, update

from app.models.account import Account, AccountBalanceSnapshot
from app.models.base import CategoryKind, InstitutionStatus
from app.models.category import Category
from app.models.currency import Currency
from app.models.institution import Institution
from app.models.transaction import Transaction
from tests.conftest import TestSession
from tests.routes.conftest import ACCOUNT_PAYLOAD, _create_account, _create_user, _get_auth_header, _seed_currency

# --- Helpers ---

NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000"


class _FixedClock:
    def __init__(self, instant):
        self.instant = instant

    def now(self, tz=None):
        return self.instant.astimezone(tz) if tz else self.instant


async def _seed_institution(logo_url: str | None = None):
    """Insert a canonical institution for FK tests.

    Inserts via raw session (not the API) because institutions are seeded data,
    not user-created resources.

    Returns:
        The persisted Institution ORM instance.
    """
    async with TestSession() as session:
        inst = Institution(
            status=InstitutionStatus.CANONICAL,
            name="Test Bank",
            country_code="CA",
            website="https://testbank.example.com",
            logo_url=logo_url,
        )
        session.add(inst)
        await session.commit()
        await session.refresh(inst)
        return inst


async def _create_second_user(client):
    """Sign up a second user for ownership-isolation tests.

    Args:
        client: The async test client.

    Returns:
        The HTTP response from the signup endpoint.
    """
    return await client.post("/auth/signup", json={
        "email": "other@example.com",
        "password": "securepassword123",
        "first_name": "Other",
        "tz": "America/Toronto",
        "base_currency": "CAD",
    })


async def _signup_user(client, *, email: str, first_name: str, tz: str):
    return await client.post("/auth/signup", json={
        "email": email,
        "password": "securepassword123",
        "first_name": first_name,
        "tz": tz,
        "base_currency": "CAD",
    })


def _created_at_in_tz(account_data: dict, tz: str) -> date:
    return datetime.fromisoformat(account_data["created_at"]).astimezone(ZoneInfo(tz)).date()


def _clock_on_account_day(account_data: dict, tz: str) -> _FixedClock:
    dt = _created_at_in_tz(account_data, tz)
    return _FixedClock(datetime(dt.year, dt.month, dt.day, 16, 0, tzinfo=ZoneInfo(tz)))


async def _archive_adjustment_rows(account_id: str):
    async with TestSession() as session:
        return (await session.execute(
            select(Transaction, Category)
            .join(Category, Category.id == Transaction.category_id)
            .where(
                Transaction.account_id == UUID(account_id),
                Transaction.notes == "Account archived",
            )
            .order_by(Transaction.created_at),
        )).all()


async def _latest_snapshot_balance(account_id: str) -> int:
    async with TestSession() as session:
        balance = await session.scalar(
            select(AccountBalanceSnapshot.balance)
            .where(AccountBalanceSnapshot.account_id == UUID(account_id))
            .order_by(AccountBalanceSnapshot.dt.desc())
            .limit(1),
        )
        assert balance is not None
        return balance


# --- GET /accounts ---


async def test_list_accounts_returns_empty_list(client):
    """User with no accounts gets an empty list."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/accounts", headers=headers)

    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_accounts_returns_user_accounts(client):
    """User sees only their own accounts."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await _create_account(client, headers, name="Account A")
    await _create_account(client, headers, name="Account B")

    resp = await client.get("/accounts", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    names = {a["name"] for a in data}
    assert names == {"Account A", "Account B"}


async def test_list_accounts_returns_overview_shape(client):
    """List endpoint returns the trimmed AccountsOverview shape, not the detail shape."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    await _create_account(client, headers)

    resp = await client.get("/accounts", headers=headers)

    assert resp.status_code == 200
    row = resp.json()[0]
    # Detail-only and plan-level tax fields are excluded from the overview shape
    assert "created_at" not in row
    for field in (
        "tax_treatment",
        "lifetime_contribution_limit",
        "ytd_contributions",
        "ytd_withdrawals",
        "lifetime_contributions",
        "lifetime_withdrawals",
        "current_year_contribution_limit",
        "current_year_withdrawal_limit",
    ):
        assert field not in row
    # Overview fields are present
    for field in (
        "id", "owner_id", "group_id", "account_kind", "account_type", "name",
        "tax_advantaged_plan_id", "currency", "institution", "current_balance",
        "base_currency_current_balance", "current_balance_fx_status", "credit_limit",
        "is_archived", "closed_at",
    ):
        assert field in row, f"missing overview field: {field}"


async def test_list_accounts_current_balance_starts_at_zero(client):
    """Newly created accounts have a zero anchor snapshot, so current_balance is 0 in the list."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    await _create_account(client, headers)

    resp = await client.get("/accounts", headers=headers)

    assert resp.status_code == 200
    assert resp.json()[0]["current_balance"] == 0


async def test_list_accounts_current_balance_uses_latest_snapshot(client):
    """When multiple snapshots exist for an account, list returns the most recent balance."""
    from uuid import UUID

    from app.models.account import AccountBalanceSnapshot

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = UUID(create_resp.json()["id"])

    # Insert two snapshots after the zero anchor: the older of the two (12345)
    # and the newer (98765). Helper should return the most recent.
    async with TestSession() as session:
        session.add(AccountBalanceSnapshot(
            account_id=account_id,
            dt=date(2027, 1, 1),
            balance=12345,
        ))
        session.add(AccountBalanceSnapshot(
            account_id=account_id,
            dt=date(2027, 6, 1),
            balance=98765,
        ))
        await session.commit()

    resp = await client.get("/accounts", headers=headers)

    assert resp.status_code == 200
    assert resp.json()[0]["current_balance"] == 98765


async def test_list_accounts_converts_current_balance_to_user_base_currency(client, monkeypatch):
    """List rows expose a converted current balance for overview stats."""
    from datetime import UTC

    from app.routes import account as account_routes
    from app.services.fx import FrankfurterProvider

    calls = []

    async def fake_get_rate(self, base, quote, rate_date):
        calls.append((base, quote, rate_date))
        return Decimal("1.5")

    monkeypatch.setattr(account_routes, "datetime", _FixedClock(datetime(2026, 3, 20, 16, 0, tzinfo=UTC)))
    monkeypatch.setattr(FrankfurterProvider, "get_rate", fake_get_rate)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()

    cad_account = (await _create_account(client, headers, name="CAD Cash")).json()
    usd_account = (await _create_account(client, headers, name="USD Cash", currency="USD")).json()

    async with TestSession() as session:
        await session.execute(
            update(AccountBalanceSnapshot)
            .where(AccountBalanceSnapshot.account_id == UUID(cad_account["id"]))
            .values(balance=100_00),
        )
        await session.execute(
            update(AccountBalanceSnapshot)
            .where(AccountBalanceSnapshot.account_id == UUID(usd_account["id"]))
            .values(balance=200_00),
        )
        await session.commit()

    resp = await client.get("/accounts", headers=headers)

    assert resp.status_code == 200
    rows = {row["name"]: row for row in resp.json()}
    assert rows["CAD Cash"]["current_balance"] == 100_00
    assert rows["CAD Cash"]["base_currency_current_balance"] == 100_00
    assert rows["CAD Cash"]["current_balance_fx_status"] == {"state": "none", "missing_pairs": []}
    assert rows["USD Cash"]["current_balance"] == 200_00
    assert rows["USD Cash"]["base_currency_current_balance"] == 300_00
    assert rows["USD Cash"]["current_balance_fx_status"] == {"state": "complete", "missing_pairs": []}
    assert calls == [("USD", "CAD", date(2026, 3, 20))]


async def test_list_accounts_reports_current_balance_fx_failure(client, monkeypatch):
    """Rows with unconverted foreign balances report the missing pair."""
    from datetime import UTC

    from app.routes import account as account_routes
    from app.services.fx import FrankfurterProvider, FxRateNotFoundError

    async def fake_get_rate(self, base, quote, rate_date):
        raise FxRateNotFoundError()

    monkeypatch.setattr(account_routes, "datetime", _FixedClock(datetime(2026, 3, 20, 16, 0, tzinfo=UTC)))
    monkeypatch.setattr(FrankfurterProvider, "get_rate", fake_get_rate)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    async with TestSession() as session:
        session.add(Currency(id="ABC", name="Unsupported Test Currency", symbol="A", minor_unit_exponent=2))
        await session.commit()

    account = (await _create_account(client, headers, name="ABC Cash", currency="ABC")).json()

    async with TestSession() as session:
        await session.execute(
            update(AccountBalanceSnapshot)
            .where(AccountBalanceSnapshot.account_id == UUID(account["id"]))
            .values(balance=200_00),
        )
        await session.commit()

    resp = await client.get("/accounts", headers=headers)

    assert resp.status_code == 200
    row = resp.json()[0]
    assert row["current_balance"] == 200_00
    assert row["base_currency_current_balance"] == 0
    assert row["current_balance_fx_status"] == {
        "state": "incomplete",
        "missing_pairs": [{"base": "ABC", "quote": "CAD"}],
    }


async def test_get_account_returns_current_balance(client):
    """Single-account fetch also returns current_balance."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    resp = await client.get(f"/accounts/{account_id}", headers=headers)

    assert resp.status_code == 200
    assert resp.json()["current_balance"] == 0


async def test_create_account_returns_current_balance(client):
    """POST /accounts response includes current_balance from the just-inserted zero anchor."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(client, headers)

    assert resp.status_code == 201
    assert resp.json()["current_balance"] == 0


async def test_create_account_with_starting_balance_creates_adjustment(client):
    """Non-zero starting_balance creates a Balance Adjustment transaction."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = UUID(signup_resp.json()["user"]["id"])

    resp = await _create_account(client, headers, starting_balance=123_45)

    assert resp.status_code == 201
    data = resp.json()
    assert data["current_balance"] == 123_45
    account_id = UUID(data["id"])
    expected_dt = _created_at_in_tz(data, "America/Toronto")

    async with TestSession() as session:
        result = await session.execute(
            select(Transaction, Category)
            .join(Category, Transaction.category_id == Category.id)
            .where(Transaction.account_id == account_id)
            .order_by(Transaction.dt, Transaction.created_at, Transaction.id),
        )
        rows = result.all()
        snapshots_result = await session.execute(
            select(AccountBalanceSnapshot).where(AccountBalanceSnapshot.account_id == account_id),
        )
        snapshots = snapshots_result.scalars().all()

    assert len(rows) == 1
    txn, category = rows[0]
    assert len(snapshots) == 1
    snapshot = snapshots[0]
    assert txn.created_by_user_id == user_id
    assert txn.account_id == account_id
    assert txn.dt == expected_dt
    assert txn.merchant_id is None
    assert txn.fx_rate is None
    assert txn.amount == 123_45
    assert txn.currency == data["currency"]
    assert txn.notes == "Starting balance"
    assert category.name == "Balance Adjustment"
    assert category.kind == CategoryKind.TRANSFER
    assert category.is_system is True
    assert category.owner_id is None
    assert category.group_id is None
    assert snapshot.account_id == account_id
    assert snapshot.dt == expected_dt
    assert snapshot.balance == 123_45

    detail_resp = await client.get(f"/accounts/{account_id}", headers=headers)
    list_resp = await client.get("/accounts", headers=headers)

    assert detail_resp.status_code == 200
    assert detail_resp.json()["current_balance"] == 123_45
    assert list_resp.status_code == 200
    assert list_resp.json()[0]["current_balance"] == 123_45


async def test_create_group_account_starting_balance_uses_group_owner_creation_day(client):
    """Group-account starting balances are dated in the group owner's timezone."""
    await _seed_currency()
    owner_resp = await _signup_user(
        client,
        email="owner@example.com",
        first_name="Owner",
        tz="Pacific/Kiritimati",
    )
    member_resp = await _signup_user(
        client,
        email="member@example.com",
        first_name="Member",
        tz="America/Adak",
    )
    owner_headers = _get_auth_header(owner_resp)
    member_headers = _get_auth_header(member_resp)
    member_user_id = member_resp.json()["user"]["id"]

    group_resp = await client.post("/groups", json={"name": "Global Household"}, headers=owner_headers)
    assert group_resp.status_code == 201
    group_id = group_resp.json()["id"]
    add_member_resp = await client.post(f"/groups/{group_id}/members", json={"user_id": member_user_id}, headers=owner_headers)
    assert add_member_resp.status_code == 201
    promote_resp = await client.patch(f"/groups/{group_id}/members/{member_user_id}", json={"is_admin": True}, headers=owner_headers)
    assert promote_resp.status_code == 200

    resp = await _create_account(client, member_headers, group_id=group_id, starting_balance=50_00)

    assert resp.status_code == 201
    data = resp.json()
    account_id = UUID(data["id"])
    owner_local_dt = _created_at_in_tz(data, "Pacific/Kiritimati")
    acting_user_local_dt = _created_at_in_tz(data, "America/Adak")
    assert owner_local_dt != acting_user_local_dt

    async with TestSession() as session:
        txn = await session.scalar(select(Transaction).where(Transaction.account_id == account_id))
        snapshot = await session.scalar(select(AccountBalanceSnapshot).where(AccountBalanceSnapshot.account_id == account_id))

    assert txn is not None
    assert snapshot is not None
    assert txn.dt == owner_local_dt
    assert snapshot.dt == owner_local_dt
    assert txn.dt != acting_user_local_dt
    assert snapshot.balance == 50_00


async def test_create_account_starting_balance_rolls_back_if_balance_adjustment_category_missing(client):
    """Missing Balance Adjustment configuration does not leave partial account rows."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    async with TestSession() as session:
        await session.execute(delete(Category).where(Category.name == "Balance Adjustment", Category.is_system.is_(True)))
        await session.commit()

    resp = await _create_account(client, headers, starting_balance=100_00)

    assert resp.status_code == 500
    assert resp.json()["detail"] == "Balance adjustment category is not configured"

    async with TestSession() as session:
        account_count = await session.scalar(select(func.count(Account.id)))
        transaction_count = await session.scalar(select(func.count(Transaction.id)))
        snapshot_count = await session.scalar(select(func.count(AccountBalanceSnapshot.account_id)))

    assert account_count == 0
    assert transaction_count == 0
    assert snapshot_count == 0


async def test_create_revolving_account_with_signed_starting_balance(client):
    """Liability starting balances are accepted as signed debt values."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(
        client,
        headers,
        account_kind="revolving",
        account_type="credit_card",
        name="Visa",
        starting_balance=-42_42,
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["current_balance"] == -42_42
    account_id = UUID(data["id"])
    expected_dt = _created_at_in_tz(data, "America/Toronto")

    async with TestSession() as session:
        txn = await session.scalar(select(Transaction).where(Transaction.account_id == account_id))
        snapshot = await session.scalar(select(AccountBalanceSnapshot).where(AccountBalanceSnapshot.account_id == account_id))

    assert txn is not None
    assert snapshot is not None
    assert txn.dt == expected_dt
    assert txn.amount == -42_42
    assert txn.notes == "Starting balance"
    assert snapshot.dt == expected_dt
    assert snapshot.balance == -42_42


@pytest.mark.parametrize("starting_balance", [None, 0])
async def test_create_account_without_nonzero_starting_balance_creates_no_adjustment(client, starting_balance):
    """Null and zero starting balances keep the zero anchor and skip a transaction row."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(client, headers, starting_balance=starting_balance)

    assert resp.status_code == 201
    data = resp.json()
    assert data["current_balance"] == 0
    account_id = UUID(data["id"])
    expected_dt = _created_at_in_tz(data, "America/Toronto")

    async with TestSession() as session:
        transaction_id = await session.scalar(select(Transaction.id).where(Transaction.account_id == account_id))
        snapshot = await session.scalar(
            select(AccountBalanceSnapshot).where(AccountBalanceSnapshot.account_id == account_id),
        )

    assert transaction_id is None
    assert snapshot is not None
    assert snapshot.dt == expected_dt
    assert snapshot.balance == 0


async def test_list_accounts_without_auth_returns_401(client):
    """GET /accounts without an Authorization header returns 401."""
    resp = await client.get("/accounts")
    assert resp.status_code == 401


# --- GET /accounts/{account_id} ---


async def test_get_account_returns_account(client):
    """Valid account ID returns the account with all fields."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    resp = await client.get(f"/accounts/{account_id}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == account_id
    assert data["owner_id"] is not None
    assert data["group_id"] is None
    assert data["account_kind"] == ACCOUNT_PAYLOAD["account_kind"]
    assert data["account_type"] == ACCOUNT_PAYLOAD["account_type"]
    assert data["name"] == ACCOUNT_PAYLOAD["name"]
    assert data["institution"] is None
    assert data["currency"] == ACCOUNT_PAYLOAD["currency"]
    assert data["current_balance"] == 0
    assert data["credit_limit"] is None
    for field in (
        "tax_treatment",
        "lifetime_contribution_limit",
        "ytd_contributions",
        "ytd_withdrawals",
        "lifetime_contributions",
        "lifetime_withdrawals",
        "current_year_contribution_limit",
        "current_year_withdrawal_limit",
    ):
        assert field not in data
    assert data["is_archived"] is False
    assert data["closed_at"] is None
    assert data["created_at"] is not None


async def test_get_account_not_found_returns_404(client):
    """Non-existent account ID returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(f"/accounts/{NONEXISTENT_ID}", headers=headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Account not found"


async def test_get_account_other_user_returns_404(client):
    """Accessing another user's account returns 404, not 403."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await client.get(f"/accounts/{account_id}", headers=other_headers)

    assert resp.status_code == 404


async def test_get_account_without_auth_returns_401(client):
    """GET /accounts/{id} without an Authorization header returns 401."""
    resp = await client.get(f"/accounts/{NONEXISTENT_ID}")
    assert resp.status_code == 401


async def test_legacy_tax_advantaged_config_route_removed(client):
    """Old account-level tax config routes are no longer part of the API."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    account_id = (await _create_account(client, headers)).json()["id"]

    resp = await client.get(f"/accounts/{account_id}/tax-advantaged-configs", headers=headers)

    assert resp.status_code == 404


# --- POST /accounts ---


async def test_create_account_returns_201(client):
    """Valid payload creates an account with correct fields."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(client, headers)

    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == ACCOUNT_PAYLOAD["name"]
    assert data["account_type"] == ACCOUNT_PAYLOAD["account_type"]
    assert data["currency"] == ACCOUNT_PAYLOAD["currency"]
    assert data["is_archived"] is False
    assert data["id"] is not None
    assert data["created_at"] is not None


async def test_create_account_with_institution(client):
    """Account can be linked to an existing institution; response embeds the summary."""
    inst = await _seed_institution(logo_url="https://cdn.example.com/testbank.png")
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(client, headers, institution_id=str(inst.id))

    assert resp.status_code == 201
    institution = resp.json()["institution"]
    assert institution is not None
    assert institution["id"] == str(inst.id)
    assert institution["name"] == inst.name
    assert institution["website"] == inst.website
    assert institution["logo_url"] == "https://cdn.example.com/testbank.png"


async def test_create_account_invalid_account_type_returns_422(client):
    """Invalid account_type returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(client, headers, account_type="not_a_real_type")

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Invalid account type"


async def test_create_account_invalid_account_kind_returns_422(client):
    """Invalid account_kind returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(client, headers, account_kind="not_a_real_kind")

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Invalid account kind"


async def test_create_account_kind_type_mismatch_returns_422(client):
    """Submitting kind=asset with a liability type (or vice versa) returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(client, headers, account_kind="asset", account_type="credit_card")

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Account kind does not match account type"


async def test_create_account_missing_kind_returns_422(client):
    """Pydantic rejects payloads missing the required account_kind field."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    payload = {k: v for k, v in ACCOUNT_PAYLOAD.items() if k != "account_kind"}
    resp = await client.post("/accounts", json=payload, headers=headers)

    assert resp.status_code == 422


async def test_create_liability_account_succeeds(client):
    """Creating a liability account (credit_card) with kind=liability is accepted and round-trips."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(
        client, headers, account_kind="revolving", account_type="credit_card", name="Visa Infinite",
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["account_kind"] == "revolving"
    assert data["account_type"] == "credit_card"


async def test_create_liability_with_credit_limit_succeeds(client):
    """Setting credit_limit on a liability account is accepted and round-trips."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(
        client, headers,
        account_kind="revolving", account_type="credit_card", name="Visa", credit_limit=500_000,
    )

    assert resp.status_code == 201
    assert resp.json()["credit_limit"] == 500_000


async def test_create_liability_without_credit_limit_defaults_null(client):
    """Liability accounts without credit_limit serialize the field as null."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(
        client, headers, account_kind="revolving", account_type="credit_card", name="Visa",
    )

    assert resp.status_code == 201
    assert resp.json()["credit_limit"] is None


async def test_create_asset_with_credit_limit_returns_422(client):
    """Setting credit_limit on an asset account is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(client, headers, credit_limit=500_000)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "credit_limit is only valid on revolving-credit accounts"


async def test_update_liability_credit_limit_succeeds(client):
    """Patching credit_limit on a liability account is accepted."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(
        client, headers, account_kind="revolving", account_type="credit_card", name="Visa",
    )
    account_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/accounts/{account_id}", json={"credit_limit": 750_000}, headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["credit_limit"] == 750_000


async def test_update_asset_credit_limit_returns_422(client):
    """Patching credit_limit on an asset account is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/accounts/{account_id}", json={"credit_limit": 500_000}, headers=headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "credit_limit is only valid on revolving-credit accounts"


async def test_create_account_invalid_currency_returns_422(client):
    """Non-existent currency code returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(client, headers, currency="XXX")

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Invalid currency code"


async def test_create_account_invalid_institution_returns_422(client):
    """Non-existent institution ID returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(client, headers, institution_id=str(NONEXISTENT_ID))

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Institution not found"


async def test_create_account_empty_name_returns_422(client):
    """Empty name returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(client, headers, name="")

    assert resp.status_code == 422


async def test_create_account_missing_field_returns_422(client):
    """Missing a required field returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    # Missing both currency and account_kind — Pydantic rejects either omission
    payload = {"name": "Test", "account_type": "checking"}
    resp = await client.post("/accounts", json=payload, headers=headers)

    assert resp.status_code == 422


async def test_create_account_without_auth_returns_401(client):
    """POST /accounts without an Authorization header returns 401."""
    resp = await client.post("/accounts", json=ACCOUNT_PAYLOAD)
    assert resp.status_code == 401


async def test_create_account_null_institution_accepted(client):
    """Null institution_id is valid — cash or unlinked accounts serialize institution as null."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(client, headers, institution_id=None)

    assert resp.status_code == 201
    assert resp.json()["institution"] is None


async def test_create_account_with_all_optional_fields(client):
    """Account created with all optional fields set returns correct values."""
    inst = await _seed_institution()
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(
        client, headers,
        institution_id=str(inst.id),
        is_archived=True,
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["institution"]["id"] == str(inst.id)
    assert data["is_archived"] is True


async def test_create_account_owner_id_cannot_be_hijacked(client):
    """Extra owner_id in the body cannot hijack ownership."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]

    payload = {**ACCOUNT_PAYLOAD, "owner_id": NONEXISTENT_ID}
    resp = await client.post("/accounts", json=payload, headers=headers)

    assert resp.status_code == 201
    assert resp.json()["owner_id"] == user_id


async def test_create_account_duplicate_names_allowed(client):
    """Multiple accounts with the same name are allowed."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp1 = await _create_account(client, headers, name="Savings")
    resp2 = await _create_account(client, headers, name="Savings")

    assert resp1.status_code == 201
    assert resp2.status_code == 201
    assert resp1.json()["id"] != resp2.json()["id"]


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


async def test_patch_account_updates_is_archived(client):
    """PATCH toggles is_archived."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    resp = await client.patch(f"/accounts/{account_id}", json={"is_archived": True}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["is_archived"] is True


async def test_patch_account_archiving_non_zero_balance_creates_balance_adjustment(client, monkeypatch):
    """Archiving a non-zero account records a balance adjustment to zero it out."""
    from app.routes import account as account_routes

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
    from app.routes import account as account_routes

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


async def test_patch_account_archiving_is_idempotent(client, monkeypatch):
    """Archiving an already-archived account does not create another adjustment."""
    from app.routes import account as account_routes

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
    from app.routes import account as account_routes

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


async def test_patch_account_sets_closed_at(client):
    """PATCH can close an account by setting closed_at."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/accounts/{account_id}",
        json={"closed_at": "2026-03-01T00:00:00Z"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["closed_at"] is not None


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


async def test_patch_account_explicit_null_closed_at_still_clears_field(client):
    """Nullable fields (closed_at) can still be cleared with explicit null — the guard only covers NOT NULL columns."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    # Set closed_at first, then clear it
    await client.patch(
        f"/accounts/{account_id}",
        json={"closed_at": "2026-01-01T00:00:00+00:00"},
        headers=headers,
    )
    resp = await client.patch(f"/accounts/{account_id}", json={"closed_at": None}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["closed_at"] is None


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


async def test_patch_account_clears_closed_at(client):
    """PATCH with closed_at=null reopens a closed account."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    # Close it
    await client.patch(f"/accounts/{account_id}", json={"closed_at": "2026-03-01T00:00:00Z"}, headers=headers)
    # Reopen it
    resp = await client.patch(f"/accounts/{account_id}", json={"closed_at": None}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["closed_at"] is None


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


# --- DELETE /accounts/{account_id} ---


async def test_delete_account_returns_204(client):
    """DELETE removes the account and returns 204."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    resp = await client.delete(f"/accounts/{account_id}", headers=headers)

    assert resp.status_code == 204

    # Verify account is gone
    get_resp = await client.get(f"/accounts/{account_id}", headers=headers)
    assert get_resp.status_code == 404


async def test_delete_account_not_found_returns_404(client):
    """DELETE non-existent account returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.delete(f"/accounts/{NONEXISTENT_ID}", headers=headers)

    assert resp.status_code == 404


async def test_delete_account_other_user_returns_404(client):
    """Deleting another user's account returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await client.delete(f"/accounts/{account_id}", headers=other_headers)

    assert resp.status_code == 404


async def test_delete_account_without_auth_returns_401(client):
    """DELETE /accounts/{id} without an Authorization header returns 401."""
    resp = await client.delete(f"/accounts/{NONEXISTENT_ID}")
    assert resp.status_code == 401


async def test_double_delete_returns_404_on_second(client):
    """Deleting the same account twice returns 204 then 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    resp1 = await client.delete(f"/accounts/{account_id}", headers=headers)
    resp2 = await client.delete(f"/accounts/{account_id}", headers=headers)

    assert resp1.status_code == 204
    assert resp2.status_code == 404


# --- Ownership isolation ---


async def test_other_user_cannot_patch_account(client):
    """PATCH on another user's account returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await client.patch(f"/accounts/{account_id}", json={"name": "Hacked"}, headers=other_headers)

    assert resp.status_code == 404


async def test_list_accounts_excludes_other_users_accounts(client):
    """User A's accounts do not appear in User B's list."""
    signup_resp = await _create_user(client)
    headers_a = _get_auth_header(signup_resp)
    await _create_account(client, headers_a, name="User A Account")

    headers_b = _get_auth_header(await _create_second_user(client))
    await _create_account(client, headers_b, name="User B Account")

    # User B should only see their own account
    resp = await client.get("/accounts", headers=headers_b)

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["name"] == "User B Account"
