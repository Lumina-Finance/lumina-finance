"""Actual-route regressions for bounded import reference reads"""

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import event, select
from sqlalchemy.exc import MultipleResultsFound

from app.database import current_user_id_ctx
from app.models.account import Account, AccountPermission
from app.models.base import AccountKind, AccountType, CategoryKind, PermissionLevel
from app.models.category import Category
from app.models.import_run import ImportRun, ImportStagedRow
from app.models.merchant import Merchant
from app.permissions.accounts import check_account_access, load_account_access_lookup
from tests.conftest import ScopedSession, TestSession, scoped_engine
from tests.routes.groups.test_transactions import (
    _grant_account_permission,
    _setup_group_with_shared_account,
)
from tests.routes.support import _get_system_merchant_id
from tests.routes.transactions._helpers import (
    _create_category,
    _create_merchant,
    _get_system_category_id,
    _seed_institution,
    _setup_user_with_deps,
)
from tests.routes.transactions.test_imports import _open_run

# Includes authentication and the run read, while remaining independent of declaration count
STAGING_SELECT_LIMIT = 16


async def _stage_with_select_count(client, headers, run_id, batch):
    """Count real SELECTs only while the app-role staging request executes"""
    statements = []

    def record(conn, cursor, statement, parameters, context, executemany):
        """Record statement text without parameters or replacing the real query"""
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    event.listen(scoped_engine.sync_engine, "before_cursor_execute", record)
    try:
        response = await client.post(f"/transactions/import/runs/{run_id}/rows", headers=headers, json=batch)
    finally:
        event.remove(scoped_engine.sync_engine, "before_cursor_execute", record)
    return response, len(statements)


async def _build_reference_batch(client, count, mode):
    """Seed real distinct destinations or source aliases outside the measured request"""
    headers, account_id, _category_id = await _setup_user_with_deps(client)
    institution = await _seed_institution()
    size = count if mode == "distinct" else 1
    async with TestSession() as session:

        # Reuse the synthetic dependency account's owner for isolated reference fixtures
        owner_id = (await session.execute(select(Account.owner_id).where(Account.id == uuid.UUID(account_id)))).scalar_one()
        accounts = [Account(
            id=uuid.uuid4(), owner_id=owner_id, account_kind=AccountKind.ASSET,
            account_type=AccountType.CHECKING, name=f"Reference account {i}",
            currency="CAD", institution_id=institution.id, is_archived=False,
        ) for i in range(size)]
        categories = [Category(
            id=uuid.uuid4(), owner_id=owner_id, name=f"Reference category {i}", kind=CategoryKind.EXPENSE,
        ) for i in range(size)]
        merchants = [Merchant(id=uuid.uuid4(), owner_id=owner_id, name=f"Reference merchant {i}") for i in range(size)]
        session.add_all([*accounts, *categories, *merchants])
        await session.commit()

    account_mappings = [{"source": f"Account {i}", "account_id": str(accounts[i % size].id)} for i in range(count)]
    category_mappings = [{"source": f"Category {i}", "category_id": str(categories[i % size].id)} for i in range(count)]
    merchant_mappings = [{"source": f"Payee {i}", "merchant_id": str(merchants[i % size].id)} for i in range(count)]
    if mode == "create":
        account_mappings = [{
            "source": f"Account {i}",
            "create": {"name": f"Created account {i}", "account_type": "checking", "currency": "cad",
                       "institution_id": str(institution.id)},
        } for i in range(count)]
    return headers, {
        "start_row_index": 0, "accounts": account_mappings, "categories": category_mappings,
        "merchants": merchant_mappings,
        "rows": [{"account_source": f"Account {i}", "category_source": f"Category {i}",
                  "merchant_name": f"Payee {i}", "dt": "2026-04-10", "amount": "-1.23",
                  "notes": f"Reference row {i}", "tag_names": [], "counterparty_account_source": None} for i in range(count)],
    }


