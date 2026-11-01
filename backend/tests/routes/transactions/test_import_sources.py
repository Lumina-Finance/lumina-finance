"""Remembering which importer last brought transactions into each account, so its import page can open on it"""

import uuid

from sqlalchemy import text

from app.models.account_import_source import AccountImportSource
from tests.conftest import TestSession
from tests.routes.groups.test_transactions import _grant_account_permission, _setup_group_with_shared_account
from tests.routes.support import _create_user, _get_auth_header
from tests.routes.transactions._helpers import _create_account, _setup_user_with_deps
from tests.routes.transactions._import_helpers import _csv_batch, _firefly_batch, _import_run

_SOURCES = "/transactions/import/sources"


def _into(account_id, category_id, amounts=("-4.50",)):
    """Build a batch writing one row per amount to the account under the category"""
    return _csv_batch(
        list(amounts),
        account={"source": "Main Chequing", "account_id": account_id},
        category={"source": "Groceries", "category_id": category_id},
    )


async def _import(client, headers, account_id, category_id, source):
    """Commit a one-row import from the given importer into the account, returning the run's id"""
    committed = await _import_run(client, headers, _into(account_id, category_id), source=source)
    assert committed.status_code == 201, committed.text
    return (await client.get("/transactions/import/last", headers=headers)).json()["id"]


async def _list_sources(client, headers):
    resp = await client.get(_SOURCES, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _undo(client, headers, run_id):
    undone = await client.post(f"/transactions/import/runs/{run_id}/undo", headers=headers)
    assert undone.status_code == 200, undone.text


async def test_an_account_with_no_import_has_no_remembered_source(client):
    """An account nothing was imported into was listed with a source, so its page opened on a stranger's choice."""
    headers, _account_id, _category_id = await _setup_user_with_deps(client)

    assert await _list_sources(client, headers) == []


async def test_an_ofx_import_is_remembered_for_the_account_it_went_to(client):
    """The page could not open on OFX/QFX for an account the user always imports statements into."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    await _import(client, headers, account_id, category_id, "ofx")

    assert await _list_sources(client, headers) == [{"account_id": account_id, "source": "ofx"}]


async def test_a_qif_import_is_remembered_for_the_account_it_went_to(client):
    """The page opened on CSV for an account the user always imports QIF files into."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    await _import(client, headers, account_id, category_id, "qif")

    assert await _list_sources(client, headers) == [{"account_id": account_id, "source": "qif"}]


async def test_a_later_import_from_another_importer_replaces_the_remembered_source(client):
    """Importing a CSV after an OFX file left the account remembered as an OFX one."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    await _import(client, headers, account_id, category_id, "ofx")

    await _import(client, headers, account_id, category_id, "generic")

    assert await _list_sources(client, headers) == [{"account_id": account_id, "source": "generic"}]


async def test_each_account_keeps_its_own_source(client):
    """One account's source was listed for the other, or one import overwrote the other account's."""
    headers, checking_id, category_id = await _setup_user_with_deps(client)
    savings_id = (await _create_account(client, headers, name="Savings", account_type="savings")).json()["id"]
    await _import(client, headers, checking_id, category_id, "ofx")

    await _import(client, headers, savings_id, category_id, "generic")

    assert sorted((entry["account_id"], entry["source"]) for entry in await _list_sources(client, headers)) == sorted(
        [(checking_id, "ofx"), (savings_id, "generic")]
    )


async def test_an_import_spread_over_two_accounts_remembers_the_source_for_both(client):
    """A file written to two accounts remembered its source for only one of them."""
    headers, checking_id, category_id = await _setup_user_with_deps(client)
    savings_id = (await _create_account(client, headers, name="Savings", account_type="savings")).json()["id"]
    batch = _into(checking_id, category_id, ("-4.50", "-3.25"))
    batch["accounts"].append({"source": "Savings", "account_id": savings_id})
    batch["rows"][1]["account_source"] = "Savings"

    committed = await _import_run(client, headers, batch, source="ofx")

    assert committed.status_code == 201, committed.text
    assert sorted(entry["account_id"] for entry in await _list_sources(client, headers)) == sorted([checking_id, savings_id])


async def test_a_provider_import_is_remembered_for_the_accounts_it_created(client):
    """Only the CSV and OFX flows were remembered, so a Firefly III account always reopened on CSV."""
    headers = _get_auth_header(await _create_user(client))

    committed = await _import_run(client, headers, _firefly_batch(1), source="firefly")

    assert committed.status_code == 201, committed.text
    assert await _list_sources(client, headers) == [
        {"account_id": committed.json()["created_account_ids"][0], "source": "firefly"},
    ]


async def test_an_uncommitted_import_remembers_nothing(client):
    """An import abandoned before its commit changed which source the account opens on."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    run = await client.post(
        "/transactions/import/runs",
        json={"expected_transaction_count": 1, "source": "ofx"},
        headers=headers,
    )
    staged = await client.post(
        f"/transactions/import/runs/{run.json()['id']}/rows",
        json={**_into(account_id, category_id), "start_row_index": 0},
        headers=headers,
    )
    assert staged.status_code == 204, staged.text

    assert await _list_sources(client, headers) == []


