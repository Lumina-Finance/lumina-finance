"""Saving how a CSV file was read for the one account it went to, and listing what was saved"""

import uuid

import pytest
from sqlalchemy import text

from app.models.account_import_layout import AccountImportLayout
from app.schemas.import_run import MAX_CSV_LAYOUT_COLUMNS, MAX_CSV_LAYOUT_HEADER_LENGTH, MAX_CSV_LAYOUT_LINE
from app.services.importers.shared import run_commit as run_commit_module
from tests.conftest import TestSession
from tests.routes.groups.test_transactions import _grant_account_permission, _setup_group_with_shared_account
from tests.routes.transactions._helpers import _create_account, _get_system_category_id, _setup_user_with_deps
from tests.routes.transactions._import_helpers import _commit_run, _csv_batch, _open_run, _stage_batch

_LAYOUTS = "/transactions/import/layouts"

_WEB_EXPORT = {
    "headers": ["Date", "Description", "Amount"],
    "delimiter": ",",
    "header_row": 1,
    "column_map": {"dt": "Date", "merchant_id": "Description", "amount": "Amount"},
    "date_format": "dayFirst",
    "amount_format": {"decimal_separator": ".", "grouping_separator": ","},
}

_MOBILE_EXPORT = {
    "headers": ["Booked", "Payee", "Withdrawal", "Deposit"],
    "delimiter": ";",
    "header_row": 3,
    "column_map": {"dt": "Booked", "merchant_id": "Payee", "amount_out": "Withdrawal", "amount_in": "Deposit"},
    "date_format": "yearFirst",
    "amount_format": {"decimal_separator": ",", "grouping_separator": "space"},
}


def _into(account_id, category_id, amounts=("-4.50",)):
    """Build a batch writing one row per amount to the account under the category"""
    return _csv_batch(
        list(amounts),
        account={"source": "Main Chequing", "account_id": account_id},
        category={"source": "Groceries", "category_id": category_id},
    )


async def _import(client, headers, batch, csv_layout):
    """Open a run carrying the layout, stage the batch and commit it, returning the run id and the commit"""
    run_id = await _open_run(client, headers, len(batch["rows"]), csv_layout=csv_layout)
    staged = await _stage_batch(client, headers, run_id, batch)
    assert staged.status_code == 204, staged.text
    return run_id, await _commit_run(client, headers, run_id)