@pytest.mark.parametrize("count", [1, 10, 1000])
@pytest.mark.parametrize("mode", ["aliases", "distinct", "create"])
async def test_staging_reference_selects_are_bounded_and_replay_keeps_exact_rows(client, count, mode):
    """Distinct IDs prevent a destination memoization workaround from satisfying the query bound"""
    headers, batch = await _build_reference_batch(client, count, mode)
    run_id = await _open_run(client, headers, count)
    first, first_count = await _stage_with_select_count(client, headers, run_id, batch)
    replay, replay_count = await _stage_with_select_count(client, headers, run_id, batch)
    assert first.status_code == 204, first.text
    assert replay.status_code == 204, replay.text
    async with TestSession() as session:

        # Inspect durable staging after replay rather than trusting a successful empty response
        rows = (await session.execute(
            select(ImportStagedRow).where(ImportStagedRow.import_run_id == uuid.UUID(run_id)).order_by(ImportStagedRow.row_index),
        )).scalars().all()

        # Every declaration must remain available for later commit resolution
        run = (await session.execute(select(ImportRun).where(ImportRun.id == uuid.UUID(run_id)))).scalar_one()
        assert len(run.account_mappings) == count
        assert len(run.category_mappings) == count
        assert len(run.merchant_mappings) == count
    assert [row.row_index for row in rows] == list(range(count))
    assert [row.payload for row in rows] == batch["rows"]
    assert first_count <= STAGING_SELECT_LIMIT, {"mode": mode, "count": count, "selects": first_count}
    assert replay_count <= STAGING_SELECT_LIMIT, {"mode": mode, "count": count, "selects": replay_count}


async def test_staging_group_alias_reads_are_bounded_and_read_grant_does_not_authorize_commit(client):
    """Staging keeps its weaker read rule while commit independently requires write access"""
    admin, member, member_id, _group_id, account_id, category_id, _merchant_id = await _setup_group_with_shared_account(client)
    await _grant_account_permission(client, admin, account_id, member_id, "read")
    count = 10
    batch = {
        "start_row_index": 0,
        "accounts": [{"source": f"Account {i}", "account_id": account_id} for i in range(count)],
        "categories": [{"source": f"Category {i}", "category_id": category_id} for i in range(count)],
        "rows": [{"account_source": f"Account {i}", "category_source": f"Category {i}",
                  "dt": "2026-04-10", "amount": "-1.23", "tag_names": []} for i in range(count)],
    }
    run_id = await _open_run(client, member, count)
    staged, selects = await _stage_with_select_count(client, member, run_id, batch)
    assert staged.status_code == 204, staged.text
    committed = await client.post(f"/transactions/import/runs/{run_id}/commit", headers=member)
    assert committed.status_code == 403
    assert committed.json()["detail"] == "Insufficient permissions"
    assert (await client.get("/transactions", headers=member)).json() == []
    assert selects <= STAGING_SELECT_LIMIT, {"selects": selects}


@pytest.mark.parametrize("case, status_code, detail", [
    ("account_first", 404, "Account not found"),
    ("currency_first", 422, "Invalid currency code: ZZZ"),
    ("institution_first", 422, "Institution not found"),
    ("category_first", 422, "Category not found"),
    ("merchant_first", 422, "Merchant not found"),
])
async def test_staging_reports_errors_in_declaration_order_without_partial_rows(client, case, status_code, detail):
    """Preloading reference facts must not move a later refusal ahead of the existing first error"""
    headers, batch = await _build_reference_batch(client, 1, "aliases")
    missing = str(uuid.uuid4())
    invalid_create = {"source": "Invalid", "create": {"name": "Invalid", "account_type": "checking", "currency": "ZZZ"}}
    if case == "account_first":
        batch["accounts"][0]["account_id"] = missing
        batch["accounts"].append(invalid_create)
    elif case == "currency_first":
        batch["accounts"].insert(0, invalid_create)
        batch["accounts"][1]["account_id"] = missing
    elif case == "institution_first":
        batch["accounts"].insert(0, {"source": "Invalid", "create": {
            "name": "Invalid", "account_type": "checking", "currency": "CAD", "institution_id": missing,
        }})
    if case in {"account_first", "currency_first", "institution_first", "category_first"}:
        batch["categories"][0]["category_id"] = missing
    batch["merchants"][0]["merchant_id"] = missing
    run_id = await _open_run(client, headers, 1)
    response, _selects = await _stage_with_select_count(client, headers, run_id, batch)
    assert response.status_code == status_code, response.text
    assert response.json()["detail"] == detail
    async with TestSession() as session:

        # A refused declaration cannot persist either rows or earlier accepted mappings
        assert (await session.execute(select(ImportStagedRow.id).where(
            ImportStagedRow.import_run_id == uuid.UUID(run_id),
        ))).scalars().all() == []
        run = (await session.execute(select(ImportRun).where(ImportRun.id == uuid.UUID(run_id)))).scalar_one()
        assert run.account_mappings == run.category_mappings == run.merchant_mappings == {}


