

from datetime import UTC, datetime

from tests.routes.support import _create_user, _get_auth_header
from tests.routes.transactions._helpers import _create_account, _seed_usd_currency

# --- POST /transactions/import/firefly ---


def _firefly_row(**overrides):
    """Build a Firefly III import row payload with expense-row defaults

    Args:
        **overrides: Fields to override in the default payload

    Returns:
        Row payload dictionary for the import request
    """
    row = {
        "journal_id": "1",
        "type": "Withdrawal",
        "dt": "2026-04-10",
        "amount": "-45.67",
        "currency_code": "CAD",
        "description": "Weekly groceries",
        "source_name": "Everyday Chequing",
        "source_type": "Asset account",
        "destination_name": "Neighbourhood Grocer",
        "destination_type": "Expense account",
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


async def _get_system_category_id(client, headers, name):
    """Return the id of a system category by name

    Args:
        client: The async test client
        headers: Auth headers for the requesting user
        name: System category name to find

    Returns:
        Category id string
    """
    resp = await client.get("/categories", headers=headers)
    return next(category["id"] for category in resp.json() if category["name"] == name)


async def test_firefly_import_creates_expense_and_income_rows(client):
    """Withdrawals become negative expenses and deposits positive income with counterparty merchants."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.post("/transactions/import/firefly", json={
        "accounts": [_chequing_mapping()],
        "categories": [
            {"source": "Groceries", "create": {"name": "Groceries", "kind": "expense"}},
            {"source": "Salary", "create": {"name": "Salary", "kind": "income"}},
        ],
        "rows": [
            _firefly_row(notes="Bought extra snacks", tag_names=["food"]),
            _firefly_row(
                journal_id="2",
                type="Deposit",
                amount="2410.66",
                description="Biweekly salary",
                source_name="Employer Payroll",
                source_type="Revenue account",
                destination_name="Everyday Chequing",
                destination_type="Asset account",
                category="Salary",
            ),
        ],
    }, headers=headers)

    assert resp.status_code == 201
    data = resp.json()
    assert data["rows_imported"] == 2
    assert data["rows_skipped"] == 0
    assert data["transactions_created"] == 2
    assert data["accounts_created"] == 1
    assert data["merchants_created"] == 2
    assert data["tags_created"] == 1

    transactions_resp = await client.get("/transactions", headers=headers)
    by_amount = {transaction["amount"]: transaction for transaction in transactions_resp.json()}
    expense = by_amount[-4567]
    income = by_amount[241066]
    assert expense["merchant_name"] == "Neighbourhood Grocer"
    assert expense["notes"] == "Weekly groceries\nBought extra snacks"
    assert [tag["name"] for tag in expense["tags"]] == ["food"]
    assert income["merchant_name"] == "Employer Payroll"
    assert income["notes"] == "Biweekly salary"


async def test_firefly_import_converts_transfers_into_two_legs(client):
    """Transfers between imported accounts become paired system-category rows."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.post("/transactions/import/firefly", json={
        "accounts": [
            _chequing_mapping(),
            {
                "source": "High Interest Savings",
                "create": {"name": "High Interest Savings", "account_type": "savings", "currency": "CAD"},
            },
        ],
        "categories": [],
        "rows": [_firefly_row(
            type="Transfer",
            amount="500.00",
            description="Automatic savings contribution",
            destination_name="High Interest Savings",
            destination_type="Asset account",
            category=None,
        )],
    }, headers=headers)

    assert resp.status_code == 201
    data = resp.json()
    assert data["rows_imported"] == 1
    assert data["transactions_created"] == 2

    transfer_category_id = await _get_system_category_id(client, headers, "Transfer")
    transactions_resp = await client.get("/transactions", headers=headers)
    transactions_by_account = {
        transaction["account_id"]: transaction for transaction in transactions_resp.json()
    }
    chequing_id = data["account_source_ids"]["Everyday Chequing"]
    savings_id = data["account_source_ids"]["High Interest Savings"]
    assert {
        account_id: transaction["amount"] for account_id, transaction in transactions_by_account.items()
    } == {chequing_id: -50000, savings_id: 50000}
    assert all(
        transaction["category_id"] == transfer_category_id for transaction in transactions_resp.json()
    )

    # Each leg records the account at the other end, so the pair is left out of a tax-advantaged
    # category's totals without anyone opening the rows to answer for them
    assert transactions_by_account[chequing_id]["counterparty_account_id"] == savings_id
    assert transactions_by_account[chequing_id]["counterparty_account_scope"] == "tracked"
    assert transactions_by_account[savings_id]["counterparty_account_id"] == chequing_id
    assert transactions_by_account[savings_id]["counterparty_account_scope"] == "tracked"


