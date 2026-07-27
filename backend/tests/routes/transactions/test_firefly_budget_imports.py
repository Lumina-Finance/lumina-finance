from tests.routes.support import _create_user, _get_auth_header


async def _get_category_id(client, headers, name):
    """Return the id of a visible category by name

    Args:
        client: The async test client
        headers: Auth headers for the requesting user
        name: Category name to find

    Returns:
        Category id string
    """
    resp = await client.get("/categories", headers=headers)
    return next(category["id"] for category in resp.json() if category["name"] == name)


async def _import_one_budget(client, headers, category_id, limits, name="Groceries", is_archived=None):
    """Import one budget and return the created base budget and its instances

    Args:
        client: The async test client
        headers: Auth headers for the requesting user
        category_id: Tracked category for the budget
        limits: Limit periods for the import payload
        name: Budget name
        is_archived: Archived flag for the payload, omitted when None so the
            default is exercised

    Returns:
        Base budget response paired with its instance list
    """
    payload = {
        "name": name,
        "currency": "CAD",
        "category_ids": [category_id],
        "limits": limits,
    }
    if is_archived is not None:
        payload["is_archived"] = is_archived

    resp = await client.post("/transactions/import/firefly/budgets", json={
        "budgets": [payload],
    }, headers=headers)
    assert resp.status_code == 201
    result = resp.json()["results"][0]

    base_resp = await client.get(f"/base-budgets/{result['base_budget_id']}", headers=headers)
    instances_resp = await client.get("/budgets", headers=headers)
    own = [b for b in instances_resp.json() if b["base_budget_id"] == result["base_budget_id"]]
    assert result["instance_count"] == len(own)
    return base_resp.json(), own


async def test_firefly_budget_import_mirrors_limit_periods(client):
    """Each limit period becomes one instance, and gaps stay gaps"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    groceries_id = await _get_category_id(client, headers, "Groceries")

    base, own = await _import_one_budget(client, headers, groceries_id, [
        {"start": "2025-01-01", "end": "2025-01-31", "amount": "600.00"},
        {"start": "2025-03-01", "end": "2025-03-31", "amount": "650.50"},
    ])

    assert base["currency"] == "CAD"
    assert base["recurrence_freq"] == "monthly"
    assert base["instance_length"] == 1
    assert base["recurrence_dom"] == 1
    assert base["recurs"] is True
    assert base["category_ids"] == [groceries_id]

    # is_archived is omitted from the payload, so the budget imports active
    assert base["is_archived"] is False

    # February carried no limit and today's month never did, so neither gets
    # an instance and the history ends where the export ends
    periods = {(b["period_start"], b["period_end"]): b["overall_limit"] for b in own}
    assert periods == {
        ("2025-01-01", "2025-01-31"): 60000,
        ("2025-03-01", "2025-03-31"): 65050,
    }


async def test_firefly_budget_import_carries_archived_flag(client):
    """An archived Firefly budget imports archived with its full period history"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    groceries_id = await _get_category_id(client, headers, "Groceries")

    base, own = await _import_one_budget(client, headers, groceries_id, [
        {"start": "2025-01-01", "end": "2025-01-31", "amount": "600.00"},
        {"start": "2025-02-01", "end": "2025-02-28", "amount": "620.00"},
    ], is_archived=True)

    assert base["is_archived"] is True
    periods = {(b["period_start"], b["period_end"]): b["overall_limit"] for b in own}
    assert periods == {
        ("2025-01-01", "2025-01-31"): 60000,
        ("2025-02-01", "2025-02-28"): 62000,
    }


async def test_firefly_budget_import_reads_cadence_from_latest_period(client):
    """A budget that moved from monthly to quarterly limits continues quarterly"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    groceries_id = await _get_category_id(client, headers, "Groceries")

    base, own = await _import_one_budget(client, headers, groceries_id, [
        {"start": "2023-12-01", "end": "2023-12-31", "amount": "140.00"},
        {"start": "2024-01-01", "end": "2024-03-31", "amount": "420.00"},
    ])

    assert base["recurrence_freq"] == "monthly"
    assert base["instance_length"] == 3
    assert base["recurrence_dom"] == 1
    assert base["recurs"] is True
    assert len(own) == 2


async def test_firefly_budget_import_maps_yearly_periods(client):
    """Twelve-month limit periods continue as a yearly budget"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    groceries_id = await _get_category_id(client, headers, "Groceries")

    base, own = await _import_one_budget(client, headers, groceries_id, [
        {"start": "2024-01-01", "end": "2024-12-31", "amount": "540.00"},
        {"start": "2025-01-01", "end": "2025-12-31", "amount": "560.00"},
    ])

    assert base["recurrence_freq"] == "yearly"
    assert base["instance_length"] == 1
    assert base["recurrence_month"] == 1
    assert base["recurrence_dom"] == 1
    assert base["recurs"] is True
    assert len(own) == 2


