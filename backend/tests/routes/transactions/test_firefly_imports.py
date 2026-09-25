

from datetime import UTC, datetime

import pytest

from app.services.merchants.defaults import SELF_MERCHANT_NAME
from tests.routes.support import _create_user, _get_auth_header, _get_system_merchant_id
from tests.routes.transactions._helpers import _create_account, _import_firefly, _seed_usd_currency

# --- Firefly III import runs ---


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

    resp = await _import_firefly(client, headers, {
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
                source_account=None,
                source_name="Employer Payroll",
                destination_account="Everyday Chequing",
                destination_name=None,
                category="Salary",
            ),
        ],
    })

    assert resp.status_code == 201
    data = resp.json()
    assert data["rows_imported"] == 2
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

    resp = await _import_firefly(client, headers, {
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
            destination_account="High Interest Savings",
            destination_name=None,
            category=None,
        )],
    })

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

    resp = await _import_firefly(client, headers, {
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
            destination_account="High Interest Savings",
            destination_name=None,
            category=None,
        )],
    })

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


async def test_firefly_transfer_legs_are_stamped_with_the_self_merchant(client):
    """Neither leg of a transfer has a payee, so both get what the app puts on its own transfers."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _import_firefly(client, headers, {
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
            destination_account="High Interest Savings",
            destination_name=None,
            category=None,
        )],
    })

    assert resp.status_code == 201
    self_merchant_id = await _get_system_merchant_id(client, headers, SELF_MERCHANT_NAME)
    transactions = (await client.get("/transactions", headers=headers)).json()
    assert [transaction["merchant_id"] for transaction in transactions] == [self_merchant_id] * 2
    assert resp.json()["merchants_created"] == 0


async def test_firefly_import_records_a_one_sided_transfer_row_as_leaving_the_accounts(client):
    """A row with one imported endpoint whose category is a transfer says the money left."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    transfer_category_id = await _get_system_category_id(client, headers, "Transfer")

    resp = await _import_firefly(client, headers, {
        "accounts": [_chequing_mapping()],
        "categories": [{"source": "Moving money out", "category_id": transfer_category_id}],
        "rows": [_firefly_row(category="Moving money out")],
    })

    assert resp.status_code == 201
    assert resp.json()["transactions_created"] == 1

    transaction = (await client.get("/transactions", headers=headers)).json()[0]
    assert transaction["counterparty_account_id"] is None
    assert transaction["counterparty_account_scope"] == "outside"


async def test_firefly_import_rejects_an_account_source_marked_outside(client):
    """Every Firefly source is an account rows are written to, so the outside answer has no meaning."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _import_firefly(client, headers, {
        "accounts": [_chequing_mapping(), {"source": "Brokerage elsewhere", "outside": True}],
        "categories": [{"source": "Groceries", "create": {"name": "Groceries", "kind": "expense"}}],
        "rows": [_firefly_row()],
    })

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

    resp = await _import_firefly(client, headers, {
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
            source_account="TFSA Cash",
            destination_account="TFSA Investing",
            destination_name=None,
            category=None,
        )],
    })

    assert resp.status_code == 201
    assert resp.json()["transactions_created"] == 2

    # The category treats its own accounts as one pot by default, and both legs now say the money
    # stayed inside it, so neither is a contribution or a withdrawal
    totals_resp = await client.get(f"/tax-advantaged-categories/{tax_advantaged_category_id}", headers=headers)
    assert totals_resp.json()["ytd_contributions"] == 0
    assert totals_resp.json()["ytd_withdrawals"] == 0


async def test_firefly_import_refuses_a_transfer_between_two_names_for_one_account(client):
    """Two source names mapped onto one account refuse the import instead of writing two cancelling legs."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    account_resp = await _create_account(client, headers, name="Everyday Chequing")
    account_id = account_resp.json()["id"]

    resp = await _import_firefly(client, headers, {
        "accounts": [
            {"source": "Everyday Chequing", "account_id": account_id},
            {"source": "Chequing (old)", "account_id": account_id},
        ],
        "categories": [],
        "rows": [_firefly_row(
            type="Transfer",
            amount="500.00",
            description="Carried across from the renamed account",
            source_account="Chequing (old)",
            destination_account="Everyday Chequing",
            destination_name=None,
            category=None,
        )],
    })

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Firefly III journal 1: Transfer source and destination resolve to the same account"

    transactions_resp = await client.get("/transactions", headers=headers)
    assert transactions_resp.json() == []


