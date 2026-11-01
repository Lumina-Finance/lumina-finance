import csv
import io
import re
import uuid
from decimal import Decimal

import pytest

from app.services.transactions import export as export_service
from app.services.transactions.export import format_minor_units, neutralize_spreadsheet_formula
from tests.routes.support.clock_helpers import PROFILE_LATE_EVENING, PROFILE_TODAY
from tests.routes.transactions._helpers import (
    _create_account,
    _create_category,
    _create_merchant,
    _create_tag,
    _create_transaction,
    _seed_jpy_currency,
    _seed_usd_currency,
    _setup_user_with_deps,
)

EXPECTED_HEADER = ["Date", "Merchant", "Category", "Account", "Tags", "Amount", "Currency", "Notes"]


def _parse_csv(response):
    """Return the rows of an export response, with the header first"""
    assert response.text.startswith("﻿")
    return list(csv.reader(io.StringIO(response.text.removeprefix("﻿"))))


async def test_export_transactions_writes_named_columns_without_ids(client):
    """A row carries names and a signed decimal amount, and nothing internal."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    merchant = await _create_merchant(client, headers, name="Costco")
    tag_b = await _create_tag(client, headers, name="work")
    tag_a = await _create_tag(client, headers, name="trip")
    await _create_transaction(
        client,
        headers,
        account_id,
        category_id,
        merchant_id=merchant.json()["id"],
        amount=-1250,
        notes="Lunch, with team",
        tag_ids=[tag_b.json()["id"], tag_a.json()["id"]],
    )

    resp = await client.get("/transactions/export", headers=headers)

    assert resp.status_code == 200
    assert resp.headers["content-type"] == "text/csv; charset=utf-8"
    assert re.fullmatch(r'attachment; filename="lumina-finance-transactions-\d{4}-\d{2}-\d{2}\.csv"', resp.headers["content-disposition"])
    assert _parse_csv(resp) == [
        EXPECTED_HEADER,
        ["2026-03-15", "Costco", "Main Groceries", "Main Chequing", "trip, work", "-12.50", "CAD", "Lunch, with team"],
    ]


async def test_export_transactions_applies_the_lists_filters_and_search(client):
    """The export keeps exactly what the list's account, date and search filters keep."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    other_category = await _create_category(client, headers, name="Road trips")
    await _create_transaction(client, headers, account_id, category_id, dt="2026-01-10", amount=-100, notes="keep me")
    await _create_transaction(client, headers, account_id, category_id, dt="2026-01-11", amount=-200, notes="other")
    await _create_transaction(client, headers, account_id, other_category.json()["id"], dt="2026-02-01", amount=-300, notes="keep me")

    by_search = await client.get("/transactions/export?q=keep", headers=headers)
    by_dates = await client.get("/transactions/export?from_date=2026-01-11&to_date=2026-01-31", headers=headers)
    by_category = await client.get(f"/transactions/export?category_id={other_category.json()['id']}", headers=headers)

    assert [row[5] for row in _parse_csv(by_search)[1:]] == ["-3.00", "-1.00"]
    assert [row[5] for row in _parse_csv(by_dates)[1:]] == ["-2.00"]
    assert [row[5] for row in _parse_csv(by_category)[1:]] == ["-3.00"]