async def _list_layouts(client, headers):
    resp = await client.get(_LAYOUTS, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _saved(account_id, layout):
    """The listed form of a layout saved for the account"""
    return {"account_id": account_id, **layout}


async def _stored_layouts():
    """Every saved layout with the run it links to, read past row-level security"""
    async with TestSession() as session:
        rows = await session.execute(text(
            "SELECT account_id::text, headers, date_format, import_run_id::text FROM account_import_layouts ORDER BY updated_at"
        ))
        return [tuple(row) for row in rows]


async def test_a_completed_import_into_one_account_saves_how_its_file_was_read(client):
    """The next file with these headers could not start from the settings the user corrected last time."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    run_id, committed = await _import(client, headers, _into(account_id, category_id), _WEB_EXPORT)

    assert committed.status_code == 201, committed.text
    assert await _list_layouts(client, headers) == [_saved(account_id, _WEB_EXPORT)]
    assert await _stored_layouts() == [(account_id, _WEB_EXPORT["headers"], "dayFirst", run_id)]


async def test_a_file_with_other_headers_is_saved_beside_the_first_and_unlinks_it(client):
    """A second layout for the account replaced the first, or a later import took the first one's undo link with it."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    await _import(client, headers, _into(account_id, category_id), _WEB_EXPORT)

    mobile_run_id, committed = await _import(client, headers, _into(account_id, category_id), _MOBILE_EXPORT)

    assert committed.status_code == 201, committed.text
    assert await _list_layouts(client, headers) == [_saved(account_id, _MOBILE_EXPORT), _saved(account_id, _WEB_EXPORT)]

    # Only the last import can be undone, so the earlier run goes with this commit and its layout stays unlinked
    assert await _stored_layouts() == [
        (account_id, _WEB_EXPORT["headers"], "dayFirst", None),
        (account_id, _MOBILE_EXPORT["headers"], "yearFirst", mobile_run_id),
    ]


async def test_changed_settings_for_the_same_headers_replace_the_saved_ones(client):
    """A corrected setting, the separator included, was kept beside the old one instead of replacing it."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    await _import(client, headers, _into(account_id, category_id), _WEB_EXPORT)
    corrected = {**_WEB_EXPORT, "delimiter": ";", "date_format": "monthFirst", "header_row": 2}

    _run_id, committed = await _import(client, headers, _into(account_id, category_id), corrected)

    assert committed.status_code == 201, committed.text
    assert await _list_layouts(client, headers) == [_saved(account_id, corrected)]


async def test_each_account_keeps_its_own_layouts(client):
    """Settings saved for one account were listed for another account the file never went to."""
    headers, checking_id, category_id = await _setup_user_with_deps(client)
    savings_id = (await _create_account(client, headers, name="Savings", account_type="savings")).json()["id"]
    await _import(client, headers, _into(checking_id, category_id), _WEB_EXPORT)

    await _import(client, headers, _into(savings_id, category_id), _MOBILE_EXPORT)

    layouts = await _list_layouts(client, headers)
    assert sorted((layout["account_id"], layout["headers"][0]) for layout in layouts) == sorted(
        [(checking_id, "Date"), (savings_id, "Booked")]
    )


async def test_an_import_left_uncommitted_saves_nothing(client):
    """An abandoned import left its settings behind as if it had completed."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    run_id = await _open_run(client, headers, 1, csv_layout=_WEB_EXPORT)
    staged = await _stage_batch(client, headers, run_id, _into(account_id, category_id))
    assert staged.status_code == 204, staged.text

    dropped = await client.delete(f"/transactions/import/runs/{run_id}", headers=headers)

    assert dropped.status_code == 204
    assert await _list_layouts(client, headers) == []


async def test_a_commit_failing_after_the_save_leaves_no_layout(client, monkeypatch):
    """A commit that wrote nothing still kept the settings, because the save ran outside its transaction."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    async def fail_in_the_database(db, _user_id):
        await db.execute(text("SELECT 1 / 0"))

    monkeypatch.setattr(run_commit_module, "mark_user_cache_changed", fail_in_the_database)
    with pytest.raises(Exception, match="division by zero"):
        await _import(client, headers, _into(account_id, category_id), _WEB_EXPORT)
    monkeypatch.undo()

    assert await _list_layouts(client, headers) == []
    assert (await client.get("/transactions", headers=headers)).json() == []


async def test_a_repeated_commit_answers_without_saving_again(client):
    """A commit repeated after a lost response wrote the layout a second time over a newer state."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    run_id, _committed = await _import(client, headers, _into(account_id, category_id), _WEB_EXPORT)
    async with TestSession() as session:
        await session.execute(text("UPDATE account_import_layouts SET date_format = 'iso'"))
        await session.commit()

    repeated = await _commit_run(client, headers, run_id)

    assert repeated.status_code == 201, repeated.text
    assert [layout["date_format"] for layout in await _list_layouts(client, headers)] == ["iso"]


async def test_undo_deletes_a_layout_the_import_created(client):
    """Undoing an import kept the settings it saved, so the next file opened with settings nobody kept."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    run_id, _committed = await _import(client, headers, _into(account_id, category_id), _WEB_EXPORT)

    undone = await client.post(f"/transactions/import/runs/{run_id}/undo", headers=headers)

    assert undone.status_code == 200, undone.text
    assert await _list_layouts(client, headers) == []


async def test_undo_restores_the_layout_the_import_replaced(client):
    """Undoing an import lost the settings saved before it for the same headers."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    await _import(client, headers, _into(account_id, category_id), _WEB_EXPORT)
    corrected = {**_WEB_EXPORT, "delimiter": ";", "date_format": "monthFirst"}
    run_id, _committed = await _import(client, headers, _into(account_id, category_id), corrected)

    undone = await client.post(f"/transactions/import/runs/{run_id}/undo", headers=headers)

    assert undone.status_code == 200, undone.text
    assert await _list_layouts(client, headers) == [_saved(account_id, _WEB_EXPORT)]
    assert await _stored_layouts() == [(account_id, _WEB_EXPORT["headers"], "dayFirst", None)]


async def test_an_import_writing_rows_to_two_accounts_saves_nothing(client):
    """A file spread over two accounts saved its settings for one of them, chosen arbitrarily."""
    headers, checking_id, category_id = await _setup_user_with_deps(client)
    savings_id = (await _create_account(client, headers, name="Savings", account_type="savings")).json()["id"]
    batch = _into(checking_id, category_id, ("-4.50", "-3.25"))
    batch["accounts"].append({"source": "Savings", "account_id": savings_id})
    batch["rows"][1]["account_source"] = "Savings"

    _run_id, committed = await _import(client, headers, batch, _WEB_EXPORT)

    assert committed.status_code == 201, committed.text
    assert await _list_layouts(client, headers) == []


async def test_a_transfer_counterparty_does_not_count_as_a_second_account(client):
    """A transfer naming another account stopped the file's own account from getting its settings."""
    headers, checking_id, _category_id = await _setup_user_with_deps(client)
    savings_id = (await _create_account(client, headers, name="Savings", account_type="savings")).json()["id"]
    transfer_id = await _get_system_category_id(client, headers, "Transfer")
    batch = _csv_batch(
        ["-500.00"],
        account={"source": "Main Chequing", "account_id": checking_id},
        category={"source": "Transfer", "category_id": transfer_id},
    )
    batch["accounts"].append({"source": "Savings", "account_id": savings_id})
    batch["rows"][0]["counterparty_account_source"] = "Savings"

    _run_id, committed = await _import(client, headers, batch, _WEB_EXPORT)

    assert committed.status_code == 201, committed.text
    assert await _list_layouts(client, headers) == [_saved(checking_id, _WEB_EXPORT)]


async def test_an_import_into_a_shared_group_account_saves_nothing_for_anyone(client):
    """Settings were saved on an account the user reaches only through a group, or listed to its other members."""
    admin, member, member_id, _group_id, account_id, category_id, _merchant_id = await _setup_group_with_shared_account(client)
    await _grant_account_permission(client, admin, account_id, member_id, "write")

    _run_id, committed = await _import(client, member, _into(account_id, category_id), _WEB_EXPORT)

    assert committed.status_code == 201, committed.text
    assert await _stored_layouts() == []
    assert await _list_layouts(client, member) == []
    assert await _list_layouts(client, admin) == []


async def test_a_layout_stored_on_a_shared_group_account_is_listed_to_nobody(client):
    """A layout row on an account that became shared was listed to the group's members, who can reach the row."""
    admin, member, _member_id, _group_id, account_id, _category_id, _merchant_id = await _setup_group_with_shared_account(client)
    async with TestSession() as session:
        session.add(AccountImportLayout(account_id=uuid.UUID(account_id), header_key="0" * 64, **_WEB_EXPORT))
        await session.commit()

    assert await _list_layouts(client, member) == []
    assert await _list_layouts(client, admin) == []


@pytest.mark.parametrize(
    "change",
    [
        {"headers": ["Date", "Description", "Amount", *(f"Extra {n}" for n in range(MAX_CSV_LAYOUT_COLUMNS - 3))]},
        {"headers": ["Date", "x" * MAX_CSV_LAYOUT_HEADER_LENGTH], "column_map": {"dt": "Date"}},
        {"header_row": MAX_CSV_LAYOUT_LINE},
    ],
    ids=["most columns", "longest header", "furthest header row"],
)
async def test_a_layout_at_the_limits_the_page_keeps_is_accepted(client, change):
    """The page sends a layout right up to these limits, so a server refusing one would refuse the import."""
    headers, _account_id, _category_id = await _setup_user_with_deps(client)

    resp = await client.post(
        "/transactions/import/runs",
        json={"expected_transaction_count": 1, "csv_layout": {**_WEB_EXPORT, **change}},
        headers=headers,
    )

    assert resp.status_code == 201, resp.text


async def test_another_users_layouts_are_not_listed(client):
    """One user's saved settings, which name their account, were listed to someone else."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    await _import(client, headers, _into(account_id, category_id), _WEB_EXPORT)
    other, _other_account_id, _other_category_id = await _setup_user_with_deps(
        client, email="other@example.com", name_prefix="Other",
    )

    assert await _list_layouts(client, other) == []


@pytest.mark.parametrize(
    ("change", "location"),
    [
        ({"delimiter": "|"}, ["body", "csv_layout", "delimiter"]),
        ({"date_format": "julian"}, ["body", "csv_layout", "date_format"]),
        ({"amount_format": {"decimal_separator": "'", "grouping_separator": ","}},
         ["body", "csv_layout", "amount_format", "decimal_separator"]),
        ({"header_row": 0}, ["body", "csv_layout", "header_row"]),
        ({"header_row": MAX_CSV_LAYOUT_LINE + 1}, ["body", "csv_layout", "header_row"]),
        ({"headers": ["Date"]}, ["body", "csv_layout", "headers"]),
        ({"headers": ["Date", "Description", "Amount", *(f"Extra {n}" for n in range(MAX_CSV_LAYOUT_COLUMNS - 2))]},
         ["body", "csv_layout", "headers"]),
        ({"headers": ["Date", "x" * 257]}, ["body", "csv_layout", "headers", 1]),
        ({"column_map": {"account_id": "Date"}}, ["body", "csv_layout", "column_map", "account_id", "[key]"]),
        ({"column_map": {"dt": "Posted"}}, ["body", "csv_layout"]),
    ],
)
async def test_a_layout_outside_what_the_page_offers_is_refused(client, change, location):
    """A layout the import page could never send was stored and offered back to the next file."""
    headers, _account_id, _category_id = await _setup_user_with_deps(client)

    resp = await client.post(
        "/transactions/import/runs",
        json={"expected_transaction_count": 1, "csv_layout": {**_WEB_EXPORT, **change}},
        headers=headers,
    )

    assert resp.status_code == 422
    assert [error["loc"] for error in resp.json()["detail"]] == [location]


@pytest.mark.parametrize("source", ["firefly", "actual_budget"])
async def test_a_layout_is_refused_on_a_run_from_another_app(client, source):
    """A Firefly III or Actual Budget run carried CSV settings its commit would never save."""
    headers, _account_id, _category_id = await _setup_user_with_deps(client)

    resp = await client.post(
        "/transactions/import/runs",
        json={"expected_transaction_count": 1, "source": source, "csv_layout": _WEB_EXPORT},
        headers=headers,
    )

    assert resp.status_code == 422
    assert [error["loc"] for error in resp.json()["detail"]] == [["body"]]