async def test_firefly_import_records_accounts_it_creates_as_each_other_s_other_side(client):
    """A first import creates both endpoints, and each leg still records the other one."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.post("/transactions/import/firefly", json={
        "accounts": [
            _chequing_mapping(),
            {
                "source": "High Interest Savings",
                "create": {"name": "High Interest Savings", "account_type": "savings", "currency": "CAD"},
            },
        ],
        "categories": [],
        "rows": [_firefly_row(
            type="Transfer",
            amount="500.00",
            description="Automatic savings contribution",
            destination_name="High Interest Savings",
            destination_type="Asset account",
            category=None,
        )],
    }, headers=headers)

    assert resp.status_code == 201
    data = resp.json()
    chequing_id = data["account_source_ids"]["Everyday Chequing"]
    savings_id = data["account_source_ids"]["High Interest Savings"]

    transactions_by_account = {
        transaction["account_id"]: transaction
        for transaction in (await client.get("/transactions", headers=headers)).json()
    }
    assert transactions_by_account[chequing_id]["counterparty_account_id"] == savings_id
    assert transactions_by_account[savings_id]["counterparty_account_id"] == chequing_id


async def test_firefly_import_records_a_one_sided_transfer_row_as_leaving_the_accounts(client):
    """A row with one imported endpoint whose category is a transfer says the money left."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    transfer_category_id = await _get_system_category_id(client, headers, "Transfer")

    resp = await client.post("/transactions/import/firefly", json={
        "accounts": [_chequing_mapping()],
        "categories": [{"source": "Moving money out", "category_id": transfer_category_id}],
        "rows": [_firefly_row(category="Moving money out")],
    }, headers=headers)

    assert resp.status_code == 201
    assert resp.json()["transactions_created"] == 1

    transaction = (await client.get("/transactions", headers=headers)).json()[0]
    assert transaction["counterparty_account_id"] is None
    assert transaction["counterparty_account_scope"] == "outside"


async def test_firefly_import_rejects_an_account_source_marked_outside(client):
    """Every Firefly source is an account rows are written to, so the outside answer has no meaning."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.post("/transactions/import/firefly", json={
        "accounts": [_chequing_mapping(), {"source": "Brokerage elsewhere", "outside": True}],
        "categories": [{"source": "Groceries", "create": {"name": "Groceries", "kind": "expense"}}],
        "rows": [_firefly_row()],
    }, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Account source cannot be outside the tracked accounts: Brokerage elsewhere"


async def test_firefly_imported_internal_transfer_is_left_out_of_the_limit_totals(client):
    """The point of recording the counterparty account: an imported internal move stops counting."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    tax_advantaged_category_resp = await client.post("/tax-advantaged-categories", json={
        "name": "TFSA",
        "tax_treatment": "tax_free",
        "currency": "CAD",
    }, headers=headers)
    tax_advantaged_category_id = tax_advantaged_category_resp.json()["id"]

    cash_resp = await _create_account(
        client, headers, name="TFSA Cash", tax_advantaged_category_id=tax_advantaged_category_id,
    )
    investing_resp = await _create_account(
        client, headers, name="TFSA Investing", account_type="investment",
        tax_advantaged_category_id=tax_advantaged_category_id,
    )
    current_year = datetime.now(UTC).year

    resp = await client.post("/transactions/import/firefly", json={
        "accounts": [
            {"source": "TFSA Cash", "account_id": cash_resp.json()["id"]},
            {"source": "TFSA Investing", "account_id": investing_resp.json()["id"]},
        ],
        "categories": [],
        "rows": [_firefly_row(
            type="Transfer",
            dt=f"{current_year}-04-10",
            amount="5000.00",
            description="Moved into investments",
            source_name="TFSA Cash",
            destination_name="TFSA Investing",
            destination_type="Asset account",
            category=None,
        )],
    }, headers=headers)

    assert resp.status_code == 201
    assert resp.json()["transactions_created"] == 2

    # The category treats its own accounts as one pot by default, and both legs now say the money
    # stayed inside it, so neither is a contribution or a withdrawal
    totals_resp = await client.get(f"/tax-advantaged-categories/{tax_advantaged_category_id}", headers=headers)
    assert totals_resp.json()["ytd_contributions"] == 0
    assert totals_resp.json()["ytd_withdrawals"] == 0