async def test_export_transactions_keeps_exactly_what_the_list_keeps_for_every_filter(client):
    """Each condition the filters panel offers narrows the file to the rows the list shows for it."""
    await _seed_usd_currency()
    headers, account_id, category_id = await _setup_user_with_deps(client)
    savings_id = (await _create_account(client, headers, name="Savings")).json()["id"]
    usd_id = (await _create_account(client, headers, name="USD Account", currency="USD")).json()["id"]
    road_trips_id = (await _create_category(client, headers, name="Road trips")).json()["id"]
    merchant_id = (await _create_merchant(client, headers)).json()["id"]
    trip_id = (await _create_tag(client, headers, name="trip")).json()["id"]
    work_id = (await _create_tag(client, headers, name="work")).json()["id"]

    # Every amount is different, so a row is told apart by it in both the list and the file
    await _create_transaction(client, headers, account_id, category_id, dt="2026-01-10", amount=-100, notes="alpha")
    await _create_transaction(
        client, headers, account_id, road_trips_id, dt="2026-01-11", amount=-200, merchant_id=merchant_id, tag_ids=[trip_id]
    )
    await _create_transaction(client, headers, account_id, category_id, dt="2026-01-31", amount=-300, tag_ids=[trip_id, work_id])
    await _create_transaction(client, headers, savings_id, category_id, dt="2026-02-01", amount=-400, notes="alpha")
    await _create_transaction(client, headers, usd_id, category_id, dt="2026-01-20", amount=-500, currency="USD")

    cases = {
        "account": (f"account_id={savings_id}", [-400]),
        "two accounts": (f"account_id={savings_id}&account_id={usd_id}", [-500, -400]),
        "category": (f"category_id={road_trips_id}", [-200]),
        "merchant": (f"merchant_id={merchant_id}", [-200]),
        "tag": (f"tag_id={work_id}", [-300]),
        "every tag": (f"tag_id={trip_id}&tag_id={work_id}&tag_match=all", [-300]),
        "any tag": (f"tag_id={trip_id}&tag_id={work_id}&tag_match=any", [-300, -200]),
        "currency": ("currency=USD", [-500]),
        "amount range": ("min_amount=150&max_amount=350&amount_currency=CAD", [-300, -200]),
        "start date": ("from_date=2026-01-31", [-400, -300]),
        "end date": ("to_date=2026-01-11", [-200, -100]),
        "one day": ("from_date=2026-01-11&to_date=2026-01-11", [-200]),
        "date range": ("from_date=2026-01-11&to_date=2026-01-31", [-300, -500, -200]),
        "search": ("q=alpha", [-400, -100]),
        "several together": (f"account_id={account_id}&tag_id={trip_id}&from_date=2026-01-11", [-300, -200]),
    }

    for name, (query, expected_amounts) in cases.items():
        listed = await client.get(f"/transactions?{query}&limit=50", headers=headers)
        exported = await client.get(f"/transactions/export?{query}", headers=headers)

        exported_amounts = [int(Decimal(row[5]) * 100) for row in _parse_csv(exported)[1:]]
        assert sorted(exported_amounts) == sorted(expected_amounts), name
        assert sorted(exported_amounts) == sorted(row["amount"] for row in listed.json()), name


async def test_export_transactions_leaves_out_another_users_transactions(client, monkeypatch):
    """Rows spanning several chunks are all the caller's, none missing and none repeated."""
    monkeypatch.setattr("app.services.transactions.export.EXPORT_CHUNK_SIZE", 2)
    headers, account_id, category_id = await _setup_user_with_deps(client)
    other_headers, other_account, other_category = await _setup_user_with_deps(client, email="other@example.com", name_prefix="Other")
    for index in range(5):
        await _create_transaction(client, headers, account_id, category_id, amount=-(index + 1) * 100, notes=f"mine {index}")
        await _create_transaction(client, other_headers, other_account, other_category, amount=-999, notes=f"theirs {index}")

    resp = await client.get("/transactions/export", headers=headers)

    notes = [row[7] for row in _parse_csv(resp)[1:]]
    assert sorted(notes) == [f"mine {index}" for index in range(5)]


