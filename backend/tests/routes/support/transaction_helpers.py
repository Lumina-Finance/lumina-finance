"""Writing transactions through the routes: creating one, and importing a file or a journal export"""

from tests.routes.support.merchant_helpers import _get_system_merchant_id


async def _create_transaction(client, headers, account_id, category_id, **overrides):
    """Create a transaction via POST /transactions

    Defaults: dt="2026-03-15", amount=-5000, currency="CAD"

    Args:
        client: The async test client
        headers: Auth headers for the requesting user
        account_id: UUID of the account to attach the transaction to
        category_id: UUID of the category to assign
        **overrides: Fields to override in the default payload

    Returns:
        The HTTP response from the API
    """
    payload = {
        "account_id": account_id,
        "category_id": category_id,
        "dt": "2026-03-15",
        "amount": -5000,
        "currency": "CAD",
        **overrides,
    }

    # The route requires a merchant, so a test that does not care which one gets the shared Myself
    if "merchant_id" not in payload:
        payload["merchant_id"] = await _get_system_merchant_id(client, headers)
    return await client.post("/transactions", json=payload, headers=headers)


async def _import_transactions(client, headers, payload):
    """Stage a whole payload as one batch and commit it

    The importer stages a file over as many batches as its size needs, and only the commit
    writes anything, so a test importing a handful of rows opens a run, stages them all at
    once and commits

    Args:
        client: The async test client
        headers: Auth headers for the importing user
        payload: Account mappings, category mappings and rows, as the flow builds them

    Returns:
        The commit response, or the first of the three calls that refused the import
    """
    run_resp = await client.post(
        "/transactions/import/runs",
        json={"expected_transaction_count": len(payload["rows"])},
        headers=headers,
    )
    if run_resp.status_code != 201:
        return run_resp

    run_id = run_resp.json()["id"]
    stage_resp = await client.post(
        f"/transactions/import/runs/{run_id}/rows",
        json={**payload, "start_row_index": 0},
        headers=headers,
    )
    if stage_resp.status_code != 204:
        return stage_resp

    return await client.post(f"/transactions/import/runs/{run_id}/commit", headers=headers)


async def _import_journal(client, headers, payload, budgets=None, source="firefly", archive=None):
    """Stage a whole journal payload as one batch of a journal run, with any budgets and archiving, and commit it

    Args:
        client: The async test client
        headers: Auth headers for the importing user
        payload: Account mappings, category mappings and journal rows, as the import screen builds them
        budgets: The budgets request, left unsent when None
        archive: The accounts to archive request, left unsent when None
        source: Importer the run is opened for, firefly or actual_budget

    Returns:
        The commit response, or the first call that refused the import
    """
    run_resp = await client.post(
        "/transactions/import/runs",
        json={"expected_transaction_count": len(payload["rows"]), "source": source},
        headers=headers,
    )
    if run_resp.status_code != 201:
        return run_resp

    run_path = f"/transactions/import/runs/{run_resp.json()['id']}"
    stage_resp = await client.post(f"{run_path}/journal/rows", json={**payload, "start_row_index": 0}, headers=headers)
    if stage_resp.status_code != 204:
        return stage_resp

    if budgets is not None:
        budgets_resp = await client.put(f"{run_path}/budgets", json=budgets, headers=headers)
        if budgets_resp.status_code != 204:
            return budgets_resp

    if archive is not None:
        archive_resp = await client.put(f"{run_path}/archive", json=archive, headers=headers)
        if archive_resp.status_code != 204:
            return archive_resp

    return await client.post(f"{run_path}/journal/commit", headers=headers)
