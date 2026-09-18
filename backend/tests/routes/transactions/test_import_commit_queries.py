"""Actual-route regressions for bounded committed import reference reads"""

import re
import uuid
from datetime import date

import pytest
from sqlalchemy import event, func, literal, select

from app.models.account import Account
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.transaction import Transaction
from app.services.importers.shared import categories as import_categories
from tests.conftest import TestSession, scoped_engine
from tests.routes.groups.test_transactions import _grant_account_permission, _setup_group_with_shared_account
from tests.routes.transactions.test_import_staging_queries import _build_reference_batch
from tests.routes.transactions.test_imports import _open_run

# Reference acquisition must remain bounded independently of necessary snapshot and write work
COMMIT_REFERENCE_SELECT_LIMIT = 16
REFERENCE_TABLES = re.compile(
    r"\b(?:FROM|JOIN) (?:accounts|account_permissions|group_members|categories|currencies|institutions)\b", re.IGNORECASE,
)


async def _commit_with_reference_count(client, headers, run_id):
    """Measure real reference reads without counting per-account snapshot reconstruction

    Args:
        client: Actual route client with app-role database identity
        headers: Synthetic caller authentication
        run_id: Fully staged run prepared outside the measurement

    Returns:
        Actual response and total/reference SELECT counts
    """
    counts = {"total": 0, "references": 0}

    def record(conn, cursor, statement, parameters, context, executemany):
        """Count statements without retaining parameters or changing their results"""
        if not statement.lstrip().upper().startswith("SELECT"):
            return
        counts["total"] += 1

        # Snapshot anchoring reads account creation time once per affected account by design
        snapshot_anchor = statement.lstrip().startswith("SELECT accounts.created_at,")
        if REFERENCE_TABLES.search(statement) and not snapshot_anchor:
            counts["references"] += 1

    event.listen(scoped_engine.sync_engine, "before_cursor_execute", record)
    try:
        response = await client.post(f"/transactions/import/runs/{run_id}/commit", headers=headers)
    finally:
        event.remove(scoped_engine.sync_engine, "before_cursor_execute", record)
    return response, counts