async def test_firefly_import_uses_foreign_amount_for_cross_currency_transfers(client):
    """Cross-currency transfer legs are written in each account's own currency."""
    await _seed_usd_currency()
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _import_firefly(client, headers, {
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
            destination_account="US Dollar Savings",
            destination_name=None,
            category=None,
        )],
    })

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

    resp = await _import_firefly(client, headers, {
        "accounts": [
            _chequing_mapping(),
            {"source": "Car Loan", "create": {"name": "Car Loan", "account_type": "loan", "currency": "CAD"}},
        ],
        "categories": [],
        "rows": [_firefly_row(
            amount="-385",
            description="Car loan payment",
            destination_account="Car Loan",
            destination_name=None,
            category=None,
        )],
    })

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


async def test_firefly_import_keeps_same_named_asset_and_loan_apart(client):
    """An asset account and a loan sharing a name become two accounts with the payment between them."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _import_firefly(client, headers, {
        "accounts": [
            {"source": "account-1", "create": {"name": "Car", "account_type": "checking", "currency": "CAD"}},
            {"source": "account-2", "create": {"name": "Car", "account_type": "loan", "currency": "CAD"}},
        ],
        "categories": [],
        "rows": [
            _firefly_row(
                type="Opening balance",
                amount="1000.00",
                source_account=None,
                source_name='Initial balance for "Car"',
                destination_account="account-1",
                destination_name=None,
                category=None,
            ),
            _firefly_row(
                journal_id="2",
                type="Opening balance",
                amount="5000.00",
                source_account="account-2",
                destination_name='Initial balance for "Car"',
                category=None,
            ),
            _firefly_row(
                journal_id="3",
                amount="-385.00",
                source_account="account-1",
                destination_account="account-2",
                destination_name=None,
                category=None,
            ),
        ],
    })

    assert resp.status_code == 201
    data = resp.json()
    assert data["rows_imported"] == 3
    assert data["accounts_created"] == 2

    asset_id = data["account_source_ids"]["account-1"]
    loan_id = data["account_source_ids"]["account-2"]
    asset = (await client.get(f"/accounts/{asset_id}", headers=headers)).json()
    loan = (await client.get(f"/accounts/{loan_id}", headers=headers)).json()
    assert (asset["name"], asset["account_type"], asset["current_balance"]) == ("Car", "checking", 61500)
    assert (loan["name"], loan["account_type"], loan["current_balance"]) == ("Car", "loan", -461500)

    transactions = (await client.get("/transactions", headers=headers)).json()
    payment_legs = {
        transaction["account_id"]: transaction["counterparty_account_id"]
        for transaction in transactions
        if abs(transaction["amount"]) == 38500
    }
    assert payment_legs == {asset_id: loan_id, loan_id: asset_id}


async def test_firefly_import_applies_opening_balance_direction(client):
    """Opening balances credit assets and debit liabilities through balance adjustments."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _import_firefly(client, headers, {
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
                source_account=None,
                source_name='Initial balance for "Everyday Chequing"',
                destination_account="Everyday Chequing",
                destination_name=None,
                category=None,
            ),
            _firefly_row(
                journal_id="2",
                type="Opening balance",
                dt="2023-12-31",
                amount="18500.00",
                description='Initial balance for "Car Loan"',
                source_account="Car Loan",
                destination_name='Initial balance for "Car Loan"',
                category=None,
            ),
        ],
    })

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


