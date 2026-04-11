import uuid
from datetime import UTC, datetime

from app.models.account import TaxAdvantagedConfig
from app.models.base import CategoryKind, InstitutionStatus
from app.models.category import Category
from app.models.institution import Institution
from app.models.transaction import Transaction
from tests.conftest import TestSession
from tests.routes.conftest import ACCOUNT_PAYLOAD, _create_account, _create_user, _get_auth_header

# --- Helpers ---

NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000"


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


async def _seed_category(owner_id: uuid.UUID, kind: CategoryKind, name: str = "Transfer") -> uuid.UUID:
    """Insert a category of a given kind directly via DB. Returns the id.

    Used by tax-advantaged tally tests to create transfer-kind categories without going
    through the API (which would otherwise need /categories route setup per test).
    """
    async with TestSession() as session:
        cat = Category(name=name, kind=kind, owner_id=owner_id)
        session.add(cat)
        await session.commit()
        await session.refresh(cat)
        return cat.id


async def _seed_tax_advantaged_config(
    account_id: uuid.UUID, year: int, contribution_limit: int, withdrawal_limit: int | None = None,
) -> None:
    """Insert a TaxAdvantagedConfig row directly via DB.

    Used by current-year limit tests to attach per-year limits without going
    through the (not-yet-built) TaxAdvantagedConfig CRUD routes.
    """
    async with TestSession() as session:
        session.add(TaxAdvantagedConfig(
            account_id=account_id,
            year=year,
            contribution_limit=contribution_limit,
            withdrawal_limit=withdrawal_limit,
        ))
        await session.commit()


async def _seed_transaction(
    account_id: uuid.UUID, category_id: uuid.UUID, user_id: uuid.UUID, amount: int, ts: datetime,
) -> None:
    """Insert a transaction directly via DB, bypassing validation and snapshot hooks.

    Used by tax-advantaged tally tests to seed historical/current-year transfers without
    also triggering recompute_snapshots_from (which would add extra AccountBalanceSnapshot
    rows that these tests don't care about).
    """
    async with TestSession() as session:
        session.add(Transaction(
            created_by_user_id=user_id,
            account_id=account_id,
            category_id=category_id,
            ts=ts,
            amount=amount,
            currency="CAD",
        ))
        await session.commit()


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
    # Detail-only fields are excluded from the overview shape
    assert "lifetime_contribution_limit" not in row
    assert "created_at" not in row
    # Overview fields are present
    for field in ("id", "owner_id", "group_id", "account_kind", "account_type", "name",
                  "currency", "institution", "current_balance", "credit_limit", "is_hidden", "closed_at"):
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

    # Insert two snapshots after the zero anchor (which is at today's UTC midnight): the older
    # of the two (12345) and the newer (98765). Helper should return the most recent.
    async with TestSession() as session:
        session.add(AccountBalanceSnapshot(
            account_id=account_id,
            ts=datetime(2027, 1, 1, tzinfo=UTC),
            balance=12345,
        ))
        session.add(AccountBalanceSnapshot(
            account_id=account_id,
            ts=datetime(2027, 6, 1, tzinfo=UTC),
            balance=98765,
        ))
        await session.commit()

    resp = await client.get("/accounts", headers=headers)

    assert resp.status_code == 200
    assert resp.json()[0]["current_balance"] == 98765