@pytest.mark.parametrize("scope", ["system", "personal", "group_category", "group_merchant", "foreign_category", "foreign_merchant"])
async def test_staging_keeps_category_and_merchant_visibility_distinct(client, scope):
    """Group categories are usable while group and foreign merchants remain refused"""
    admin, member, member_id, _group_id, account_id, category_id, group_merchant_id = await _setup_group_with_shared_account(client)
    await _grant_account_permission(client, admin, account_id, member_id, "read")
    merchant_id = await _get_system_merchant_id(client, member)
    if scope == "system":
        category_id = await _get_system_category_id(client, member, "Groceries")
    elif scope == "personal":
        category = await _create_category(client, member, name="Member category")
        merchant = await _create_merchant(client, member, name="Member merchant")
        assert category.status_code == merchant.status_code == 201
        category_id, merchant_id = category.json()["id"], merchant.json()["id"]
    elif scope == "group_merchant":
        merchant_id = group_merchant_id
    elif scope == "foreign_category":
        category = await _create_category(client, admin, name="Private admin category")
        assert category.status_code == 201
        category_id = category.json()["id"]
    elif scope == "foreign_merchant":
        merchant = await _create_merchant(client, admin, name="Private admin merchant")
        assert merchant.status_code == 201
        merchant_id = merchant.json()["id"]
    batch = {
        "start_row_index": 0,
        "accounts": [{"source": "Holding", "account_id": account_id}],
        "categories": [{"source": "Category", "category_id": category_id}],
        "merchants": [{"source": "Payee", "merchant_id": merchant_id}],
        "rows": [{"account_source": "Holding", "category_source": "Category", "merchant_name": "Payee",
                  "dt": "2026-04-10", "amount": "-1.23", "tag_names": []}],
    }
    run_id = await _open_run(client, member, 1)
    response, _selects = await _stage_with_select_count(client, member, run_id, batch)
    if scope in {"group_merchant", "foreign_merchant"}:
        assert response.status_code == 422
        assert response.json()["detail"] == "Merchant not found"
    elif scope == "foreign_category":
        assert response.status_code == 422
        assert response.json()["detail"] == "Category not found"
    else:
        assert response.status_code == 204, response.text


async def test_staging_trimmed_source_replay_preserves_one_mapping_per_source(client):
    """Reference preloading leaves the existing trimmed declaration merge contract intact"""
    headers, batch = await _build_reference_batch(client, 1, "aliases")
    for key in ["accounts", "categories", "merchants"]:
        batch[key][0]["source"] = f" {batch[key][0]['source']} "
    run_id = await _open_run(client, headers, 1)
    first, _first_count = await _stage_with_select_count(client, headers, run_id, batch)
    assert first.status_code == 204, first.text
    for key in ["accounts", "categories", "merchants"]:
        batch[key][0]["source"] = batch[key][0]["source"].strip()
    replay, _replay_count = await _stage_with_select_count(client, headers, run_id, batch)
    assert replay.status_code == 204, replay.text
    async with TestSession() as session:

        # Whitespace variants must merge to the same durable source declarations
        run = (await session.execute(select(ImportRun).where(ImportRun.id == uuid.UUID(run_id)))).scalar_one()
        assert set(run.account_mappings) == {"Account 0"}
        assert set(run.category_mappings) == {"Category 0"}
        assert len(run.merchant_mappings) == 1