@pytest.mark.parametrize(("overrides", "reason"), [
    ({"type": "Liability credit"}, (
        'Journal type "Liability credit" is not supported, the importer handles'
        " withdrawals, deposits, transfers, opening balances, and reconciliations"
    )),
    ({"currency_code": "EUR"}, "Neither the amount nor the foreign amount is in the account's currency (CAD)"),
    ({"amount": "12.345"}, (
        "The amount has more decimal places than CAD has. "
        "A period is read as a decimal point, never as a separator between thousands."
    )),
    ({"amount": "١٢.٣٤"}, 'Invalid amount "١٢.٣٤"'),
    ({"amount": "12.34\u001c"}, 'Invalid amount "12.34\u001c"'),
    ({"amount": "10.00", "currency_code": "USD", "foreign_amount": "١٢.٣٤", "foreign_currency_code": "CAD"}, 'Invalid amount "١٢.٣٤"'),
    ({"amount": "twelve"}, 'Invalid amount "twelve"'),
    ({"amount": " 12.34 "}, 'Invalid amount " 12.34 "'),
    ({"amount": "1,234.56"}, 'Invalid amount "1,234.56"'),
    ({"amount": "10.00", "currency_code": "USD", "foreign_amount": "1,234.56", "foreign_currency_code": "CAD"}, 'Invalid amount "1,234.56"'),
    # Past the signed 64-bit range, which would otherwise crash at flush
    ({"amount": "99999999999999999999.00"}, 'Invalid amount "99999999999999999999.00"'),
    # The one amount that parses but cannot be stored once negated, since this path writes the
    # magnitude and the signed range holds one more value below zero than above it
    ({"amount": "-92233720368547758.08"}, 'Amount is too large: "-92233720368547758.08"'),
])
async def test_firefly_import_refuses_an_unconvertible_row_naming_it(client, overrides, reason):
    """The browser leaves out rows it can tell will not convert, so one that arrives fails the whole import."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _import_firefly(client, headers, {
        "accounts": [_chequing_mapping()],
        "categories": [{"source": "Groceries", "create": {"name": "Groceries", "kind": "expense"}}],
        "rows": [_firefly_row(), _firefly_row(journal_id="2", **overrides)],
    })

    assert resp.status_code == 422
    assert resp.json()["detail"] == f"Firefly III journal 2: {reason}"
    assert (await client.get("/transactions", headers=headers)).json() == []


async def test_firefly_import_refuses_unexpected_row_failures_generically(client, monkeypatch):
    """A row failing outside the known skip rules refuses the import with a generic reason."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    def _boom(row, context):
        raise RuntimeError("unexpected resolution failure")

    monkeypatch.setattr("app.services.importers.firefly.service.resolve_firefly_row", _boom)

    resp = await _import_firefly(client, headers, {
        "accounts": [_chequing_mapping()],
        "categories": [{"source": "Groceries", "create": {"name": "Groceries", "kind": "expense"}}],
        "rows": [_firefly_row()],
    })

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Firefly III journal 1: Row could not be converted"


async def test_firefly_import_requires_mapping_for_tracked_accounts(client):
    """Rows referencing an unmapped asset account fail the whole batch."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _import_firefly(client, headers, {
        "accounts": [_chequing_mapping()],
        "categories": [{"source": "Groceries", "create": {"name": "Groceries", "kind": "expense"}}],
        "rows": [_firefly_row(source_account="Missing Account")],
    })

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Firefly III journal 1: Account source is not mapped: Missing Account"


async def test_firefly_import_maps_uncategorized_rows_via_placeholder(client):
    """Rows without a category resolve through the no-category placeholder mapping."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    payload = {
        "accounts": [_chequing_mapping()],
        "categories": [],
        "rows": [_firefly_row(category=None)],
    }
    resp = await _import_firefly(client, headers, payload)
    assert resp.status_code == 422
    assert resp.json()["detail"] == "Firefly III journal 1: Category source is not mapped: (no category)"

    payload["categories"] = [
        {"source": "(no category)", "create": {"name": "Imported Uncategorized", "kind": "expense"}},
    ]
    resp = await _import_firefly(client, headers, payload)
    assert resp.status_code == 201
    data = resp.json()
    assert data["transactions_created"] == 1
    assert data["categories_created"] == 1

    transactions_resp = await client.get("/transactions", headers=headers)
    assert transactions_resp.json()[0]["category_id"] == data["category_source_ids"]["(no category)"]