async def test_undo_forgets_a_source_the_import_remembered(client):
    """Undoing the account's only import left it opening on a source nothing was imported with."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    run_id = await _import(client, headers, account_id, category_id, "ofx")

    await _undo(client, headers, run_id)

    assert await _list_sources(client, headers) == []


async def test_undo_restores_the_source_the_import_replaced(client):
    """Undoing a CSV import after an OFX one left the account opening on CSV, which was not its last kept import."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    await _import(client, headers, account_id, category_id, "ofx")
    run_id = await _import(client, headers, account_id, category_id, "generic")

    await _undo(client, headers, run_id)

    assert await _list_sources(client, headers) == [{"account_id": account_id, "source": "ofx"}]


async def test_an_import_into_a_shared_group_account_remembers_nothing_for_anyone(client):
    """A source was remembered for an account the user reaches only through a group, or listed to its other members."""
    admin, member, member_id, _group_id, account_id, category_id, _merchant_id = await _setup_group_with_shared_account(client)
    await _grant_account_permission(client, admin, account_id, member_id, "write")

    committed = await _import_run(client, member, _into(account_id, category_id), source="ofx")

    assert committed.status_code == 201, committed.text
    assert await _list_sources(client, member) == []
    assert await _list_sources(client, admin) == []


async def test_a_source_stored_on_a_shared_group_account_is_listed_to_nobody(client):
    """A row on an account that became shared was listed to the group's members, who can reach the row."""
    admin, member, _member_id, _group_id, account_id, _category_id, _merchant_id = await _setup_group_with_shared_account(client)
    async with TestSession() as session:
        session.add(AccountImportSource(account_id=uuid.UUID(account_id), source="ofx"))
        await session.commit()

    assert await _list_sources(client, member) == []
    assert await _list_sources(client, admin) == []


async def test_another_user_is_not_listed_the_sources_of_accounts_they_do_not_own(client):
    """One user's remembered sources were listed to another."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    await _import(client, headers, account_id, category_id, "ofx")
    other_headers, _, _ = await _setup_user_with_deps(client, email="other@example.com", name_prefix="Other")

    assert await _list_sources(client, other_headers) == []


async def test_a_repeated_commit_answers_without_remembering_again(client):
    """A commit repeated after a lost response saved the source a second time over a newer state."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    run_id = await _import(client, headers, account_id, category_id, "ofx")
    async with TestSession() as session:
        await session.execute(text("UPDATE account_import_sources SET source = 'generic'"))
        await session.commit()

    repeated = await client.post(f"/transactions/import/runs/{run_id}/commit", headers=headers)

    assert repeated.status_code == 201, repeated.text
    assert await _list_sources(client, headers) == [{"account_id": account_id, "source": "generic"}]
