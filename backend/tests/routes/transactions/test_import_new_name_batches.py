"""An import creating thousands of new merchants and tags commits whole, or leaves none of them

The driver refuses a statement binding more than 32,767 arguments, and a merchant binds six and a
tag four, so one statement for every new name fails the commit past 5,461 merchants or 8,191 tags
"""

from fastapi import HTTPException, status
from sqlalchemy import func, select

from app.models.merchant import Merchant
from app.models.tag import Tag
from app.services.importers.shared.insertion_helpers import INSERT_BATCH_SIZE
from tests.conftest import TestSession
from tests.routes.transactions._helpers import _setup_user_with_deps
from tests.routes.transactions._import_helpers import _commit_run, _open_run, _stage_batch

# Past both limits, and a whole number of staging batches
NEW_NAME_COUNT = 10_000
STAGING_BATCH_ROWS = 5_000


def _row(index: int) -> dict:
    """A row filed under a merchant and a tag no other row names"""
    return {
        "account_source": "Chequing",
        "category_source": "Groceries",
        "dt": "2026-04-10",
        "amount": "-1.00",
        "merchant_name": f"Merchant {index}",
        "tag_names": [f"Tag {index}"],
    }


async def _stage_rows(client, headers, mappings, rows) -> str:
    """Open a run for the rows and stage them in batches the staging endpoint accepts"""
    run_id = await _open_run(client, headers, len(rows))
    for start in range(0, len(rows), STAGING_BATCH_ROWS):
        staged = await _stage_batch(
            client,
            headers,
            run_id,
            {**mappings, "rows": rows[start : start + STAGING_BATCH_ROWS], "start_row_index": start},
        )
        assert staged.status_code == 204, staged.text
    return run_id


async def _count_names() -> tuple[int, int]:
    """Count every merchant and tag, so a difference shows what a commit wrote or left behind"""
    async with TestSession() as db:
        merchants = await db.scalar(select(func.count()).select_from(Merchant))
        tags = await db.scalar(select(func.count()).select_from(Tag))
    return merchants, tags


async def test_an_import_of_10000_new_merchants_and_10000_new_tags_commits_with_every_name_created(client):
    """Each of the 10,000 rows names a merchant and a tag of its own, past both statement limits."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    mappings = {
        "accounts": [{"source": "Chequing", "account_id": account_id}],
        "categories": [{"source": "Groceries", "category_id": category_id}],
    }
    before = await _count_names()
    run_id = await _stage_rows(client, headers, mappings, [_row(index) for index in range(NEW_NAME_COUNT)])

    resp = await _commit_run(client, headers, run_id)

    assert resp.status_code == 201, resp.text
    summary = resp.json()
    assert summary["transactions_created"] == NEW_NAME_COUNT
    assert summary["merchants_created"] == NEW_NAME_COUNT
    assert summary["tags_created"] == NEW_NAME_COUNT
    assert len(summary["created_merchant_ids"]) == NEW_NAME_COUNT
    assert len(summary["created_tag_ids"]) == NEW_NAME_COUNT
    after = await _count_names()
    assert (after[0] - before[0], after[1] - before[1]) == (NEW_NAME_COUNT, NEW_NAME_COUNT)


async def test_a_commit_refused_after_the_names_were_written_in_batches_leaves_none_of_them(client, monkeypatch):
    """A refusal once the rows are being written, after every batch of merchants and tags, leaves no name behind."""

    def refuse_the_rows(*args, **kwargs):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Rows refused for the test")

    # No row's own content is refused before both inserts, so this is the first step able to refuse after them
    monkeypatch.setattr("app.services.importers.shared.transaction_writer.get_import_row_tags", refuse_the_rows)
    headers, account_id, category_id = await _setup_user_with_deps(client)
    mappings = {
        "accounts": [{"source": "Chequing", "account_id": account_id}],
        "categories": [{"source": "Groceries", "category_id": category_id}],
    }
    rows = [_row(index) for index in range(INSERT_BATCH_SIZE + 1)]
    before = await _count_names()
    run_id = await _stage_rows(client, headers, mappings, rows)

    resp = await _commit_run(client, headers, run_id)

    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"] == "Rows refused for the test"
    assert await _count_names() == before
