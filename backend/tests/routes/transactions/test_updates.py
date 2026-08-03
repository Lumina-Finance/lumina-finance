

import uuid
from datetime import date

from app.models.transaction import Transaction
from tests.conftest import TestSession
from tests.routes.support import _create_user, _get_auth_header
from tests.routes.transactions._helpers import (
    NONEXISTENT_ID,
    _create_account,
    _create_category,
    _create_merchant,
    _create_tag,
    _create_transaction,
    _seed_usd_currency,
    _setup_user_with_deps,
)

# --- PATCH /transactions/{id} ---


async def test_patch_transaction_updates_amount(client):
    """PATCH updates the amount field."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    resp = await client.patch(f"/transactions/{txn_id}", json={"amount": -9999}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["amount"] == -9999


async def test_patch_transaction_accepts_sign_changes_for_all_category_kinds(client):
    """Editing direction is a signed amount change, independent of category kind."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    account_resp = await _create_account(client, headers)
    account_id = account_resp.json()["id"]

    for kind in ("expense", "income", "transfer"):
        category_resp = await _create_category(client, headers, name=f"Patch Direction {kind}", kind=kind)
        # A transfer records its counterparty account, and the other kinds reject the field
        counterparty_kwargs = {"counterparty_account_scope": "outside"} if kind == "transfer" else {}
        create_resp = await _create_transaction(
            client,
            headers,
            account_id,
            category_resp.json()["id"],
            amount=-1000,
            **counterparty_kwargs,
        )
        txn_id = create_resp.json()["id"]

        credit_resp = await client.patch(f"/transactions/{txn_id}", json={"amount": 2500}, headers=headers)
        assert credit_resp.status_code == 200
        assert credit_resp.json()["amount"] == 2500

        debit_resp = await client.patch(f"/transactions/{txn_id}", json={"amount": -1500}, headers=headers)
        assert debit_resp.status_code == 200
        assert debit_resp.json()["amount"] == -1500


async def test_patch_transaction_updates_notes(client):
    """PATCH updates the notes field."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    resp = await client.patch(f"/transactions/{txn_id}", json={"notes": "Updated"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["notes"] == "Updated"


async def test_patch_transaction_updates_dt(client):
    """PATCH updates the date field."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    resp = await client.patch(f"/transactions/{txn_id}", json={"dt": "2026-01-01"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["dt"] == "2026-01-01"


