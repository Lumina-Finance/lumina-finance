"""The caps on what one staged batch, and a whole run, may carry for the CSV and journal imports

Firefly III and Actual Budget stage through the same journal endpoint and schema, so Firefly III
stands for both
"""

import pytest

from app.schemas.import_run import MAX_IMPORT_BATCH_ROWS, MAX_IMPORT_MAPPINGS
from tests.routes.support import _create_user, _get_auth_header
from tests.routes.transactions._import_helpers import _csv_batch, _firefly_batch, _open_run, _stage_batch

# The CSV importer and one journal importer, since Firefly III and Actual Budget share the journal endpoint
_SOURCES = ("generic", "firefly")


def _build_batch(source, row_count, start_row_index=0):
    """Build a batch of the given number of rows for the importer's staging endpoint"""
    if source == "generic":
        return _csv_batch(["-1.00"] * row_count, start_row_index)
    return _firefly_batch(row_count, start_row_index)


def _category_mappings(indexes):
    """Build category mappings creating one new category per index"""
    return [{"source": f"Category {index}", "create": {"name": f"Category {index}", "kind": "expense"}} for index in indexes]


@pytest.mark.parametrize("source", _SOURCES)
async def test_staging_a_batch_over_the_row_cap_is_refused(client, source):
    """A batch larger than one insert can carry is refused rather than failing inside the driver."""
    headers = _get_auth_header(await _create_user(client))
    oversized = MAX_IMPORT_BATCH_ROWS + 1
    run_id = await _open_run(client, headers, oversized, source)

    resp = await _stage_batch(client, headers, run_id, _build_batch(source, oversized), source)

    assert resp.status_code == 422
    assert [(error["loc"], error["type"]) for error in resp.json()["detail"]] == [(["body", "rows"], "too_long")]


@pytest.mark.parametrize("source", _SOURCES)
async def test_staging_a_batch_over_the_mapping_cap_is_refused(client, source):
    """A batch declaring more mappings than an import may carry is refused before any is checked."""
    headers = _get_auth_header(await _create_user(client))
    run_id = await _open_run(client, headers, 1, source)
    batch = _build_batch(source, 1)
    batch["categories"] += _category_mappings(range(MAX_IMPORT_MAPPINGS))

    resp = await _stage_batch(client, headers, run_id, batch, source)

    assert resp.status_code == 422

    # A list of field errors is the schema refusing the batch, where the run-level cap would name a reason
    assert [(error["loc"], error["type"]) for error in resp.json()["detail"]] == [(["body", "categories"], "too_long")]


@pytest.mark.parametrize("source", _SOURCES)
async def test_staging_refuses_more_mappings_than_an_import_may_declare_across_batches(client, source):
    """Two batches each under the cap cannot together leave the run holding more than it."""
    headers = _get_auth_header(await _create_user(client))
    run_id = await _open_run(client, headers, 2, source)
    half = MAX_IMPORT_MAPPINGS // 2 + 1

    first_batch = _build_batch(source, 1)
    first_batch["categories"] += _category_mappings(range(half))
    second_batch = _build_batch(source, 1, start_row_index=1)
    second_batch["categories"] += _category_mappings(range(half, half * 2))

    first = await _stage_batch(client, headers, run_id, first_batch, source)
    second = await _stage_batch(client, headers, run_id, second_batch, source)

    assert first.status_code == 204, first.text
    assert second.status_code == 422

    # The run already held the Groceries mapping every batch declares, so the total runs one past
    # the two halves
    assert second.json()["detail"] == (
        f"This import declares {half * 2 + 1} distinct values for Category source, "
        f"and the limit is {MAX_IMPORT_MAPPINGS}"
    )


@pytest.mark.parametrize("source", _SOURCES)
async def test_staging_accepts_a_run_holding_exactly_the_mapping_cap(client, source):
    """A run sitting on the mapping cap is staged, so the bound refuses only past it."""
    headers = _get_auth_header(await _create_user(client))
    run_id = await _open_run(client, headers, 1, source)
    batch = _build_batch(source, 1)

    # One short of the cap, since the batch already declares the Groceries mapping its row uses
    batch["categories"] += _category_mappings(range(MAX_IMPORT_MAPPINGS - 1))

    resp = await _stage_batch(client, headers, run_id, batch, source)

    assert resp.status_code == 204, resp.text