async def test_export_transactions_neutralizes_text_that_starts_a_formula(client):
    """Text cells starting with a formula character are written as text, and amounts stay numbers."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    merchant = await _create_merchant(client, headers, name='=HYPERLINK("http://evil.example","pay")')
    await _create_tag(client, headers, name="@sum")
    tag = await _create_tag(client, headers, name="+1")
    await _create_transaction(
        client,
        headers,
        account_id,
        category_id,
        merchant_id=merchant.json()["id"],
        amount=-500,
        notes="-2+3",
        tag_ids=[tag.json()["id"]],
    )

    resp = await client.get("/transactions/export", headers=headers)

    row = _parse_csv(resp)[1]
    assert row[1] == '\'=HYPERLINK("http://evil.example","pay")'
    assert row[4] == "'+1"
    assert row[5] == "-5.00"
    assert row[7] == "'-2+3"


async def test_export_transactions_with_no_matches_returns_only_the_header(client):
    """A filter that keeps nothing still answers with a valid file holding the header row."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    await _create_transaction(client, headers, account_id, category_id)

    resp = await client.get("/transactions/export?q=nothing-matches-this", headers=headers)

    assert resp.status_code == 200
    assert _parse_csv(resp) == [EXPECTED_HEADER]


async def test_export_transactions_with_reversed_dates_returns_422(client):
    """The list's date check refuses before any of the file is sent."""
    headers, _, _ = await _setup_user_with_deps(client)

    resp = await client.get("/transactions/export?from_date=2026-02-01&to_date=2026-01-01", headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Start date must be before end date"


async def test_export_transactions_without_a_token_returns_401(client):
    """The export is not reachable without signing in."""
    resp = await client.get("/transactions/export")

    assert resp.status_code == 401


async def _export_selected(client, headers, transaction_ids):
    return await client.post("/transactions/export", headers=headers, json={"transaction_ids": transaction_ids})


async def test_export_selected_transactions_writes_only_the_chosen_rows_newest_first(client):
    """The file holds the chosen rows in the list's order, not the order the ids were sent in."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    older = await _create_transaction(client, headers, account_id, category_id, dt="2026-01-10", amount=-100, notes="older")
    await _create_transaction(client, headers, account_id, category_id, dt="2026-01-15", amount=-200, notes="left out")
    newer = await _create_transaction(client, headers, account_id, category_id, dt="2026-01-20", amount=-300, notes="newer")

    resp = await _export_selected(client, headers, [older.json()["id"], newer.json()["id"]])

    assert resp.status_code == 200
    assert resp.headers["content-type"] == "text/csv; charset=utf-8"
    assert re.fullmatch(r'attachment; filename="lumina-finance-transactions-\d{4}-\d{2}-\d{2}\.csv"', resp.headers["content-disposition"])
    assert _parse_csv(resp)[0] == EXPECTED_HEADER
    assert [row[5] for row in _parse_csv(resp)[1:]] == ["-3.00", "-1.00"]


async def test_export_selected_transactions_writes_a_repeated_id_once(client):
    """Sending the same id twice does not repeat its row or count as a missing one."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    created = await _create_transaction(client, headers, account_id, category_id, amount=-100)
    transaction_id = created.json()["id"]

    resp = await _export_selected(client, headers, [transaction_id, transaction_id])

    assert resp.status_code == 200
    assert len(_parse_csv(resp)) == 2


async def test_export_selected_transactions_refuses_another_users_transaction(client):
    """Another user's id exports nothing, alone or among the caller's own."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    other_headers, other_account, other_category = await _setup_user_with_deps(client, email="other@example.com", name_prefix="Other")
    mine = await _create_transaction(client, headers, account_id, category_id, amount=-100, notes="mine")
    theirs = await _create_transaction(client, other_headers, other_account, other_category, amount=-999, notes="theirs secret")

    alone = await _export_selected(client, headers, [theirs.json()["id"]])
    among_mine = await _export_selected(client, headers, [mine.json()["id"], theirs.json()["id"]])

    for resp in (alone, among_mine):
        assert resp.status_code == 404
        assert "theirs secret" not in resp.text
        assert "text/csv" not in resp.headers["content-type"]
    assert alone.json()["detail"] == "1 of 1 transactions were not found"
    assert among_mine.json()["detail"] == "1 of 2 transactions were not found"


async def test_export_selected_transactions_refuses_an_unknown_id(client):
    """An id that matches nothing refuses the whole request, so a file never looks complete while a row is missing."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    created = await _create_transaction(client, headers, account_id, category_id, amount=-100)

    resp = await _export_selected(client, headers, [created.json()["id"], str(uuid.uuid4())])

    assert resp.status_code == 404
    assert resp.json()["detail"] == "1 of 2 transactions were not found"


async def test_export_selected_transactions_streams_across_chunks_and_neutralizes_formulas(client, monkeypatch):
    """Chosen rows spanning several chunks are all written once, with formula text kept as text."""
    monkeypatch.setattr("app.services.transactions.export.EXPORT_CHUNK_SIZE", 2)
    headers, account_id, category_id = await _setup_user_with_deps(client)
    merchant = await _create_merchant(client, headers, name="=SUM(A1)")
    chosen = []
    for index in range(5):
        created = await _create_transaction(
            client, headers, account_id, category_id, merchant_id=merchant.json()["id"], amount=-(index + 1) * 100, notes=f"-pick {index}"
        )
        chosen.append(created.json()["id"])
    await _create_transaction(client, headers, account_id, category_id, amount=-9900, notes="not picked")

    resp = await _export_selected(client, headers, chosen)

    rows = _parse_csv(resp)[1:]
    assert sorted(row[7] for row in rows) == [f"'-pick {index}" for index in range(5)]
    assert {row[1] for row in rows} == {"'=SUM(A1)"}


async def test_export_selected_transactions_requires_a_sign_in_and_one_to_a_thousand_ids(client):
    """The request is refused without a token, with no ids, and with more ids than a bulk edit takes."""
    headers, _, _ = await _setup_user_with_deps(client)

    unauthenticated = await client.post("/transactions/export", json={"transaction_ids": [str(uuid.uuid4())]})
    empty = await _export_selected(client, headers, [])
    too_many = await _export_selected(client, headers, [str(uuid.uuid4()) for _ in range(1001)])

    assert unauthenticated.status_code == 401
    assert empty.status_code == 422
    assert too_many.status_code == 422


async def test_export_selected_transactions_accepts_exactly_a_thousand_ids(client):
    """A thousand ids pass the size check, so the request goes on to look them up and refuses only the unknown ones."""
    headers, _, _ = await _setup_user_with_deps(client)

    resp = await _export_selected(client, headers, [str(uuid.uuid4()) for _ in range(1000)])

    assert resp.status_code == 404
    assert resp.json()["detail"] == "1000 of 1000 transactions were not found"


async def test_export_writes_every_row_beyond_one_list_page(client):
    """Fifty-five rows, more than the list's page of fifty, are all written by both exports."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    created = [
        (await _create_transaction(client, headers, account_id, category_id, amount=-(index + 1) * 100, notes=f"row {index}")).json()["id"]
        for index in range(55)
    ]

    everything = await client.get("/transactions/export", headers=headers)
    chosen = await _export_selected(client, headers, created)

    for resp in (everything, chosen):
        assert resp.status_code == 200
        assert sorted(row[7] for row in _parse_csv(resp)[1:]) == sorted(f"row {index}" for index in range(55))


async def test_export_includes_rows_of_an_account_the_caller_reaches_without_owning(client):
    """A read-only share is exported by both routes, while the owner's unshared account stays out."""
    headers, _, _ = await _setup_user_with_deps(client)
    owner_headers, owner_account, owner_category = await _setup_user_with_deps(client, email="other@example.com", name_prefix="Other")
    group = (await client.post("/groups", headers=owner_headers, json={"name": "Household"})).json()["id"]
    shared_account = (await _create_account(client, owner_headers, name="Shared", group_id=group)).json()["id"]
    shared_category = (await _create_category(client, owner_headers, name="Shared food", group_id=group)).json()["id"]
    user_id = (await client.get("/me", headers=headers)).json()["id"]
    assert (await client.post(f"/groups/{group}/members", headers=owner_headers, json={"user_id": user_id})).status_code == 201
    permission = await client.post(f"/accounts/{shared_account}/permissions", headers=owner_headers, json={"user_id": user_id, "level": "read"})
    assert permission.status_code == 201
    shared = await _create_transaction(client, owner_headers, shared_account, shared_category, amount=-700, notes="shared row")
    private = await _create_transaction(client, owner_headers, owner_account, owner_category, amount=-800, notes="private row")

    listed = await client.get("/transactions/export", headers=headers)
    chosen = await _export_selected(client, headers, [shared.json()["id"]])
    refused = await _export_selected(client, headers, [shared.json()["id"], private.json()["id"]])

    assert [row[7] for row in _parse_csv(listed)[1:]] == ["shared row"]
    assert [row[7] for row in _parse_csv(chosen)[1:]] == ["shared row"]
    assert refused.status_code == 404
    assert refused.json()["detail"] == "1 of 2 transactions were not found"


async def test_export_writes_amounts_to_the_exponent_of_a_zero_decimal_currency(client):
    """A yen amount is written whole, with no decimal places, by both exports."""
    await _seed_jpy_currency()
    headers, _, category_id = await _setup_user_with_deps(client)
    yen_account = (await _create_account(client, headers, name="Yen", currency="JPY")).json()["id"]
    created = await _create_transaction(client, headers, yen_account, category_id, amount=-1500, currency="JPY")

    everything = await client.get("/transactions/export", headers=headers)
    chosen = await _export_selected(client, headers, [created.json()["id"]])

    for resp in (everything, chosen):
        assert [row[5:7] for row in _parse_csv(resp)[1:]] == [["-1500", "JPY"]]


async def test_export_is_never_cached(client):
    """Both exports tell the browser and any proxy not to keep the file."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    created = await _create_transaction(client, headers, account_id, category_id)

    everything = await client.get("/transactions/export", headers=headers)
    chosen = await _export_selected(client, headers, [created.json()["id"]])

    assert everything.headers["cache-control"] == "no-store"
    assert chosen.headers["cache-control"] == "no-store"


async def test_export_names_the_file_after_the_day_in_the_users_timezone(client, freeze_now):
    """At 23:30 in Toronto it is already the next day in UTC, and the filename keeps the user's own day."""
    freeze_now(export_service, PROFILE_LATE_EVENING)
    headers, account_id, category_id = await _setup_user_with_deps(client)
    created = await _create_transaction(client, headers, account_id, category_id)

    everything = await client.get("/transactions/export", headers=headers)
    chosen = await _export_selected(client, headers, [created.json()["id"]])

    for resp in (everything, chosen):
        assert resp.headers["content-disposition"] == f'attachment; filename="lumina-finance-transactions-{PROFILE_TODAY.isoformat()}.csv"'


@pytest.mark.parametrize(
    ("amount", "exponent", "expected"),
    [
        (-1250, 2, "-12.50"),
        (-5, 2, "-0.05"),
        (0, 2, "0.00"),
        (1234567, 0, "1234567"),
        (-1500, 3, "-1.500"),
        (123456789012345678, 2, "1234567890123456.78"),
    ],
)
def test_format_minor_units_writes_exact_decimals(amount, exponent, expected):
    """Amounts are written to the currency's exponent without rounding or exponent notation."""
    assert format_minor_units(amount, exponent) == expected


@pytest.mark.parametrize("first_character", ["=", "+", "-", "@", "\t", "\r", "\n"])
def test_neutralize_spreadsheet_formula_prefixes_each_trigger_character(first_character):
    """Each character a spreadsheet treats as the start of a formula gets the apostrophe."""
    assert neutralize_spreadsheet_formula(f"{first_character}1") == f"'{first_character}1"


def test_neutralize_spreadsheet_formula_leaves_other_text_alone():
    """Ordinary text, empty text and a character mid-text pass through unchanged."""
    assert neutralize_spreadsheet_formula("Costco") == "Costco"
    assert neutralize_spreadsheet_formula("") == ""
    assert neutralize_spreadsheet_formula("a=b") == "a=b"