@pytest.mark.parametrize("count", [1, 10, 1000])
@pytest.mark.parametrize("mode", ["aliases", "distinct", "create_accounts", "reuse_category_names", "new_category_names"])
async def test_commit_reference_reads_are_bounded_with_exact_financial_rows_and_replay(client, count, mode):
    """Distinct destinations and normalized names expose lookup growth beyond alias memoization"""
    fixture_mode = "create" if mode == "create_accounts" else "distinct" if mode == "distinct" else "aliases"
    headers, batch = await _build_reference_batch(client, count, fixture_mode)
    if mode in {"reuse_category_names", "new_category_names"}:
        for index, mapping in enumerate(batch["categories"]):
            name = "Reference category 0" if mode == "reuse_category_names" else f"New category {index // 2}"
            mapping.pop("category_id")
            mapping["create"] = {"name": f" {name.upper() if index % 2 else name} ", "kind": "expense"}
    run_id = await _open_run(client, headers, count)
    staged = await client.post(f"/transactions/import/runs/{run_id}/rows", headers=headers, json=batch)
    assert staged.status_code == 204, staged.text
    committed, counts = await _commit_with_reference_count(client, headers, run_id)
    assert committed.status_code == 201, committed.text
    summary = committed.json()
    assert summary["transactions_created"] == count
    assert summary["accounts_created"] == (count if mode == "create_accounts" else 0)
    assert summary["categories_created"] == ((count + 1) // 2 if mode == "new_category_names" else 0)
    replay, replay_counts = await _commit_with_reference_count(client, headers, run_id)
    assert replay.status_code == 201, replay.text
    assert replay.json() == summary
    async with TestSession() as session:

        # Read the actual durable ledger to prove every source survived resolution and replay
        transactions = (await session.execute(select(Transaction).where(
            Transaction.account_id.in_([uuid.UUID(value) for value in summary["account_source_ids"].values()]),
        ))).scalars().all()
    assert len(transactions) == count
    by_notes = {transaction.notes: transaction for transaction in transactions}
    assert set(by_notes) == {f"Reference row {index}" for index in range(count)}
    for index in range(count):
        transaction = by_notes[f"Reference row {index}"]
        assert transaction.account_id == uuid.UUID(summary["account_source_ids"][f"Account {index}"])
        assert transaction.category_id == uuid.UUID(summary["category_source_ids"][f"Category {index}"])
        assert (transaction.amount, transaction.currency, transaction.dt) == (-123, "CAD", date(2026, 4, 10))
        assert transaction.counterparty_account_id is None
    assert counts["references"] <= COMMIT_REFERENCE_SELECT_LIMIT, {"mode": mode, "count": count, **counts}
    assert replay_counts["references"] <= COMMIT_REFERENCE_SELECT_LIMIT, replay_counts


@pytest.mark.parametrize("role", ["admin", "write_member"])
async def test_commit_batched_group_access_keeps_admin_and_explicit_write_success(client, role):
    """Shared-account policy still permits both administrators and explicitly writable members"""
    admin, member, member_id, _group_id, account_id, category_id, _merchant_id = await _setup_group_with_shared_account(client)
    if role == "write_member":
        await _grant_account_permission(client, admin, account_id, member_id, "write")
    headers = admin if role == "admin" else member
    batch = {
        "start_row_index": 0,
        "accounts": [{"source": f"Account {index}", "account_id": account_id} for index in range(10)],
        "categories": [{"source": f"Category {index}", "category_id": category_id} for index in range(10)],
        "rows": [{"account_source": f"Account {index}", "category_source": f"Category {index}",
                  "dt": "2026-04-10", "amount": "-1.23", "notes": f"Group row {index}", "tag_names": []}
                 for index in range(10)],
    }
    run_id = await _open_run(client, headers, 10)
    staged = await client.post(f"/transactions/import/runs/{run_id}/rows", headers=headers, json=batch)
    assert staged.status_code == 204, staged.text
    committed, counts = await _commit_with_reference_count(client, headers, run_id)
    assert committed.status_code == 201, committed.text
    assert committed.json()["transactions_created"] == 10
    transactions = (await client.get("/transactions", headers=headers)).json()
    assert len(transactions) == 10
    assert {(row["account_id"], row["category_id"], row["amount"]) for row in transactions} == {(account_id, category_id, -123)}
    assert counts["references"] <= COMMIT_REFERENCE_SELECT_LIMIT, counts


@pytest.mark.parametrize("name_case", ["personal_precedence", "database_case_key"])
async def test_commit_category_name_candidates_keep_personal_precedence_and_database_case_keys(client, name_case):
    """Category reuse keeps personal precedence and the legacy Python-to-database comparison"""
    headers, batch = await _build_reference_batch(client, 2, "aliases")
    account_id = uuid.UUID(batch["accounts"][0]["account_id"])
    async with TestSession() as session:

        # Use the synthetic owner and the database's actual locale rather than a Python case oracle
        owner_id = (await session.execute(select(Account.owner_id).where(Account.id == account_id))).scalar_one()
        if name_case == "personal_precedence":
            requested_name = "GROCERIES"
            system = (await session.execute(select(Category).where(
                Category.is_system.is_(True), func.lower(Category.name) == func.lower(literal(requested_name)),
            ))).scalar_one()
            existing_name = system.name
        else:
            requested_name = "Database İ category"
            existing_name = (await session.execute(select(func.lower(literal(requested_name))))).scalar_one()
        category = Category(id=uuid.uuid4(), owner_id=owner_id, name=existing_name, kind=CategoryKind.EXPENSE)
        session.add(category)
        await session.commit()
        expected_id = str(category.id)
    for mapping in batch["categories"]:
        mapping.pop("category_id")
        mapping["create"] = {"name": f" {requested_name} ", "kind": "expense"}
    run_id = await _open_run(client, headers, 2)
    staged = await client.post(f"/transactions/import/runs/{run_id}/rows", headers=headers, json=batch)
    assert staged.status_code == 204, staged.text
    committed, _counts = await _commit_with_reference_count(client, headers, run_id)
    if name_case == "database_case_key" and existing_name != requested_name.lower():
        assert committed.status_code == 500, committed.text
        assert committed.json()["detail"] == f"Category could not be created or found: {requested_name}"
        assert (await client.get("/transactions", headers=headers)).json() == []
        return
    assert committed.status_code == 201, committed.text
    summary = committed.json()
    assert summary["categories_created"] == 0
    assert summary["categories_reused"] == 1
    assert set(summary["category_source_ids"].values()) == {expected_id}
    transactions = (await client.get("/transactions", headers=headers)).json()
    assert len(transactions) == 2
    assert {(row["category_id"], row["amount"]) for row in transactions} == {(expected_id, -123)}


@pytest.mark.parametrize("collision_kind", ["expense", "income"])
async def test_commit_category_collision_rereads_real_row_and_updates_later_source_facts(client, monkeypatch, collision_kind):
    """A separate writer after preload preserves conflict recovery and kind refusal"""
    headers, batch = await _build_reference_batch(client, 2, "aliases")
    account_id = uuid.UUID(batch["accounts"][0]["account_id"])
    async with TestSession() as session:

        # Stamp the independent writer's category with the same real synthetic owner
        owner_id = (await session.execute(select(Account.owner_id).where(Account.id == account_id))).scalar_one()
    for index, mapping in enumerate(batch["categories"]):
        mapping.pop("category_id")
        mapping["create"] = {"name": "Concurrent category" if index == 0 else "CONCURRENT CATEGORY", "kind": "expense"}
    original_loader = import_categories._load_import_category_name_facts
    original_reread = import_categories._select_reusable_import_category
    created_ids = []
    reread_names = []

    async def load_then_commit_writer(db, user_id, names):
        """Pause after the real preload and commit a real independent conflicting category"""
        facts = await original_loader(db, user_id, names)
        async with TestSession() as writer:
            category = Category(id=uuid.uuid4(), owner_id=owner_id, name="Concurrent category",
                                kind=CategoryKind(collision_kind))
            writer.add(category)
            await writer.commit()
            created_ids.append(str(category.id))
        return facts

    async def record_real_reread(db, user_id, name):
        """Observe fallback calls while retaining their actual database results"""
        reread_names.append(name)
        return await original_reread(db, user_id, name)

    run_id = await _open_run(client, headers, 2)
    staged = await client.post(f"/transactions/import/runs/{run_id}/rows", headers=headers, json=batch)
    assert staged.status_code == 204, staged.text
    monkeypatch.setattr(import_categories, "_load_import_category_name_facts", load_then_commit_writer)
    monkeypatch.setattr(import_categories, "_select_reusable_import_category", record_real_reread)
    committed = await client.post(f"/transactions/import/runs/{run_id}/commit", headers=headers)
    assert reread_names == ["Concurrent category"]
    if collision_kind == "income":
        assert committed.status_code == 422, committed.text
        assert committed.json()["detail"] == (
            "A category named Concurrent category already records income, "
            "so this import cannot create Concurrent category as expense. "
            "Match this value to that category, or set its type to income."
        )
        assert (await client.get("/transactions", headers=headers)).json() == []
    else:
        assert committed.status_code == 201, committed.text
        assert committed.json()["categories_created"] == 0
        assert committed.json()["categories_reused"] == 1
        assert set(committed.json()["category_source_ids"].values()) == set(created_ids)
        rows = (await client.get("/transactions", headers=headers)).json()
        assert len(rows) == 2
        assert {(row["category_id"], row["amount"]) for row in rows} == {(created_ids[0], -123)}
