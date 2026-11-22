import csv
import io
import re
import uuid
import zipfile
from datetime import UTC, datetime

from app.models.account import Account
from app.models.import_run import ImportRun
from app.models.saved_insights_range import SavedInsightsRange
from tests.conftest import TestSession
from tests.routes.support import _create_account, _create_user, _get_auth_header
from tests.routes.support.bank_sync_helpers import (
    _build_account,
    _build_bank_connection,
    _build_bank_link,
    _build_bank_transaction,
    _build_user,
    _commit_bank_connection,
    _commit_link,
    _commit_other_users_account,
    _commit_review_item,
    _import_a_file,
    _new_account,
    _sign_up,
    _update_connection,
)
from tests.routes.support.transaction_helpers import _create_transaction, _get_system_category_id

BYTE_ORDER_MARK = "﻿"

FILE_NAMES = [
    "profile.csv",
    "accounts.csv",
    "transactions.csv",
    "categories.csv",
    "merchants.csv",
    "tags.csv",
    "budgets.csv",
    "budget_categories.csv",
    "budget_periods.csv",
    "tax_advantaged_categories.csv",
    "tax_advantaged_category_limits.csv",
    "saved_insights_ranges.csv",
    "bank_connections.csv",
    "bank_links.csv",
    "bank_items.csv",
    "imports.csv",
]

# An instant the database stamped, so no test can know it in advance
INSTANT = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?\+00:00")


def _read_archive(response) -> dict[str, list[list[str]]]:
    """Return each CSV file of the archive as rows, header first"""
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    files = {}
    for name in archive.namelist():
        text = archive.read(name).decode("utf-8")
        assert text.startswith(BYTE_ORDER_MARK), f"{name} starts with a byte order mark"
        files[name] = list(csv.reader(io.StringIO(text.removeprefix(BYTE_ORDER_MARK))))
    return files


def _mask_instants(rows: list[list[str]]) -> list[list[str]]:
    """Replace the instants the database stamped, since no test can know them in advance"""
    return [["<instant>" if INSTANT.fullmatch(cell) else cell for cell in row] for row in rows]


def _every_file_text(response) -> list[str]:
    """Return the text of every file in the archive"""
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    return [archive.read(name).decode("utf-8") for name in archive.namelist()]


async def _post(client, headers, path, **payload):
    """Create something through the API and return its id"""
    resp = await client.post(path, json=payload, headers=headers)
    assert resp.status_code in (200, 201), resp.text
    return resp.json()["id"]


async def _commit_rows_to_leave_out(user_id, connection, joint_id) -> None:
    """Commit what the export must leave out

    That is another user's connection, import run and saved range, an import run of this user that was never
    saved, and a bank link and an item needing review on a group's account and on another user's account.
    The link and the item carry this user as their owner, so only the account they sit on keeps them out
    """
    async with TestSession() as session:
        other = _build_user("other-owner@example.com")
        session.add(other)
        await session.flush()
        theirs = _build_account(other.id, name="Theirs Savings")
        session.add(theirs)
        await session.flush()
        for account_id, bank_account in ((uuid.UUID(str(joint_id)), "LEAK-GROUP"), (theirs.id, "LEAK-OTHER")):
            account = await session.get_one(Account, account_id)
            link = _build_bank_link(account, connection, bank_account)
            link.owner_id = user_id
            link.external_account_name = f"Leaked link {bank_account}"
            item = _build_bank_transaction(account, f"TRN-{bank_account}", external_account_id=bank_account)
            item.owner_id = user_id
            item.description = f"Leaked item {bank_account}"
            session.add_all([link, item])
        session.add(_build_bank_connection(other.id, provider_name="Theirs Bank"))
        session.add(
            ImportRun(owner_id=other.id, expected_transaction_count=7, file_name="Theirs.csv", committed_at=datetime(2026, 9, 2, tzinfo=UTC))
        )
        session.add(SavedInsightsRange(user_id=other.id, name="Theirs range", amount=2, unit="week"))
        session.add(ImportRun(owner_id=user_id, expected_transaction_count=9, file_name="Abandoned.csv"))
        await session.commit()


async def test_data_export_needs_a_signed_in_user(client):
    """Asking for the archive without a token is refused."""
    resp = await client.get("/me/export")

    assert resp.status_code == 401