async def test_account_access_lookup_rejects_another_user_and_does_not_refetch_missing_entries(client):
    """Caller-local facts cannot authorize another identity or silently reread an omitted account"""
    _headers, account_id, _category_id = await _setup_user_with_deps(client)
    async with TestSession() as session:

        # Use the actual synthetic account owner when stamping the runtime session identity
        owner_id = (await session.execute(select(Account.owner_id).where(Account.id == uuid.UUID(account_id)))).scalar_one()
    token = current_user_id_ctx.set(owner_id)
    try:
        async with ScopedSession() as session:
            lookup = await load_account_access_lookup(session, {uuid.UUID(account_id)}, owner_id)
            account = await check_account_access(session, uuid.UUID(account_id), owner_id, PermissionLevel.READ,
                                                 access_lookup=lookup)
            assert account.id == uuid.UUID(account_id)
            with pytest.raises(ValueError, match="belongs to another user"):
                await check_account_access(session, uuid.UUID(account_id), uuid.uuid4(), PermissionLevel.READ,
                                           access_lookup=lookup)
            empty = await load_account_access_lookup(session, set(), owner_id)
            with pytest.raises(HTTPException) as error:
                await check_account_access(session, uuid.UUID(account_id), owner_id, PermissionLevel.READ,
                                           access_lookup=empty)
            assert error.value.status_code == 404
            assert error.value.detail == "Account not found"
    finally:
        current_user_id_ctx.reset(token)


async def test_staging_facts_do_not_survive_permission_revocation_before_commit(client):
    """Each new request uses current authorization rather than facts from successful staging"""
    admin, member, member_id, _group_id, account_id, category_id, _merchant_id = await _setup_group_with_shared_account(client)
    permission = await client.post(f"/accounts/{account_id}/permissions", headers=admin,
                                   json={"user_id": member_id, "level": "write"})
    assert permission.status_code == 201, permission.text
    batch = {
        "start_row_index": 0, "accounts": [{"source": "Holding", "account_id": account_id}],
        "categories": [{"source": "Category", "category_id": category_id}],
        "rows": [{"account_source": "Holding", "category_source": "Category", "dt": "2026-04-10",
                  "amount": "-1.23", "tag_names": []}],
    }
    run_id = await _open_run(client, member, 1)
    first, _first_count = await _stage_with_select_count(client, member, run_id, batch)
    assert first.status_code == 204, first.text
    revoked = await client.delete(f"/accounts/{account_id}/permissions/{permission.json()['id']}", headers=admin)
    assert revoked.status_code == 204, revoked.text
    replay, _replay_count = await _stage_with_select_count(client, member, run_id, batch)
    assert replay.status_code == 404
    assert replay.json()["detail"] == "Account not found"
    commit = await client.post(f"/transactions/import/runs/{run_id}/commit", headers=member)
    assert commit.status_code == 404
    assert commit.json()["detail"] == "Account not found"
    assert (await client.get("/transactions", headers=admin)).json() == []


async def test_account_access_lookup_preserves_duplicate_grant_cardinality_error(client):
    """The lookup retains all grants matched by the original account-and-user query"""
    admin, _member, member_id, _group_id, account_id, _category_id, _merchant_id = await _setup_group_with_shared_account(client)
    await _grant_account_permission(client, admin, account_id, member_id, "read")
    second_group = await client.post("/groups", headers=admin, json={"name": "Other group"})
    assert second_group.status_code == 201, second_group.text
    second_group_id = second_group.json()["id"]
    added = await client.post(f"/groups/{second_group_id}/members", headers=admin, json={"user_id": member_id})
    assert added.status_code == 201, added.text
    async with TestSession() as session:

        # The schema allows a second group's grant for the same account, so preserve the old refusal
        session.add(AccountPermission(
            group_id=uuid.UUID(second_group_id), user_id=uuid.UUID(member_id),
            account_id=uuid.UUID(account_id), level=PermissionLevel.READ,
        ))
        await session.commit()
    token = current_user_id_ctx.set(uuid.UUID(member_id))
    try:
        async with ScopedSession() as session:
            lookup = await load_account_access_lookup(session, {uuid.UUID(account_id)}, uuid.UUID(member_id))
            assert len(lookup.permissions[uuid.UUID(account_id)]) == 2
            for facts in [None, lookup]:
                with pytest.raises(MultipleResultsFound):
                    await check_account_access(session, uuid.UUID(account_id), uuid.UUID(member_id), PermissionLevel.READ,
                                               access_lookup=facts)
    finally:
        current_user_id_ctx.reset(token)
