"""Each import run takes requests only from the importer that opened it"""

import pytest

from tests.routes.support import _create_user, _get_auth_header
from tests.routes.transactions._import_helpers import _csv_batch, _firefly_batch, _open_run

_BUDGETS = {
    "budgets": [{
        "name": "Food",
        "currency": "CAD",
        "category_sources": ["Groceries"],
        "limits": [{"start": "2026-04-01", "end": "2026-04-30", "amount": "300.00"}],
        "recurrence": None,
    }],
}


@pytest.mark.parametrize(
    ("source", "method", "path", "body", "detail"),
    [
        ("generic", "post", "journal/rows", _firefly_batch(1), "This import run is a CSV import"),
        ("generic", "post", "journal/commit", None, "This import run is a CSV import"),
        ("generic", "put", "budgets", _BUDGETS, "A CSV import has no budgets"),
        ("generic", "put", "archive", {"account_sources": ["Main Chequing"]}, "A CSV import archives no accounts"),
        ("firefly", "post", "rows", _csv_batch(["-1.00"]), "This import run is a Firefly III import"),
        ("firefly", "post", "commit", None, "This import run is a Firefly III import"),
        ("actual_budget", "post", "rows", _csv_batch(["-1.00"]), "This import run is an Actual Budget import"),
        ("actual_budget", "post", "commit", None, "This import run is an Actual Budget import"),
    ],
)
async def test_a_run_takes_requests_only_from_the_importer_that_opened_it(client, source, method, path, body, detail):
    """Each importer's rows are read by its own commit, so another importer's requests are refused."""
    headers = _get_auth_header(await _create_user(client))
    run_id = await _open_run(client, headers, 1, source)

    resp = await client.request(method, f"/transactions/import/runs/{run_id}/{path}", json=body, headers=headers)

    assert (resp.status_code, resp.json()["detail"]) == (422, detail)