async def test_data_export_holds_each_kind_of_data_the_user_owns(client):
    """One download holds a file per kind of data, with numbers for references and no ids or credentials."""
    headers, user_id = await _sign_up(client)
    dining = await _post(client, headers, "/categories", name="Eating out", kind="expense", icon="🍽️")
    travel = await _post(client, headers, "/categories", name="Holidays", kind="expense")
    costco = await _post(client, headers, "/merchants", name="Costco", default_category_id=dining)
    trip = await _post(client, headers, "/tags", name="trip")
    tfsa = await _post(
        client,
        headers,
        "/tax-advantaged-categories",
        name="TFSA",
        tax_treatment="tax_free",
        currency="CAD",
        lifetime_contribution_limit=9_500_000,
    )
    limit = await client.post(
        f"/tax-advantaged-categories/{tfsa}/limits",
        json={
            "year": 2026,
            "contribution_limit": 700_000,
            "withdrawal_limit": 200_000,
            "accrued_contributions": 100_000,
            "accrued_withdrawals": 25_000,
        },
        headers=headers,
    )
    assert limit.status_code == 201, limit.text
    first_checking = (await _create_account(client, headers, name="Checking", tax_advantaged_category_id=tfsa)).json()["id"]
    second_checking = (await _create_account(client, headers, name="Checking", account_type="savings", notes="=Spare change")).json()["id"]
    await _create_account(client, headers, name="Visa", account_kind="revolving", account_type="credit_card", credit_limit=500_000)

    # The user administers a group, so they can read everything it holds, none of which is theirs to export
    group = await _post(client, headers, "/groups", name="Smith Family")
    joint = await _new_account(client, headers, "Joint", group_id=group)
    shared_category = await _post(client, headers, "/categories", name="Shared outings", kind="expense", group_id=group)
    await _post(client, headers, "/merchants", name="Shared shop", group_id=group)
    await _post(client, headers, "/tags", name="shared-tag", group_id=group)
    await _post(
        client,
        headers,
        "/base-budgets",
        name="Shared budget",
        currency="CAD",
        recurrence_freq="monthly",
        recurrence_dom=1,
        category_ids=[shared_category],
        group_id=group,
    )
    await _post(client, headers, "/tax-advantaged-categories", name="Shared TFSA", tax_treatment="tax_free", currency="CAD", group_id=group)

    groceries = await _get_system_category_id(client, headers)
    transfer = await _get_system_category_id(client, headers, "Transfer")
    expense = await _create_transaction(
        client, headers, first_checking, groceries, merchant_id=costco, notes="=1+1", tag_ids=[trip], amount=-1250
    )
    refund = await _create_transaction(
        client, headers, first_checking, groceries, dt="2026-03-16", amount=500, refund_of_transaction_id=expense.json()["id"]
    )
    internal_transfer = await _create_transaction(
        client,
        headers,
        second_checking,
        transfer,
        dt="2026-03-17",
        amount=-2000,
        counterparty_account_scope="tracked",
        counterparty_account_id=first_checking,
    )
    group_transfer = await _create_transaction(
        client,
        headers,
        second_checking,
        transfer,
        dt="2026-03-18",
        amount=-1000,
        counterparty_account_scope="tracked",
        counterparty_account_id=joint,
    )
    outside_transfer = await _create_transaction(
        client,
        headers,
        second_checking,
        transfer,
        dt="2026-03-19",
        amount=-500,
        counterparty_account_scope="outside",
    )
    group_row = await _create_transaction(client, headers, joint, groceries, notes="Joint groceries")
    assert all(resp.status_code == 201 for resp in (expense, refund, internal_transfer, group_transfer, outside_transfer, group_row)), (
        "the ledger was seeded"
    )

    budget = await _post(
        client,
        headers,
        "/base-budgets",
        name="March budget",
        currency="CAD",
        recurrence_freq="monthly",
        recurrence_dom=1,
        recurs=True,
        category_ids=[dining, travel],
        period_start="2026-03-01",
        overall_limit=100_000,
    )
    removed = await client.patch(f"/base-budgets/{budget}", json={"category_ids": [dining]}, headers=headers)
    assert removed.status_code == 200, removed.text
    await _post(
        client,
        headers,
        "/base-budgets",
        name="Weekly budget",
        currency="CAD",
        recurrence_freq="weekly",
        recurrence_weekday=0,
        recurs=True,
        category_ids=[travel],
        period_start="2026-03-02",
        overall_limit=5_000,
    )
    await _post(
        client,
        headers,
        "/base-budgets",
        name="Yearly budget",
        currency="CAD",
        recurrence_freq="yearly",
        recurrence_dom=1,
        recurrence_month=7,
        recurs=True,
        category_ids=[travel],
        period_start="2026-07-01",
        overall_limit=50_000,
    )
    await _post(client, headers, "/insights/saved-ranges", name="Half-year review", amount=6, unit="month")

    connection = await _commit_bank_connection(user_id, created_at=datetime(2026, 9, 1, 8, 30, tzinfo=UTC), nickname="Main bank")
    await _update_connection(connection, last_success_at=datetime(2026, 10, 2, 9, 0, tzinfo=UTC))
    await _commit_link(first_checking, connection)
    await _commit_review_item(first_checking)
    await _import_a_file(client, headers)
    await _commit_other_users_account()
    await _commit_rows_to_leave_out(user_id, connection, joint)

    resp = await client.get("/me/export", headers=headers)

    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/zip"
    assert re.fullmatch(r'attachment; filename="lumina-finance-export-\d{4}-\d{2}-\d{2}\.zip"', resp.headers["content-disposition"])
    assert resp.headers["cache-control"] == "no-store"
    files = _read_archive(resp)
    assert list(files) == FILE_NAMES, "a file for each kind of data, in the same order every time"

    assert files["profile.csv"] == [
        [
            "Email",
            "First name",
            "Last name",
            "Timezone",
            "Base currency",
            "Date format",
            "Runway risky below months",
            "Runway healthy at months",
        ],
        ["test@example.com", "Test", "", "America/Toronto", "CAD", "Month, day, year", "1", "3"],
    ]
    assert _mask_instants(files["accounts.csv"]) == [
        [
            "Number",
            "Name",
            "Kind",
            "Type",
            "Currency",
            "Institution",
            "Tax-advantaged category",
            "Tax-advantaged category number",
            "Credit limit",
            "Archived",
            "Notes",
            "Created",
            "Counts toward runway",
            "Left out of credit utilization",
        ],
        ["1", "Checking", "Asset", "Checking", "CAD", "", "TFSA", "1", "", "No", "", "<instant>", "No", "No"],
        ["2", "Checking", "Asset", "Savings", "CAD", "", "", "", "", "No", "'=Spare change", "<instant>", "No", "No"],
        ["3", "Visa", "Revolving credit", "Credit card", "CAD", "", "", "", "5000.00", "No", "", "<instant>", "No", "No"],
        ["4", "Wallet", "Asset", "Checking", "CAD", "", "", "", "", "No", "", "<instant>", "No", "No"],
    ]
    assert files["transactions.csv"] == [
        [
            "Number",
            "Date",
            "Merchant",
            "Category",
            "Account",
            "Tags",
            "Amount",
            "Currency",
            "Notes",
            "Account number",
            "Transfer account",
            "Transfer account number",
            "Refund of transaction number",
        ],
        ["1", "2026-09-15", "Harbour Coffee", "Coffee", "Wallet", "", "-4.50", "CAD", "", "4", "", "", ""],
        ["2", "2026-03-19", "Myself", "Transfer", "Checking", "", "-5.00", "CAD", "", "2", "Outside this app", "", ""],
        ["3", "2026-03-18", "Myself", "Transfer", "Checking", "", "-10.00", "CAD", "", "2", "", "", ""],
        ["4", "2026-03-17", "Myself", "Transfer", "Checking", "", "-20.00", "CAD", "", "2", "Checking", "1", ""],
        ["5", "2026-03-16", "Myself", "Groceries", "Checking", "", "5.00", "CAD", "", "1", "", "", "6"],
        ["6", "2026-03-15", "Costco", "Groceries", "Checking", "trip", "-12.50", "CAD", "'=1+1", "1", "", "", ""],
    ], "newest first, an outside transfer, a group transfer without its other side, and a refund naming its expense"
    assert files["categories.csv"] == [
        ["Number", "Name", "Kind", "Icon"],
        ["1", "Eating out", "Expense", "🍽️"],
        ["2", "Holidays", "Expense", ""],
        ["3", "Coffee", "Expense", ""],
    ], "the user's own categories only, none the app ships"
    assert files["merchants.csv"] == [
        ["Name", "Default category", "Default category number"],
        ["Costco", "Eating out", "1"],
        ["Harbour Coffee", "", ""],
    ], "the user's own merchants only, none the app ships"
    assert files["tags.csv"] == [["Name"], ["trip"]]
    budgets = files["budgets.csv"]
    assert budgets[0] == ["Number", "Name", "Currency", "Repeats", "Frequency", "Interval", "Weekday", "Day of month", "Month", "Archived"]
    assert budgets[1] == ["1", "March budget", "CAD", "Yes", "Monthly", "1", "", "1", "", "No"]
    assert [(row[1], row[4], row[6], row[8]) for row in budgets[2:]] == [
        ("Weekly budget", "Weekly", "Monday", ""),
        ("Yearly budget", "Yearly", "", "July"),
    ], "a weekly budget names its weekday and a yearly one its month"
    budget_categories = files["budget_categories.csv"]
    assert budget_categories[0] == ["Budget", "Budget number", "Category", "Category number", "Added", "Removed"]
    assert [row[:4] for row in budget_categories[1:]] == [
        ["March budget", "1", "Eating out", "1"],
        ["March budget", "1", "Holidays", "2"],
        ["Weekly budget", "2", "Holidays", "2"],
        ["Yearly budget", "3", "Holidays", "2"],
    ]
    assert [bool(row[5]) for row in budget_categories[1:]] == [False, True, False, False], (
        "only the category taken off the budget has a removal date"
    )

    # A recurring budget gains a period for each month since March, so only the first is known
    assert files["budget_periods.csv"][:2] == [
        ["Budget", "Budget number", "Start", "End", "Limit"],
        ["March budget", "1", "2026-03-01", "2026-03-31", "1000.00"],
    ]
    assert files["tax_advantaged_categories.csv"] == [
        ["Number", "Name", "Tax treatment", "Currency", "Lifetime limit", "Accrued", "Counts internal transfers"],
        ["1", "TFSA", "Exempt", "CAD", "95000.00", "0.00", "No"],
    ]
    assert files["tax_advantaged_category_limits.csv"] == [
        [
            "Tax-advantaged category",
            "Tax-advantaged category number",
            "Year",
            "Contribution limit",
            "Withdrawal limit",
            "Accrued contributions",
            "Accrued withdrawals",
        ],
        ["TFSA", "1", "2026", "7000.00", "2000.00", "1000.00", "250.00"],
    ]
    assert files["saved_insights_ranges.csv"] == [["Name", "Amount", "Unit", "Qualifier"], ["Half-year review", "6", "month", "Past"]]
    assert files["bank_connections.csv"] == [
        ["Provider", "Nickname", "Connected", "Last successful sync"],
        ["Fake Bank", "Main bank", "2026-09-01T08:30:00+00:00", "2026-10-02T09:00:00+00:00"],
    ]
    assert _mask_instants(files["bank_links.csv"]) == [
        ["Account", "Account number", "Bank account name", "Institution", "State", "Linked", "Unlinked"],
        ["Checking", "1", "Everyday Chequing", "Harbour Bank", "Linked", "<instant>", ""],
    ]
    assert files["bank_items.csv"][0] == [
        "Account",
        "Account number",
        "Date",
        "Amount",
        "Currency",
        "Description",
        "Merchant",
        "Note",
        "Review status",
        "Removed",
    ]
    assert len(files["bank_items.csv"]) == 2, "only the item on the user's own account, none on a group's or another user's"
    assert files["bank_items.csv"][1][:5] == ["Checking", "1", "2026-10-03", "-12.50", "CAD"]
    assert files["bank_items.csv"][1][8:] == ["Needs review", ""]
    assert _mask_instants(files["imports.csv"]) == [
        ["Source", "File name", "Started", "Saved", "Transaction count"],
        ["CSV", "", "<instant>", "<instant>", "1"],
    ]

    text = "\n".join(_every_file_text(resp))
    for seeded_id in (user_id, first_checking, second_checking, joint, expense.json()["id"], dining, costco, trip, tfsa, budget, connection.id):
        assert str(seeded_id) not in text, f"{seeded_id} is an id"
    assert "not-a-real-token" not in text, "the stored sign-in credential"
    for left_out in ("Joint", "Shared", "shared", "Theirs", "Abandoned", "Leaked"):
        assert left_out not in text, f"{left_out} belongs to a group or to someone else"


async def test_data_export_of_a_user_with_nothing_still_has_every_file(client):
    """A new user gets each file with only its header, so no file is missing from the download."""
    signup = await _create_user(client)
    headers = _get_auth_header(signup)

    resp = await client.get("/me/export", headers=headers)

    assert resp.status_code == 200
    files = _read_archive(resp)
    assert list(files) == FILE_NAMES
    assert len(files["profile.csv"]) == 2, "the profile's row"
    assert {name: len(rows) for name, rows in files.items() if name != "profile.csv"} == dict.fromkeys(FILE_NAMES[1:], 1), (
        "nothing but a header in each of the others"
    )