async def test_patch_transaction_updates_account(client):
    """PATCH can move a transaction to a different account."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    other_account = await _create_account(client, headers, name="Savings")

    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/transactions/{txn_id}",
        json={"account_id": other_account.json()["id"]},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["account_id"] == other_account.json()["id"]


async def test_patch_transaction_replaces_tags(client):
    """PATCH with tag_ids replaces all existing tags."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    tag_a = await _create_tag(client, headers, name="tag-a")
    tag_b = await _create_tag(client, headers, name="tag-b")

    create_resp = await _create_transaction(client, headers, account_id, category_id, tag_ids=[tag_a.json()["id"]])
    txn_id = create_resp.json()["id"]

    resp = await client.patch(f"/transactions/{txn_id}", json={"tag_ids": [tag_b.json()["id"]]}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["tag_ids"] == [tag_b.json()["id"]]
    assert resp.json()["tags"] == [{"id": tag_b.json()["id"], "group_id": None, "name": "tag-b"}]


async def test_patch_transaction_clears_tags(client):
    """PATCH with tag_ids=[] clears all tags."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    tag_resp = await _create_tag(client, headers, name="to-remove")

    create_resp = await _create_transaction(client, headers, account_id, category_id, tag_ids=[tag_resp.json()["id"]])
    txn_id = create_resp.json()["id"]

    resp = await client.patch(f"/transactions/{txn_id}", json={"tag_ids": []}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["tag_ids"] == []
    assert resp.json()["tags"] == []


async def test_patch_transaction_updates_fx_rate(client):
    """PATCH can update fx_rate on an existing cross-currency transaction."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    await _seed_usd_currency()

    create_resp = await _create_transaction(client, headers, account_id, category_id, currency="USD", fx_rate=1.35)
    txn_id = create_resp.json()["id"]

    resp = await client.patch(f"/transactions/{txn_id}", json={"fx_rate": 1.40}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["fx_rate"] == 1.4


async def test_patch_transaction_move_account_with_fx_rate_succeeds(client):
    """Moving to a different-currency account succeeds when fx_rate is provided."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    await _seed_usd_currency()

    usd_account = await _create_account(client, headers, name="USD Account", currency="USD")

    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/transactions/{txn_id}",
        json={"account_id": usd_account.json()["id"], "fx_rate": 1.35},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["account_id"] == usd_account.json()["id"]
    assert resp.json()["fx_rate"] == 1.35


async def test_patch_transaction_updated_at_changes(client):
    """updated_at advances after a PATCH."""
    import asyncio

    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]
    original_updated_at = create_resp.json()["updated_at"]

    await asyncio.sleep(0.01)

    resp = await client.patch(f"/transactions/{txn_id}", json={"notes": "edited"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["updated_at"] > original_updated_at


async def test_patch_transaction_invalid_account_returns_404(client):
    """PATCH with non-existent account_id returns 404."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    resp = await client.patch(f"/transactions/{txn_id}", json={"account_id": NONEXISTENT_ID}, headers=headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Account not found"


async def test_patch_transaction_invalid_category_returns_422(client):
    """PATCH with non-existent category_id returns 422."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    resp = await client.patch(f"/transactions/{txn_id}", json={"category_id": NONEXISTENT_ID}, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Category not found"


async def test_patch_transaction_invalid_merchant_returns_422(client):
    """PATCH with non-existent merchant_id returns 422."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    resp = await client.patch(f"/transactions/{txn_id}", json={"merchant_id": NONEXISTENT_ID}, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Merchant not found"


async def test_patch_transaction_invalid_tag_returns_422(client):
    """PATCH with non-existent tag ID returns 422."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    resp = await client.patch(f"/transactions/{txn_id}", json={"tag_ids": [NONEXISTENT_ID]}, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Tag not found"


async def _seed_transaction_without_a_merchant(client, headers, account_id, category_id):
    """Insert a transaction with no merchant, which the route no longer creates

    Returns:
        Identifier of the seeded transaction
    """
    reference = (await _create_transaction(client, headers, account_id, category_id)).json()
    async with TestSession() as session:
        txn = Transaction(
            created_by_user_id=uuid.UUID(reference["created_by_user_id"]),
            account_id=uuid.UUID(account_id),
            dt=date(2026, 3, 15),
            category_id=uuid.UUID(category_id),
            merchant_id=None,
            amount=-5000,
            currency="CAD",
        )
        session.add(txn)
        await session.commit()
        return str(txn.id)


async def test_patch_transaction_recorded_without_a_merchant_is_refused(client):
    """History predating the rule is what the rule is for, so any edit to it has to supply one."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    txn_id = await _seed_transaction_without_a_merchant(client, headers, account_id, category_id)

    resp = await client.patch(f"/transactions/{txn_id}", json={"notes": "Corrected"}, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "merchant_id is required"


async def test_patch_transaction_recorded_without_a_merchant_succeeds_once_it_supplies_one(client):
    """Supplying the merchant is what puts the transaction onto the current rule."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    txn_id = await _seed_transaction_without_a_merchant(client, headers, account_id, category_id)
    merchant_id = (await _create_merchant(client, headers)).json()["id"]

    resp = await client.patch(
        f"/transactions/{txn_id}",
        json={"notes": "Corrected", "merchant_id": merchant_id},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["merchant_id"] == merchant_id
    assert resp.json()["notes"] == "Corrected"


async def test_patch_transaction_cannot_clear_merchant(client):
    """Every edited transaction keeps a merchant, so sending null takes one away rather than correcting it."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    merchant_resp = await _create_merchant(client, headers)

    create_resp = await _create_transaction(client, headers, account_id, category_id, merchant_id=merchant_resp.json()["id"])
    txn_id = create_resp.json()["id"]

    resp = await client.patch(f"/transactions/{txn_id}", json={"merchant_id": None}, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "merchant_id is required"


async def test_patch_transaction_clears_notes(client):
    """PATCH with notes=null clears the notes field."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(client, headers, account_id, category_id, notes="some note")
    txn_id = create_resp.json()["id"]

    resp = await client.patch(f"/transactions/{txn_id}", json={"notes": None}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["notes"] is None


async def test_patch_transaction_empty_body_returns_unchanged(client):
    """PATCH with empty body returns 200 with no changes."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    before = await client.get(f"/transactions/{txn_id}", headers=headers)
    resp = await client.patch(f"/transactions/{txn_id}", json={}, headers=headers)

    assert resp.status_code == 200
    assert resp.json() == before.json()


async def test_patch_transaction_different_currency_account_requires_fx_rate(client):
    """Moving a transaction to an account with a different currency requires fx_rate."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    await _seed_usd_currency()

    usd_account = await _create_account(client, headers, name="USD Account", currency="USD")

    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    resp = await client.patch(f"/transactions/{txn_id}", json={"account_id": usd_account.json()["id"]}, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "fx_rate is required when transaction currency differs from account currency"


async def test_patch_transaction_not_found_returns_404(client):
    """PATCH non-existent transaction returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch(f"/transactions/{NONEXISTENT_ID}", json={"amount": 1}, headers=headers)
    assert resp.status_code == 404


async def test_patch_transaction_other_user_returns_404(client):
    """PATCH on another user's transaction returns 404."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    other_headers, _, _ = await _setup_user_with_deps(client, email="other@example.com", name_prefix="Other")

    resp = await client.patch(f"/transactions/{txn_id}", json={"amount": 1}, headers=other_headers)
    assert resp.status_code == 404


async def test_patch_transaction_without_auth_returns_401(client):
    """PATCH /transactions/{id} without an Authorization header returns 401."""
    resp = await client.patch(f"/transactions/{NONEXISTENT_ID}", json={"amount": 1})
    assert resp.status_code == 401
