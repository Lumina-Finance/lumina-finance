from datetime import UTC, date, datetime

from sqlalchemy import select

import app.services.tax_advantaged_plans as plan_services
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.transaction import Transaction
from tests.conftest import TestSession
from tests.routes.conftest import _create_account, _create_user, _get_auth_header

NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000"


async def _create_second_user(client):
    """Sign up a second user."""
    return await client.post("/auth/signup", json={
        "email": "other@example.com",
        "password": "securepassword123",
        "first_name": "Other",
        "tz": "America/Toronto",
        "base_currency": "CAD",
    })


async def _create_group(client, headers, **overrides):
    """Create a group."""
    return await client.post("/groups", json={"name": "Household", **overrides}, headers=headers)


async def _create_plan(client, headers, **overrides):
    """Create a tax-advantaged plan."""
    payload = {
        "name": "TFSA",
        "tax_treatment": "tax_free",
        "currency": "CAD",
        **overrides,
    }
    return await client.post("/tax-advantaged-plans", json=payload, headers=headers)


async def _seed_category(owner_id, kind: CategoryKind, name: str):
    """Insert a category directly via DB.

    Args:
        owner_id: User that owns the category.
        kind: Category kind.
        name: Category name.

    Returns:
        The created category ID.
    """
    async with TestSession() as session:
        category = Category(name=name, kind=kind, owner_id=owner_id)
        session.add(category)
        await session.commit()
        await session.refresh(category)
        return category.id


async def _get_system_category_id(name: str):
    """Return a seeded system category ID by name."""
    async with TestSession() as session:
        category_id = await session.scalar(
            select(Category.id).where(Category.name == name, Category.is_system.is_(True)),
        )
        assert category_id is not None
        return category_id


async def _seed_transaction(account_id, category_id, created_by_user_id, amount: int, dt: date) -> None:
    """Insert a transaction directly via DB.

    Args:
        account_id: Account that owns the transaction.
        category_id: Transaction category.
        created_by_user_id: User that created the transaction.
        amount: Signed transaction amount in minor units.
        dt: Transaction date.
    """
    async with TestSession() as session:
        session.add(Transaction(
            created_by_user_id=created_by_user_id,
            account_id=account_id,
            category_id=category_id,
            dt=dt,
            amount=amount,
            currency="CAD",
        ))
        await session.commit()


async def test_create_plan_returns_201_with_shape(client):
    """Owner can create a personal plan."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]

    resp = await _create_plan(client, headers, lifetime_contribution_limit=9_500_000)

    assert resp.status_code == 201
    data = resp.json()
    assert data["plan_owner_user_id"] == user_id
    assert data["group_id"] is None
    assert data["name"] == "TFSA"
    assert data["tax_treatment"] == "tax_free"
    assert data["currency"] == "CAD"
    assert data["lifetime_contribution_limit"] == 9_500_000
    assert data["accrued_contributions"] == 0
    assert data["accrued_lifetime_contribution_limit"] is None
    assert data["current_year_contribution_limit"] is None
    assert data["current_year_withdrawal_limit"] is None
    assert data["ytd_contributions"] == 0
    assert data["ytd_withdrawals"] == 0
    assert data["lifetime_contributions"] == 0
    assert data["lifetime_withdrawals"] == 0
    assert data["created_at"] is not None


async def test_create_plan_rejects_taxable_treatment(client):
    """Taxable is not a plan treatment."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_plan(client, headers, tax_treatment="taxable")

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Tax-advantaged plans require a non-taxable tax treatment"


async def test_create_group_scoped_plan_requires_membership(client):
    """Only group members can create a plan in that group context."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    group_id = (await _create_group(client, headers)).json()["id"]
    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await _create_plan(client, other_headers, group_id=group_id)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Group not found"


async def test_list_plans_only_returns_owned_plans(client):
    """Users only list plans they own."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    await _create_plan(client, headers, name="Mine")

    other_headers = _get_auth_header(await _create_second_user(client))
    await _create_plan(client, other_headers, name="Theirs")

    resp = await client.get("/tax-advantaged-plans", headers=headers)

    assert resp.status_code == 200
    assert [row["name"] for row in resp.json()] == ["Mine"]