async def test_firefly_import_skips_a_transfer_between_two_names_for_one_account(client):
    """Two source names mapped onto one account skip the row instead of writing two cancelling legs."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    account_resp = await _create_account(client, headers, name="Everyday Chequing")
    account_id = account_resp.json()["id"]

    resp = await client.post("/transactions/import/firefly", json={
        "accounts": [
            {"source": "Everyday Chequing", "account_id": account_id},
            {"source": "Chequing (old)", "account_id": account_id},
        ],
        "categories": [],
        "rows": [_firefly_row(
            type="Transfer",
            amount="500.00",
            description="Carried across from the renamed account",
            source_name="Chequing (old)",
            destination_name="Everyday Chequing",
            destination_type="Asset account",
            category=None,
        )],
    }, headers=headers)

    assert resp.status_code == 201
    data = resp.json()
    assert data["rows_imported"] == 0
    assert data["transactions_created"] == 0
    assert data["rows_skipped"] == 1
    assert data["skipped"] == [
        {"journal_id": "1", "reason": "Transfer source and destination resolve to the same account"},
    ]

    transactions_resp = await client.get("/transactions", headers=headers)
    assert transactions_resp.json() == []


async def test_firefly_import_uses_foreign_amount_for_cross_currency_transfers(client):
    """Cross-currency transfer legs are written in each account's own currency."""
    await _seed_usd_currency()
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.post("/transactions/import/firefly", json={
        "accounts": [
            _chequing_mapping(),
            {
                "source": "US Dollar Savings",
                "create": {"name": "US Dollar Savings", "account_type": "savings", "currency": "USD"},
            },
        ],
        "categories": [],
        "rows": [_firefly_row(
            type="Transfer",
            amount="243.95",
            foreign_currency_code="USD",
            foreign_amount="176.07",
            description="Move funds to US dollar savings",
            destination_name="US Dollar Savings",
            destination_type="Asset account",
            category=None,
        )],
    }, headers=headers)

    assert resp.status_code == 201
    data = resp.json()
    assert data["transactions_created"] == 2

    transactions_resp = await client.get("/transactions", headers=headers)
    by_account = {transaction["account_id"]: transaction for transaction in transactions_resp.json()}
    chequing_leg = by_account[data["account_source_ids"]["Everyday Chequing"]]
    usd_leg = by_account[data["account_source_ids"]["US Dollar Savings"]]
    assert chequing_leg["amount"] == -24395
    assert chequing_leg["currency"] == "CAD"
    assert usd_leg["amount"] == 17607
    assert usd_leg["currency"] == "USD"