async def test_get_account_returns_current_balance(client):
    """Single-account fetch also returns current_balance."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    resp = await client.get(f"/accounts/{account_id}", headers=headers)

    assert resp.status_code == 200
    assert resp.json()["current_balance"] == 0


# --- Tax-advantaged tallies (Phase 2.6) ---


async def test_get_taxable_account_tax_advantaged_tallies_are_null(client):
    """Taxable accounts return None for all four tax-advantaged tally fields."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)  # defaults to tax_treatment='taxable'
    account_id = create_resp.json()["id"]

    resp = await client.get(f"/accounts/{account_id}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["ytd_contributions"] is None
    assert data["ytd_withdrawals"] is None
    assert data["lifetime_contributions"] is None
    assert data["lifetime_withdrawals"] is None


async def test_get_tax_free_account_without_lifetime_limit_has_ytd_but_null_lifetime(client):
    """Tax-free account with no lifetime_contribution_limit: YTD populated (zero), lifetime null."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers, tax_treatment="tax_free")
    account_id = create_resp.json()["id"]

    resp = await client.get(f"/accounts/{account_id}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["ytd_contributions"] == 0
    assert data["ytd_withdrawals"] == 0
    assert data["lifetime_contributions"] is None
    assert data["lifetime_withdrawals"] is None


async def test_get_tax_free_account_with_lifetime_limit_populates_all_four(client):
    """Tax-free account with lifetime_contribution_limit set populates all four tally fields (zero with no activity)."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(
        client, headers, tax_treatment="tax_free", lifetime_contribution_limit=5_000_000,
    )
    account_id = create_resp.json()["id"]

    resp = await client.get(f"/accounts/{account_id}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["ytd_contributions"] == 0
    assert data["ytd_withdrawals"] == 0
    assert data["lifetime_contributions"] == 0
    assert data["lifetime_withdrawals"] == 0


async def test_tax_advantaged_tallies_sum_transfer_transactions(client):
    """YTD tallies sum positive transfers into contributions and absolute negative into withdrawals."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = uuid.UUID(signup_resp.json()["user"]["id"])
    create_resp = await _create_account(client, headers, tax_treatment="tax_free")
    account_id = uuid.UUID(create_resp.json()["id"])

    transfer_cat_id = await _seed_category(user_id, CategoryKind.TRANSFER)

    # Current-year transfers: two contributions and one withdrawal
    now = datetime.now(UTC)
    await _seed_transaction(account_id, transfer_cat_id, user_id, 50_000, now)
    await _seed_transaction(account_id, transfer_cat_id, user_id, 30_000, now)
    await _seed_transaction(account_id, transfer_cat_id, user_id, -10_000, now)

    resp = await client.get(f"/accounts/{account_id}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["ytd_contributions"] == 80_000
    assert data["ytd_withdrawals"] == 10_000


async def test_tax_advantaged_lifetime_tallies_include_old_years_ytd_excludes_them(client):
    """Old-year transfers count toward lifetime tallies but not YTD."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = uuid.UUID(signup_resp.json()["user"]["id"])
    create_resp = await _create_account(
        client, headers, tax_treatment="tax_free", lifetime_contribution_limit=5_000_000,
    )
    account_id = uuid.UUID(create_resp.json()["id"])

    transfer_cat_id = await _seed_category(user_id, CategoryKind.TRANSFER)

    # Prior-year activity (2025 — definitely not the current UTC year at time of writing)
    await _seed_transaction(account_id, transfer_cat_id, user_id, 100_000, datetime(2025, 6, 1, tzinfo=UTC))
    await _seed_transaction(account_id, transfer_cat_id, user_id, -20_000, datetime(2025, 7, 1, tzinfo=UTC))
    # Current-year activity — use today's timestamp to avoid tz/year-boundary hazards
    now = datetime.now(UTC)
    await _seed_transaction(account_id, transfer_cat_id, user_id, 50_000, now)
    await _seed_transaction(account_id, transfer_cat_id, user_id, -5_000, now)

    resp = await client.get(f"/accounts/{account_id}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    # YTD only reflects current-year activity
    assert data["ytd_contributions"] == 50_000
    assert data["ytd_withdrawals"] == 5_000
    # Lifetime sums across both years
    assert data["lifetime_contributions"] == 150_000
    assert data["lifetime_withdrawals"] == 25_000


async def test_tax_advantaged_tallies_ignore_non_transfer_transactions(client):
    """Expense and income category transactions never contribute to tax-advantaged tallies."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = uuid.UUID(signup_resp.json()["user"]["id"])
    create_resp = await _create_account(
        client, headers, tax_treatment="tax_free", lifetime_contribution_limit=5_000_000,
    )
    account_id = uuid.UUID(create_resp.json()["id"])

    transfer_cat_id = await _seed_category(user_id, CategoryKind.TRANSFER, name="Transfer")
    expense_cat_id = await _seed_category(user_id, CategoryKind.EXPENSE, name="Groceries")

    now = datetime.now(UTC)
    await _seed_transaction(account_id, transfer_cat_id, user_id, 100_000, now)  # counts
    await _seed_transaction(account_id, expense_cat_id, user_id, -50_000, now)  # ignored

    resp = await client.get(f"/accounts/{account_id}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["ytd_contributions"] == 100_000
    assert data["ytd_withdrawals"] == 0  # expense didn't contribute
    assert data["lifetime_contributions"] == 100_000
    assert data["lifetime_withdrawals"] == 0


# --- Current-year tax-advantaged limits (Phase 2.7) ---


async def test_get_taxable_account_current_year_limits_are_null(client):
    """Taxable accounts return None for both current-year limit fields even if a config row exists."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)  # defaults to tax_treatment='taxable'
    account_id = uuid.UUID(create_resp.json()["id"])

    # Even with a rogue config row for the current year, taxable accounts must report null.
    await _seed_tax_advantaged_config(account_id, datetime.now(UTC).year, 700_000, 200_000)

    resp = await client.get(f"/accounts/{account_id}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["current_year_contribution_limit"] is None
    assert data["current_year_withdrawal_limit"] is None


async def test_tax_advantaged_account_without_config_returns_null_limits(client):
    """Tax-advantaged account with no TaxAdvantagedConfig row returns null for both limit fields."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers, tax_treatment="tax_free")
    account_id = create_resp.json()["id"]

    resp = await client.get(f"/accounts/{account_id}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["current_year_contribution_limit"] is None
    assert data["current_year_withdrawal_limit"] is None


async def test_tax_advantaged_account_with_current_year_config_echoes_limits(client):
    """A config row for the current UTC year is echoed on the detail response."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers, tax_treatment="tax_free")
    account_id = uuid.UUID(create_resp.json()["id"])

    current_year = datetime.now(UTC).year
    await _seed_tax_advantaged_config(account_id, current_year, 700_000, 200_000)

    resp = await client.get(f"/accounts/{account_id}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["current_year_contribution_limit"] == 700_000
    assert data["current_year_withdrawal_limit"] == 200_000


async def test_tax_advantaged_account_with_only_wrong_year_config_returns_null(client):
    """A config row for a year other than the current UTC year does not surface on the response."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers, tax_treatment="tax_free")
    account_id = uuid.UUID(create_resp.json()["id"])

    prior_year = datetime.now(UTC).year - 1
    await _seed_tax_advantaged_config(account_id, prior_year, 500_000, 100_000)

    resp = await client.get(f"/accounts/{account_id}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["current_year_contribution_limit"] is None
    assert data["current_year_withdrawal_limit"] is None


async def test_tax_advantaged_account_with_multi_year_configs_returns_current_year(client):
    """With configs for multiple years, only the current UTC year's limits are returned."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers, tax_treatment="tax_free")
    account_id = uuid.UUID(create_resp.json()["id"])

    current_year = datetime.now(UTC).year
    await _seed_tax_advantaged_config(account_id, current_year - 1, 500_000, 100_000)
    await _seed_tax_advantaged_config(account_id, current_year, 700_000, 200_000)
    await _seed_tax_advantaged_config(account_id, current_year + 1, 800_000, 300_000)

    resp = await client.get(f"/accounts/{account_id}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["current_year_contribution_limit"] == 700_000
    assert data["current_year_withdrawal_limit"] == 200_000


async def test_tax_advantaged_account_current_year_withdrawal_limit_can_be_null(client):
    """Config rows without a withdrawal_limit surface contribution_limit but null withdrawal."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers, tax_treatment="tax_free")
    account_id = uuid.UUID(create_resp.json()["id"])

    current_year = datetime.now(UTC).year
    await _seed_tax_advantaged_config(account_id, current_year, 700_000, withdrawal_limit=None)

    resp = await client.get(f"/accounts/{account_id}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["current_year_contribution_limit"] == 700_000
    assert data["current_year_withdrawal_limit"] is None


async def test_create_account_returns_current_balance(client):
    """POST /accounts response includes current_balance from the just-inserted zero anchor."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(client, headers)

    assert resp.status_code == 201
    assert resp.json()["current_balance"] == 0


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
    assert data["tax_treatment"] == ACCOUNT_PAYLOAD["tax_treatment"]
    assert data["name"] == ACCOUNT_PAYLOAD["name"]
    assert data["institution"] is None
    assert data["currency"] == ACCOUNT_PAYLOAD["currency"]
    assert data["current_balance"] == 0
    assert data["lifetime_contribution_limit"] is None
    assert data["credit_limit"] is None
    assert data["ytd_contributions"] is None
    assert data["ytd_withdrawals"] is None
    assert data["lifetime_contributions"] is None
    assert data["lifetime_withdrawals"] is None
    assert data["current_year_contribution_limit"] is None
    assert data["current_year_withdrawal_limit"] is None
    assert data["is_hidden"] is False
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
    assert data["tax_treatment"] == ACCOUNT_PAYLOAD["tax_treatment"]
    assert data["currency"] == ACCOUNT_PAYLOAD["currency"]
    assert data["is_hidden"] is False
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
        client, headers, account_kind="liability", account_type="credit_card", name="Visa Infinite",
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["account_kind"] == "liability"
    assert data["account_type"] == "credit_card"


async def test_create_liability_with_credit_limit_succeeds(client):
    """Setting credit_limit on a liability account is accepted and round-trips."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(
        client, headers,
        account_kind="liability", account_type="credit_card", name="Visa", credit_limit=500_000,
    )

    assert resp.status_code == 201
    assert resp.json()["credit_limit"] == 500_000


async def test_create_liability_without_credit_limit_defaults_null(client):
    """Liability accounts without credit_limit serialize the field as null."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(
        client, headers, account_kind="liability", account_type="credit_card", name="Visa",
    )

    assert resp.status_code == 201
    assert resp.json()["credit_limit"] is None


async def test_create_asset_with_credit_limit_returns_422(client):
    """Setting credit_limit on an asset account is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(client, headers, credit_limit=500_000)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "credit_limit is only valid on liability accounts"


async def test_update_liability_credit_limit_succeeds(client):
    """Patching credit_limit on a liability account is accepted."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(
        client, headers, account_kind="liability", account_type="credit_card", name="Visa",
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
    assert resp.json()["detail"] == "credit_limit is only valid on liability accounts"


async def test_create_account_invalid_tax_treatment_returns_422(client):
    """Invalid tax_treatment returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(client, headers, tax_treatment="not_a_real_treatment")

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Invalid tax treatment"


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
        lifetime_contribution_limit=500000,
        is_hidden=True,
        tax_treatment="tax_free",
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["institution"]["id"] == str(inst.id)
    assert data["lifetime_contribution_limit"] == 500000
    assert data["is_hidden"] is True
    assert data["tax_treatment"] == "tax_free"


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


async def test_patch_account_updates_is_hidden(client):
    """PATCH toggles is_hidden."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    resp = await client.patch(f"/accounts/{account_id}", json={"is_hidden": True}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["is_hidden"] is True


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


async def test_patch_account_invalid_tax_treatment_returns_422(client):
    """PATCH with invalid tax_treatment returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/accounts/{account_id}",
        json={"tax_treatment": "not_a_real_treatment"},
        headers=headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Invalid tax treatment"


async def test_patch_account_explicit_null_name_returns_422(client):
    """Explicit null on name would violate NOT NULL — reject with 422 before touching the DB."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    resp = await client.patch(f"/accounts/{account_id}", json={"name": None}, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "name cannot be null"


async def test_patch_account_explicit_null_tax_treatment_returns_422(client):
    """Explicit null on tax_treatment would violate NOT NULL — reject with 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    resp = await client.patch(f"/accounts/{account_id}", json={"tax_treatment": None}, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "tax_treatment cannot be null"


async def test_patch_account_explicit_null_is_hidden_returns_422(client):
    """Explicit null on is_hidden would violate NOT NULL — reject with 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    resp = await client.patch(f"/accounts/{account_id}", json={"is_hidden": None}, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "is_hidden cannot be null"


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
        json={"account_kind": "liability", "account_type": "credit_card", "currency": "USD"},
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