async def test_other_user_cannot_read_or_update_plan(client):
    """Plan owner is the only manager."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    plan_id = (await _create_plan(client, headers)).json()["id"]
    other_headers = _get_auth_header(await _create_second_user(client))

    get_resp = await client.get(f"/tax-advantaged-plans/{plan_id}", headers=other_headers)
    patch_resp = await client.patch(f"/tax-advantaged-plans/{plan_id}", json={"name": "Nope"}, headers=other_headers)

    assert get_resp.status_code == 404
    assert patch_resp.status_code == 404


async def test_owner_can_update_and_delete_plan(client):
    """Owner can update mutable plan fields and delete the plan."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    plan_id = (await _create_plan(client, headers)).json()["id"]

    patch = await client.patch(
        f"/tax-advantaged-plans/{plan_id}",
        json={
            "name": "RRSP",
            "tax_treatment": "tax_deferred",
            "lifetime_contribution_limit": 1_000_000,
            "accrued_contributions": 500_000,
        },
        headers=headers,
    )
    delete = await client.delete(f"/tax-advantaged-plans/{plan_id}", headers=headers)
    get_after_delete = await client.get(f"/tax-advantaged-plans/{plan_id}", headers=headers)

    assert patch.status_code == 200
    assert patch.json()["name"] == "RRSP"
    assert patch.json()["tax_treatment"] == "tax_deferred"
    assert patch.json()["lifetime_contribution_limit"] == 1_000_000
    assert patch.json()["accrued_contributions"] == 500_000
    assert delete.status_code == 204
    assert get_after_delete.status_code == 404


async def test_plan_limits_crud(client):
    """Owner can manage yearly plan limits."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    plan_id = (await _create_plan(client, headers)).json()["id"]

    create = await client.post(
        f"/tax-advantaged-plans/{plan_id}/limits",
        json={
            "year": 2026,
            "contribution_limit": 700_000,
            "withdrawal_limit": 200_000,
            "accrued_contributions": 100_000,
            "accrued_withdrawals": 25_000,
        },
        headers=headers,
    )
    duplicate = await client.post(
        f"/tax-advantaged-plans/{plan_id}/limits",
        json={"year": 2026, "contribution_limit": 800_000},
        headers=headers,
    )
    patch = await client.patch(
        f"/tax-advantaged-plans/{plan_id}/limits/2026",
        json={"withdrawal_limit": None, "accrued_contributions": 120_000, "accrued_withdrawals": 30_000},
        headers=headers,
    )
    listed = await client.get(f"/tax-advantaged-plans/{plan_id}/limits", headers=headers)
    delete = await client.delete(f"/tax-advantaged-plans/{plan_id}/limits/2026", headers=headers)
    empty = await client.get(f"/tax-advantaged-plans/{plan_id}/limits", headers=headers)

    assert create.status_code == 201
    assert create.json()["contribution_limit"] == 700_000
    assert create.json()["accrued_contributions"] == 100_000
    assert create.json()["accrued_withdrawals"] == 25_000
    assert duplicate.status_code == 409
    assert patch.status_code == 200
    assert patch.json()["withdrawal_limit"] is None
    assert patch.json()["accrued_contributions"] == 120_000
    assert patch.json()["accrued_withdrawals"] == 30_000
    assert listed.status_code == 200
    assert [row["year"] for row in listed.json()] == [2026]
    assert delete.status_code == 204
    assert empty.json() == []


async def test_plan_detail_surfaces_current_year_limits(client):
    """Current-year limits are exposed on plan detail."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    plan_id = (await _create_plan(client, headers)).json()["id"]
    current_year = datetime.now(UTC).year
    await client.post(
        f"/tax-advantaged-plans/{plan_id}/limits",
        json={"year": current_year, "contribution_limit": 700_000},
        headers=headers,
    )

    resp = await client.get(f"/tax-advantaged-plans/{plan_id}", headers=headers)

    assert resp.status_code == 200
    assert resp.json()["current_year_contribution_limit"] == 700_000
    assert resp.json()["current_year_withdrawal_limit"] is None