async def test_firefly_import_converts_liability_withdrawals_to_transfers(client):
    """A withdrawal into an imported liability is a transfer pair, not an expense."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.post("/transactions/import/firefly", json={
        "accounts": [
            _chequing_mapping(),
            {"source": "Car Loan", "create": {"name": "Car Loan", "account_type": "loan", "currency": "CAD"}},
        ],
        "categories": [],
        "rows": [_firefly_row(
            amount="-385",
            description="Car loan payment",
            destination_name="Car Loan",
            destination_type="Loan",
            category=None,
        )],
    }, headers=headers)

    assert resp.status_code == 201
    data = resp.json()
    assert data["transactions_created"] == 2

    transfer_category_id = await _get_system_category_id(client, headers, "Transfer")
    transactions_resp = await client.get("/transactions", headers=headers)
    amounts_by_account = {
        transaction["account_id"]: transaction["amount"] for transaction in transactions_resp.json()
    }
    assert amounts_by_account == {
        data["account_source_ids"]["Everyday Chequing"]: -38500,
        data["account_source_ids"]["Car Loan"]: 38500,
    }
    assert all(
        transaction["category_id"] == transfer_category_id for transaction in transactions_resp.json()
    )


async def test_firefly_import_applies_opening_balance_direction(client):
    """Opening balances credit assets and debit liabilities through balance adjustments."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.post("/transactions/import/firefly", json={
        "accounts": [
            _chequing_mapping(),
            {"source": "Car Loan", "create": {"name": "Car Loan", "account_type": "loan", "currency": "CAD"}},
        ],
        "categories": [],
        "rows": [
            _firefly_row(
                type="Opening balance",
                dt="2023-12-31",
                amount="4250.00",
                description='Initial balance for "Everyday Chequing"',
                source_name='Initial balance for "Everyday Chequing"',
                source_type="Initial balance account",
                destination_name="Everyday Chequing",
                destination_type="Asset account",
                category=None,
            ),
            _firefly_row(
                journal_id="2",
                type="Opening balance",
                dt="2023-12-31",
                amount="18500.00",
                description='Initial balance for "Car Loan"',
                source_name="Car Loan",
                source_type="Loan",
                destination_name='Initial balance for "Car Loan"',
                destination_type="Initial balance account",
                category=None,
            ),
        ],
    }, headers=headers)

    assert resp.status_code == 201
    data = resp.json()
    assert data["transactions_created"] == 2

    adjustment_category_id = await _get_system_category_id(client, headers, "Balance Adjustment")
    transactions_resp = await client.get("/transactions", headers=headers)
    amounts_by_account = {
        transaction["account_id"]: transaction["amount"] for transaction in transactions_resp.json()
    }
    assert amounts_by_account == {
        data["account_source_ids"]["Everyday Chequing"]: 425000,
        data["account_source_ids"]["Car Loan"]: -1850000,
    }
    assert all(
        transaction["category_id"] == adjustment_category_id for transaction in transactions_resp.json()
    )

    # Balance Adjustment has no other side, and the API refuses one on it, so the importer leaves
    # both columns unset rather than saying the money left the tracked accounts
    assert all(
        transaction["counterparty_account_id"] is None and transaction["counterparty_account_scope"] is None
        for transaction in transactions_resp.json()
    )


async def test_firefly_import_skips_unconvertible_rows(client):
    """Unsupported types and unavailable currencies are skipped and reported."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.post("/transactions/import/firefly", json={
        "accounts": [_chequing_mapping()],
        "categories": [{"source": "Groceries", "create": {"name": "Groceries", "kind": "expense"}}],
        "rows": [
            _firefly_row(),
            _firefly_row(journal_id="2", type="Liability credit"),
            _firefly_row(journal_id="3", currency_code="EUR"),
            _firefly_row(journal_id="4", amount="12.345"),
        ],
    }, headers=headers)

    assert resp.status_code == 201
    data = resp.json()
    assert data["rows_imported"] == 1
    assert data["rows_skipped"] == 3
    assert data["transactions_created"] == 1
    assert {entry["journal_id"] for entry in data["skipped"]} == {"2", "3", "4"}
    reasons_by_journal = {entry["journal_id"]: entry["reason"] for entry in data["skipped"]}
    assert reasons_by_journal["2"] == (
        'Journal type "Liability credit" is not supported, the importer handles'
        " withdrawals, deposits, transfers, opening balances, and reconciliations"
    )
    assert reasons_by_journal["3"] == "Neither the amount nor the foreign amount is in the account's currency (CAD)"
    assert reasons_by_journal["4"] == 'Invalid amount "12.345"'


async def test_firefly_import_reports_unexpected_row_failures_generically(client, monkeypatch):
    """A row failing outside the known skip rules is skipped with a generic reason."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    def _boom(row, context):
        raise RuntimeError("unexpected resolution failure")

    monkeypatch.setattr("app.services.importers.firefly.service.resolve_firefly_row", _boom)

    resp = await client.post("/transactions/import/firefly", json={
        "accounts": [_chequing_mapping()],
        "categories": [{"source": "Groceries", "create": {"name": "Groceries", "kind": "expense"}}],
        "rows": [_firefly_row()],
    }, headers=headers)

    assert resp.status_code == 201
    data = resp.json()
    assert data["rows_imported"] == 0
    assert data["rows_skipped"] == 1
    assert data["transactions_created"] == 0
    assert data["skipped"] == [{"journal_id": "1", "reason": "Row could not be converted"}]