async def test_firefly_import_files_a_payee_under_a_merchant_the_database_lowercases_alike(client):
    """A payee is matched by PostgreSQL's lowercase, which the unique index is built on

    Python lowercases "İ" to "i" and a combining dot, while PostgreSQL gives a plain "i"
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    existing = await client.post("/merchants", json={"name": "ISTANBUL KEBAP"}, headers=headers)
    assert existing.status_code == 201

    resp = await _import_firefly(client, headers, {
        "accounts": [_chequing_mapping()],
        "categories": [{"source": "Groceries", "create": {"name": "Groceries", "kind": "expense"}}],
        "rows": [
            _firefly_row(destination_name="İstanbul Kebap"),
            _firefly_row(journal_id="2", destination_name="İSTANBUL KEBAP"),
        ],
    })

    assert resp.status_code == 201
    assert resp.json()["merchants_created"] == 0
    transactions = (await client.get("/transactions", headers=headers)).json()
    assert [transaction["merchant_id"] for transaction in transactions] == [existing.json()["id"]] * 2


async def test_firefly_import_creates_one_merchant_for_payees_the_database_lowercases_alike(client):
    """Two spellings PostgreSQL folds to one name make one merchant, as its unique index requires"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _import_firefly(client, headers, {
        "accounts": [_chequing_mapping()],
        "categories": [{"source": "Groceries", "create": {"name": "Groceries", "kind": "expense"}}],
        "rows": [
            _firefly_row(destination_name="İstanbul Kebap"),
            _firefly_row(journal_id="2", destination_name="Istanbul Kebap"),
        ],
    })

    assert resp.status_code == 201
    assert resp.json()["merchants_created"] == 1
    transactions = (await client.get("/transactions", headers=headers)).json()
    assert len({transaction["merchant_id"] for transaction in transactions}) == 1

    # The first spelling in the file names the merchant
    merchants = (await client.get("/merchants", headers=headers)).json()
    assert "İstanbul Kebap" in [merchant["name"] for merchant in merchants]


@pytest.mark.parametrize(("field", "value"), [
    ("journal_id", "1" * 65),
    ("type", ""),
    ("type", "W" * 65),
    ("amount", "1" * 65),
    ("foreign_amount", "1" * 65),
    ("currency_code", "USDT"),
    ("foreign_currency_code", "USDT"),
    ("description", "d" * 1025),
    ("source_name", "p" * 257),
    ("destination_name", "p" * 257),
    ("category", "c" * 257),
])
async def test_firefly_import_refuses_a_row_past_a_field_limit(client, field, value):
    """The browser drops or normalises these rows first, and the endpoint still refuses one that arrives."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _import_firefly(client, headers, {
        "accounts": [_chequing_mapping()],
        "categories": [{"source": "Groceries", "create": {"name": "Groceries", "kind": "expense"}}],
        "rows": [_firefly_row(**{field: value})],
    })

    assert resp.status_code == 422
    assert any(error["loc"] == ["body", "rows", 0, field] for error in resp.json()["detail"])
    assert (await client.get("/transactions", headers=headers)).json() == []


async def test_firefly_import_takes_a_row_at_its_field_limits(client):
    """A value exactly at the limit the browser checks against is one the endpoint takes."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _import_firefly(client, headers, {
        "accounts": [_chequing_mapping()],
        "categories": [{"source": "Groceries", "create": {"name": "Groceries", "kind": "expense"}}],
        "rows": [_firefly_row(journal_id="1" * 64, description="d" * 1024, destination_name="p" * 256)],
    })

    assert resp.status_code == 201
    transactions = (await client.get("/transactions", headers=headers)).json()
    assert [transaction["notes"] for transaction in transactions] == ["d" * 1024]


async def test_firefly_import_refuses_two_new_categories_differing_only_in_capitals_and_type(client):
    """The browser blocks this pair before upload, and the endpoint refuses it without writing."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _import_firefly(client, headers, {
        "accounts": [_chequing_mapping()],
        "categories": [
            {"source": "Road Trips", "create": {"name": "Road Trips", "kind": "expense"}},
            {"source": "ROAD TRIPS", "create": {"name": "ROAD TRIPS", "kind": "income"}},
        ],
        "rows": [
            _firefly_row(category="Road Trips"),
            _firefly_row(
                journal_id="2",
                type="Deposit",
                amount="80.00",
                source_account=None,
                source_name="Airline",
                destination_account="Everyday Chequing",
                destination_name=None,
                category="ROAD TRIPS",
            ),
        ],
    })

    assert resp.status_code == 422
    # The run keeps its mappings keyed by source, so the commit meets ROAD TRIPS first
    assert resp.json()["detail"].startswith("A category named ROAD TRIPS already records income, so this import cannot create Road Trips")
    assert (await client.get("/transactions", headers=headers)).json() == []
    categories = (await client.get("/categories", headers=headers)).json()
    assert "road trips" not in [category["name"].lower() for category in categories]