async def test_plan_detail_surfaces_accrued_lifetime_limit(client):
    """Accrued lifetime contribution room is summed through the owner's current year."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    plan_id = (await _create_plan(client, headers, lifetime_contribution_limit=1_200_000)).json()["id"]
    current_year = datetime.now(UTC).year

    await client.post(
        f"/tax-advantaged-plans/{plan_id}/limits",
        json={"year": current_year - 1, "contribution_limit": 700_000},
        headers=headers,
    )
    await client.post(
        f"/tax-advantaged-plans/{plan_id}/limits",
        json={"year": current_year, "contribution_limit": 800_000},
        headers=headers,
    )
    await client.post(
        f"/tax-advantaged-plans/{plan_id}/limits",
        json={"year": current_year + 1, "contribution_limit": 900_000},
        headers=headers,
    )

    resp = await client.get(f"/tax-advantaged-plans/{plan_id}", headers=headers)

    assert resp.status_code == 200
    assert resp.json()["current_year_contribution_limit"] == 800_000
    assert resp.json()["accrued_lifetime_contribution_limit"] == 1_200_000


async def test_plan_metrics_use_plan_owner_timezone_for_current_year(client, monkeypatch):
    """Current-year limits and YTD activity follow the plan owner's timezone."""

    class FrozenDateTime:
        """Clock fixed at Jan 1 UTC while Toronto is still Dec 31."""

        @classmethod
        def now(cls, tz=None):
            """Return the fixed instant converted into the requested timezone.

            Args:
                tz: Optional timezone.

            Returns:
                The fixed datetime in the requested timezone.
            """
            instant = datetime(2026, 1, 1, 1, 0, tzinfo=UTC)
            return instant.astimezone(tz) if tz else instant

    monkeypatch.setattr(plan_services, "datetime", FrozenDateTime)
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]
    plan_id = (await _create_plan(client, headers)).json()["id"]
    account_id = (await _create_account(client, headers, tax_advantaged_plan_id=plan_id)).json()["id"]
    transfer_id = await _get_system_category_id("Transfer")

    await client.post(
        f"/tax-advantaged-plans/{plan_id}/limits",
        json={"year": 2025, "contribution_limit": 700_000},
        headers=headers,
    )
    await client.post(
        f"/tax-advantaged-plans/{plan_id}/limits",
        json={"year": 2026, "contribution_limit": 800_000},
        headers=headers,
    )
    await _seed_transaction(account_id, transfer_id, user_id, 25_000, date(2025, 12, 31))
    await _seed_transaction(account_id, transfer_id, user_id, 26_000, date(2026, 1, 1))

    resp = await client.get(f"/tax-advantaged-plans/{plan_id}", headers=headers)

    assert resp.status_code == 200
    assert resp.json()["current_year_contribution_limit"] == 700_000
    assert resp.json()["ytd_contributions"] == 25_000
    assert resp.json()["lifetime_contributions"] == 51_000


async def test_plan_detail_aggregates_transfer_activity_across_linked_accounts(client):
    """Plan detail aggregates transfer activity from all linked accounts."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]
    plan_id = (await _create_plan(client, headers)).json()["id"]
    first_account_id = (await _create_account(client, headers, name="TFSA A", tax_advantaged_plan_id=plan_id)).json()["id"]
    second_account_id = (await _create_account(client, headers, name="TFSA B", tax_advantaged_plan_id=plan_id)).json()["id"]
    transfer_id = await _get_system_category_id("Transfer")
    expense_id = await _seed_category(user_id, CategoryKind.EXPENSE, "Plan Groceries")
    income_id = await _seed_category(user_id, CategoryKind.INCOME, "Plan Salary")
    current_year = datetime.now(UTC).year

    await _seed_transaction(first_account_id, transfer_id, user_id, 50_000, date(current_year, 2, 1))
    await _seed_transaction(second_account_id, transfer_id, user_id, 30_000, date(current_year, 3, 1))
    await _seed_transaction(first_account_id, transfer_id, user_id, -10_000, date(current_year, 4, 1))
    await _seed_transaction(first_account_id, transfer_id, user_id, 20_000, date(current_year - 1, 5, 1))
    await _seed_transaction(first_account_id, transfer_id, user_id, -5_000, date(current_year - 1, 6, 1))
    await _seed_transaction(first_account_id, expense_id, user_id, -99_000, date(current_year, 7, 1))
    await _seed_transaction(first_account_id, income_id, user_id, 88_000, date(current_year, 8, 1))

    resp = await client.get(f"/tax-advantaged-plans/{plan_id}", headers=headers)

    assert resp.status_code == 200
    assert resp.json()["ytd_contributions"] == 80_000
    assert resp.json()["ytd_withdrawals"] == 10_000
    assert resp.json()["lifetime_contributions"] == 100_000
    assert resp.json()["lifetime_withdrawals"] == 15_000


async def test_plan_metrics_include_accrued_activity(client):
    """Plan metrics include user-entered activity from before Lumina tracking."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]
    plan_id = (await _create_plan(client, headers, accrued_contributions=90_000)).json()["id"]
    account_id = (await _create_account(client, headers, tax_advantaged_plan_id=plan_id)).json()["id"]
    transfer_id = await _get_system_category_id("Transfer")
    current_year = datetime.now(UTC).year
    await client.post(
        f"/tax-advantaged-plans/{plan_id}/limits",
        json={
            "year": current_year,
            "contribution_limit": 700_000,
            "accrued_contributions": 10_000,
            "accrued_withdrawals": 3_000,
        },
        headers=headers,
    )

    await _seed_transaction(account_id, transfer_id, user_id, 20_000, date(current_year, 2, 1))
    await _seed_transaction(account_id, transfer_id, user_id, -4_000, date(current_year, 3, 1))
    await _seed_transaction(account_id, transfer_id, user_id, 30_000, date(current_year - 1, 4, 1))

    resp = await client.get(f"/tax-advantaged-plans/{plan_id}", headers=headers)

    assert resp.status_code == 200
    assert resp.json()["ytd_contributions"] == 30_000
    assert resp.json()["ytd_withdrawals"] == 7_000
    assert resp.json()["lifetime_contributions"] == 140_000