async def test_firefly_import_requires_mapping_for_tracked_accounts(client):
    """Rows referencing an unmapped asset account fail the whole batch."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.post("/transactions/import/firefly", json={
        "accounts": [_chequing_mapping()],
        "categories": [{"source": "Groceries", "create": {"name": "Groceries", "kind": "expense"}}],
        "rows": [_firefly_row(source_name="Missing Account")],
    }, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Account source is not mapped: Missing Account"


async def test_firefly_import_maps_uncategorized_rows_via_placeholder(client):
    """Rows without a category resolve through the no-category placeholder mapping."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    payload = {
        "accounts": [_chequing_mapping()],
        "categories": [],
        "rows": [_firefly_row(category=None)],
    }
    resp = await client.post("/transactions/import/firefly", json=payload, headers=headers)
    assert resp.status_code == 422
    assert resp.json()["detail"] == "Category source is not mapped: (no category)"

    payload["categories"] = [
        {"source": "(no category)", "create": {"name": "Imported Uncategorized", "kind": "expense"}},
    ]
    resp = await client.post("/transactions/import/firefly", json=payload, headers=headers)
    assert resp.status_code == 201
    data = resp.json()
    assert data["transactions_created"] == 1
    assert data["categories_created"] == 1

    transactions_resp = await client.get("/transactions", headers=headers)
    assert transactions_resp.json()[0]["category_id"] == data["category_source_ids"]["(no category)"]


async def test_firefly_import_skips_whitespace_only_account_names(client):
    """A tracked-typed endpoint with a blank name skips the row instead of failing the batch."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.post("/transactions/import/firefly", json={
        "accounts": [_chequing_mapping()],
        "categories": [{"source": "Groceries", "create": {"name": "Groceries", "kind": "expense"}}],
        "rows": [
            _firefly_row(),
            _firefly_row(journal_id="2", source_name="   "),
        ],
    }, headers=headers)

    assert resp.status_code == 201
    data = resp.json()
    assert data["rows_imported"] == 1
    assert data["rows_skipped"] == 1
    assert data["skipped"][0]["journal_id"] == "2"
    assert data["skipped"][0]["reason"] == "Withdrawal source is not an imported account"


async def test_firefly_import_skips_amounts_past_the_storable_range(client):
    """An amount past the signed 64-bit range skips the row instead of crashing at flush."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.post("/transactions/import/firefly", json={
        "accounts": [_chequing_mapping()],
        "categories": [{"source": "Groceries", "create": {"name": "Groceries", "kind": "expense"}}],
        "rows": [
            _firefly_row(),
            _firefly_row(journal_id="2", amount="99999999999999999999.00"),
        ],
    }, headers=headers)

    assert resp.status_code == 201
    data = resp.json()
    assert data["rows_imported"] == 1
    assert data["rows_skipped"] == 1
    assert data["skipped"][0]["reason"] == 'Invalid amount "99999999999999999999.00"'