async def test_firefly_budget_import_maps_weekly_periods(client):
    """Seven-day limit periods continue as a weekly budget on their weekday"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    groceries_id = await _get_category_id(client, headers, "Groceries")

    base, own = await _import_one_budget(client, headers, groceries_id, [
        {"start": "2026-01-05", "end": "2026-01-11", "amount": "40.00"},
        {"start": "2026-01-12", "end": "2026-01-18", "amount": "42.00"},
    ])

    assert base["recurrence_freq"] == "weekly"
    assert base["instance_length"] == 1
    assert base["recurrence_weekday"] == 0
    assert base["recurs"] is True
    assert len(own) == 2


async def test_firefly_budget_import_keeps_mid_month_monthly_anchor(client):
    """A month-long period starting mid-month anchors on that day of month"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    groceries_id = await _get_category_id(client, headers, "Groceries")

    base, own = await _import_one_budget(client, headers, groceries_id, [
        {"start": "2026-01-15", "end": "2026-02-14", "amount": "100.00"},
    ])

    assert base["recurrence_freq"] == "monthly"
    assert base["recurrence_dom"] == 15
    assert base["recurs"] is True
    assert own[0]["period_start"] == "2026-01-15"
    assert own[0]["period_end"] == "2026-02-14"


async def test_firefly_budget_import_recovers_capped_month_end_anchor(client):
    """A period starting on a short month's last day recovers its real anchor"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    groceries_id = await _get_category_id(client, headers, "Groceries")

    # February 28 is the capped form of a day-31 anchor, which only the
    # period end can disambiguate
    base, own = await _import_one_budget(client, headers, groceries_id, [
        {"start": "2026-02-28", "end": "2026-03-30", "amount": "100.00"},
    ])

    assert base["recurrence_freq"] == "monthly"
    assert base["recurrence_dom"] == 31
    assert base["recurs"] is True
    assert len(own) == 1


async def test_firefly_budget_import_falls_back_for_irregular_period(client):
    """A period fitting no cadence imports verbatim as a non-recurring budget"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    groceries_id = await _get_category_id(client, headers, "Groceries")

    base, own = await _import_one_budget(client, headers, groceries_id, [
        {"start": "2024-10-04", "end": "2024-10-26", "amount": "800.00"},
    ])

    assert base["recurrence_freq"] == "monthly"
    assert base["instance_length"] == 1
    assert base["recurrence_dom"] == 1
    assert base["recurs"] is False
    assert own[0]["period_start"] == "2024-10-04"
    assert own[0]["period_end"] == "2024-10-26"
    assert own[0]["overall_limit"] == 80000


async def test_firefly_budget_import_rejects_overlapping_periods(client):
    """Two limit periods sharing days fail loudly instead of one silently winning"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    groceries_id = await _get_category_id(client, headers, "Groceries")

    resp = await client.post("/transactions/import/firefly/budgets", json={
        "budgets": [{
            "name": "Groceries",
            "currency": "CAD",
            "category_ids": [groceries_id],
            "limits": [
                {"start": "2026-01-01", "end": "2026-01-31", "amount": "600.00"},
                {"start": "2026-01-15", "end": "2026-02-14", "amount": "700.00"},
            ],
        }],
    }, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Groceries: two limit periods overlap"


async def test_firefly_budget_import_rejects_period_end_before_start(client):
    """A limit period whose end precedes its start is rejected"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    groceries_id = await _get_category_id(client, headers, "Groceries")

    resp = await client.post("/transactions/import/firefly/budgets", json={
        "budgets": [{
            "name": "Groceries",
            "currency": "CAD",
            "category_ids": [groceries_id],
            "limits": [{"start": "2026-01-31", "end": "2026-01-01", "amount": "600.00"}],
        }],
    }, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Groceries: a limit period ends before it starts"


async def test_firefly_budget_import_is_atomic_across_budgets(client):
    """A failing budget rolls back every budget in the batch"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    groceries_id = await _get_category_id(client, headers, "Groceries")

    resp = await client.post("/transactions/import/firefly/budgets", json={
        "budgets": [
            {
                "name": "Groceries",
                "currency": "CAD",
                "category_ids": [groceries_id],
                "limits": [{"start": "2026-01-01", "end": "2026-01-31", "amount": "600.00"}],
            },
            {
                "name": "Broken",
                "currency": "CAD",
                "category_ids": [groceries_id],
                "limits": [{"start": "2026-01-01", "end": "2026-01-31", "amount": "not-a-number"}],
            },
        ],
    }, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == 'Broken: invalid limit amount "not-a-number"'

    base_budgets_resp = await client.get("/base-budgets", headers=headers)
    assert base_budgets_resp.json() == []


async def test_firefly_budget_import_rejects_unknown_category(client):
    """Tracked categories must be visible to the importing user"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.post("/transactions/import/firefly/budgets", json={
        "budgets": [{
            "name": "Groceries",
            "currency": "CAD",
            "category_ids": ["00000000-0000-0000-0000-000000000000"],
            "limits": [{"start": "2026-01-01", "end": "2026-01-31", "amount": "600.00"}],
        }],
    }, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Category not found"