async def test_plan_detail_includes_archived_linked_account_activity(client):
    """Archived linked accounts still count historical transfer activity."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]
    plan_id = (await _create_plan(client, headers)).json()["id"]
    account_id = (await _create_account(client, headers, name="Archived TFSA", tax_advantaged_plan_id=plan_id)).json()["id"]
    transfer_id = await _get_system_category_id("Transfer")
    current_year = datetime.now(UTC).year

    await _seed_transaction(account_id, transfer_id, user_id, 40_000, date(current_year, 2, 1))
    await _seed_transaction(account_id, transfer_id, user_id, -5_000, date(current_year, 3, 1))
    archive_resp = await client.patch(f"/accounts/{account_id}", json={"is_archived": True}, headers=headers)
    assert archive_resp.status_code == 200

    resp = await client.get(f"/tax-advantaged-plans/{plan_id}", headers=headers)

    assert resp.status_code == 200
    assert resp.json()["ytd_contributions"] == 40_000
    assert resp.json()["ytd_withdrawals"] == 5_000
    assert resp.json()["lifetime_contributions"] == 40_000
    assert resp.json()["lifetime_withdrawals"] == 5_000


async def test_plan_metrics_only_count_transfer_category(client):
    """Only the seeded Transfer category counts as TAC activity."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]
    plan_id = (await _create_plan(client, headers)).json()["id"]
    account_id = (await _create_account(client, headers, tax_advantaged_plan_id=plan_id)).json()["id"]
    transfer_id = await _get_system_category_id("Transfer")
    balance_adjustment_id = await _get_system_category_id("Balance Adjustment")
    credit_card_payment_id = await _get_system_category_id("Credit Card Payment")
    current_year = datetime.now(UTC).year

    await _seed_transaction(account_id, transfer_id, user_id, 50_000, date(current_year, 2, 1))
    await _seed_transaction(account_id, transfer_id, user_id, -10_000, date(current_year, 3, 1))
    await _seed_transaction(account_id, balance_adjustment_id, user_id, 999_000, date(current_year, 4, 1))
    await _seed_transaction(account_id, balance_adjustment_id, user_id, -888_000, date(current_year, 5, 1))
    await _seed_transaction(account_id, credit_card_payment_id, user_id, 777_000, date(current_year - 1, 6, 1))

    resp = await client.get(f"/tax-advantaged-plans/{plan_id}", headers=headers)

    assert resp.status_code == 200
    assert resp.json()["ytd_contributions"] == 50_000
    assert resp.json()["ytd_withdrawals"] == 10_000
    assert resp.json()["lifetime_contributions"] == 50_000
    assert resp.json()["lifetime_withdrawals"] == 10_000


async def test_group_plan_counts_transaction_created_by_non_owner(client):
    """Group account activity tallies to the linked plan owner, not transaction creator."""
    owner_resp = await _create_user(client)
    owner_headers = _get_auth_header(owner_resp)
    owner_id = owner_resp.json()["user"]["id"]
    group_id = (await _create_group(client, owner_headers)).json()["id"]

    member_resp = await _create_second_user(client)
    member_user_id = member_resp.json()["user"]["id"]
    add_member = await client.post(f"/groups/{group_id}/members", json={"user_id": member_user_id}, headers=owner_headers)
    assert add_member.status_code == 201

    plan_id = (await _create_plan(client, owner_headers, group_id=group_id)).json()["id"]
    account_id = (await _create_account(client, owner_headers, group_id=group_id, tax_advantaged_plan_id=plan_id)).json()["id"]
    transfer_id = await _get_system_category_id("Transfer")
    current_year = datetime.now(UTC).year
    await _seed_transaction(account_id, transfer_id, member_user_id, 123_000, date(current_year, 2, 1))

    resp = await client.get(f"/tax-advantaged-plans/{plan_id}", headers=owner_headers)

    assert resp.status_code == 200
    assert resp.json()["plan_owner_user_id"] == owner_id
    assert resp.json()["ytd_contributions"] == 123_000
    assert resp.json()["lifetime_contributions"] == 123_000
    assert resp.json()["ytd_withdrawals"] == 0
    assert resp.json()["lifetime_withdrawals"] == 0
