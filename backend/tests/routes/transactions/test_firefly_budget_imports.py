

from datetime import date

from tests.routes.support import _create_user, _get_auth_header

# --- POST /transactions/import/firefly/budgets ---


async def _get_category_id(client, headers, name):
    """Return the id of a visible category by name.

    Args:
        client: The async test client.
        headers: Auth headers for the requesting user.
        name: Category name to find.

    Returns:
        Category id string
    """
    resp = await client.get("/categories", headers=headers)
    return next(category["id"] for category in resp.json() if category["name"] == name)


async def test_firefly_budget_import_preserves_limit_history(client):
    """Each materialized period carries the limit amount in force for its month."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    groceries_id = await _get_category_id(client, headers, "Groceries")

    resp = await client.post("/transactions/import/firefly/budgets", json={
        "budgets": [{
            "name": "Groceries",
            "currency": "CAD",
            "category_ids": [groceries_id],
            "period_start": "2025-11-01",
            "limits": [
                {"start": "2025-12-01", "amount": "600.00"},
                {"start": "2026-03-01", "amount": "650.50"},
            ],
        }],
    }, headers=headers)

    assert resp.status_code == 201
    data = resp.json()
    assert data["budgets_created"] == 1
    result = data["results"][0]
    assert result["name"] == "Groceries"

    base_resp = await client.get(f"/base-budgets/{result['base_budget_id']}", headers=headers)
    base = base_resp.json()
    assert base["currency"] == "CAD"
    assert base["recurrence_freq"] == "monthly"
    assert base["recurrence_dom"] == 1
    assert base["recurs"] is True
    assert base["category_ids"] == [groceries_id]

    instances_resp = await client.get("/budgets", headers=headers)
    own = [b for b in instances_resp.json() if b["base_budget_id"] == result["base_budget_id"]]
    limits_by_start = {b["period_start"]: b["overall_limit"] for b in own}

    # November predates the first limit and falls back to the earliest
    # amount, December through February carry 600, and March onward 650.50
    assert limits_by_start["2025-11-01"] == 60000
    assert limits_by_start["2025-12-01"] == 60000
    assert limits_by_start["2026-02-01"] == 60000
    assert limits_by_start["2026-03-01"] == 65050
    assert limits_by_start["2026-07-01"] == 65050

    # Periods run from the backdated start through the current month
    assert result["instance_count"] == len(own)
    assert min(b["period_start"] for b in own) == "2025-11-01"
    assert max(date.fromisoformat(b["period_end"]) for b in own) >= date.today()


async def test_firefly_budget_import_is_atomic_across_budgets(client):
    """A failing budget rolls back every budget in the batch."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    groceries_id = await _get_category_id(client, headers, "Groceries")

    resp = await client.post("/transactions/import/firefly/budgets", json={
        "budgets": [
            {
                "name": "Groceries",
                "currency": "CAD",
                "category_ids": [groceries_id],
                "period_start": "2026-01-01",
                "limits": [{"start": "2026-01-01", "amount": "600.00"}],
            },
            {
                "name": "Broken",
                "currency": "CAD",
                "category_ids": [groceries_id],
                "period_start": "2026-01-01",
                "limits": [{"start": "2026-01-01", "amount": "not-a-number"}],
            },
        ],
    }, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == 'Broken: invalid limit amount "not-a-number"'

    base_budgets_resp = await client.get("/base-budgets", headers=headers)
    assert base_budgets_resp.json() == []


async def test_firefly_budget_import_rejects_misaligned_period_start(client):
    """Backdated periods must start on the first of a month."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    groceries_id = await _get_category_id(client, headers, "Groceries")

    resp = await client.post("/transactions/import/firefly/budgets", json={
        "budgets": [{
            "name": "Groceries",
            "currency": "CAD",
            "category_ids": [groceries_id],
            "period_start": "2026-01-15",
            "limits": [{"start": "2026-01-01", "amount": "600.00"}],
        }],
    }, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"].startswith("Groceries: Monthly budgets must start on day 1")


async def test_firefly_budget_import_rejects_duplicate_limit_starts(client):
    """Two limits sharing a start date fail loudly instead of one silently winning."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    groceries_id = await _get_category_id(client, headers, "Groceries")

    resp = await client.post("/transactions/import/firefly/budgets", json={
        "budgets": [{
            "name": "Groceries",
            "currency": "CAD",
            "category_ids": [groceries_id],
            "period_start": "2026-01-01",
            "limits": [
                {"start": "2026-01-01", "amount": "600.00"},
                {"start": "2026-01-01", "amount": "700.00"},
            ],
        }],
    }, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Groceries: two budget limits share a start date"


async def test_firefly_budget_import_rejects_unknown_category(client):
    """Tracked categories must be visible to the importing user."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.post("/transactions/import/firefly/budgets", json={
        "budgets": [{
            "name": "Groceries",
            "currency": "CAD",
            "category_ids": ["00000000-0000-0000-0000-000000000000"],
            "period_start": "2026-01-01",
            "limits": [{"start": "2026-01-01", "amount": "600.00"}],
        }],
    }, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Category not found"
