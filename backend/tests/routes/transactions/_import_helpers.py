import uuid
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import select, text

from app.models.account import Account
from app.models.base import AccountKind, AccountType, CategoryKind
from app.models.category import Category
from app.models.merchant import Merchant
from app.services.importers.shared.run_staging import ABANDONED_RUN_AGE
from tests.conftest import TestSession
from tests.routes.transactions._helpers import _seed_institution, _setup_user_with_deps

# Just either side of the age at which a run left uncommitted counts as abandoned
_PAST_ABANDONMENT = ABANDONED_RUN_AGE + timedelta(minutes=1)
_SHORT_OF_ABANDONMENT = ABANDONED_RUN_AGE - timedelta(minutes=1)

# The importers whose runs stage journal rows, which go through the journal endpoints rather than the CSV ones
_JOURNAL_SOURCES = {"firefly", "actual_budget"}


def _run_endpoint(run_id, source, action):
    """Return the path an importer stages its rows or commits its run through"""
    prefix = "journal/" if source in _JOURNAL_SOURCES else ""
    return f"/transactions/import/runs/{run_id}/{prefix}{action}"


async def _open_run(client, headers, expected_transaction_count=1, source="generic"):
    """Open a run for the given importer and return its id"""
    resp = await client.post(
        "/transactions/import/runs",
        json={"expected_transaction_count": expected_transaction_count, "source": source},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _stage_batch(client, headers, run_id, batch, source="generic"):
    """Stage one batch through the endpoint the run's importer uses, and return the response"""
    return await client.post(_run_endpoint(run_id, source, "rows"), json=batch, headers=headers)


async def _commit_run(client, headers, run_id, source="generic"):
    """Commit a run through the endpoint its importer uses, and return the response"""
    return await client.post(_run_endpoint(run_id, source, "commit"), headers=headers)


async def _open_staged_run(client, headers, payload, source="generic"):
    """Open a run sized to the payload's rows and stage them all as one batch, returning the run's id"""
    run_id = await _open_run(client, headers, len(payload["rows"]), source)
    resp = await _stage_batch(client, headers, run_id, {**payload, "start_row_index": 0}, source)
    assert resp.status_code == 204, resp.text
    return run_id


async def _import_run(client, headers, payload, source="generic", budgets=None, archive=None):
    """Stage a whole payload as one batch, with any budgets and archiving, and commit it

    The importer stages a file over as many batches as its size needs, and only the commit writes
    anything, so a test importing a handful of rows opens a run, stages them all at once and commits

    Args:
        client: The async test client
        headers: Auth headers for the importing user
        payload: Account mappings, category mappings and rows, as the import screen builds them
        source: Importer the run is opened for
        budgets: The budgets request, left unsent when None
        archive: The accounts to archive request, left unsent when None

    Returns:
        The commit response, or the first call that refused the import
    """
    run_id = await _open_run(client, headers, len(payload["rows"]), source)
    staged = await _stage_batch(client, headers, run_id, {**payload, "start_row_index": 0}, source)
    if staged.status_code != 204:
        return staged

    for part, body in (("budgets", budgets), ("archive", archive)):
        if body is not None:
            resp = await client.put(f"/transactions/import/runs/{run_id}/{part}", json=body, headers=headers)
            if resp.status_code != 204:
                return resp

    return await _commit_run(client, headers, run_id, source)


async def _age_run(run_id, age):
    """Move a run's opening back, as if it had been left that long"""
    async with TestSession() as session:
        await session.execute(
            text("UPDATE import_runs SET created_at = created_at - CAST(:age AS interval) WHERE id = :id"),
            {"age": age, "id": run_id},
        )
        await session.commit()


def _firefly_row(**overrides):
    """Build a Firefly III import row payload with expense-row defaults

    Args:
        **overrides: Fields to override in the default payload

    Returns:
        Row payload dictionary for the import request
    """
    row = {
        "journal_id": "1",
        "type": "withdrawal",
        "dt": "2026-04-10",
        "amount": "45.67",
        "currency_code": "CAD",
        "description": "Weekly groceries",
        "source_account": "Everyday Chequing",
        "destination_name": "Neighbourhood Grocer",
        "category": "Groceries",
        "tag_names": [],
    }
    row.update(overrides)
    return row


def _chequing_mapping():
    """Build the default chequing account create mapping

    Returns:
        Account mapping dictionary for the import request
    """
    return {
        "source": "Everyday Chequing",
        "create": {"name": "Everyday Chequing", "account_type": "checking", "currency": "CAD"},
    }


async def _list_transactions(client, headers):
    """Read every transaction the user has, a page at a time"""
    transactions = []
    while True:
        resp = await client.get(
            "/transactions",
            params={"sort_by": "dt", "sort_order": "asc", "limit": 50, "offset": len(transactions)},
            headers=headers,
        )
        page = resp.json()
        transactions.extend(page)
        if len(page) < 50:
            return transactions


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


# A new user already has Groceries, so a run creating it reuses that category at the commit
_GROCERIES = {"source": "Groceries", "create": {"name": "Groceries", "kind": "expense"}}

_NEW_MAIN_CHEQUING = {"source": "Main Chequing", "create": {"name": "Main Chequing", "account_type": "checking", "currency": "CAD"}}


def _csv_batch(amounts, start_row_index=0, account=_NEW_MAIN_CHEQUING, category=_GROCERIES):
    """Build a CSV batch with one row per amount, all in one account and one category"""
    return {
        "accounts": [account],
        "categories": [category],
        "rows": [
            {"account_source": account["source"], "category_source": category["source"], "dt": "2026-04-10", "amount": amount, "tag_names": []}
            for amount in amounts
        ],
        "start_row_index": start_row_index,
    }


def _firefly_batch(row_count, start_row_index=0):
    """Build a Firefly III batch of the given number of withdrawals, all from one new account under Groceries"""
    return {
        "accounts": [_chequing_mapping()],
        "categories": [_GROCERIES],
        "rows": [_firefly_row(journal_id=str(start_row_index + index)) for index in range(row_count)],
        "start_row_index": start_row_index,
    }


def _format_manifest_amount(minor_units, exponent=2):
    """Write minor units the way an export's manifest writes amounts"""
    return f"{Decimal(minor_units).scaleb(-exponent):.{exponent}f}"
