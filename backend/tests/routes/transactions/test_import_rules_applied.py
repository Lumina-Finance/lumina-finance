"""What a file import's save does with the user's import rules, read back from the saved transactions

The rules are read when the save runs, after rows the account already holds are left out, so each
case is a real save over the CSV, OFX and QIF endpoints and the journal ones the rules leave alone
"""

from app.models.merchant import Merchant
from app.services.importers.generic import rule_fill
from tests.routes.support import (
    _account_is,
    _amount_at_least,
    _create_rule_ok,
    _description_contains,
    _make_category,
    _make_merchant,
    _make_tag,
)
from tests.routes.support.import_rule_helpers import _delete_rule_and_record_after_rules_load
from tests.routes.transactions._helpers import (
    NONEXISTENT_ID,
    _create_account,
    _get_system_category_id,
    _setup_user_with_deps,
)
from tests.routes.transactions._import_helpers import (
    _commit_run,
    _csv_batch,
    _firefly_batch,
    _import_rows,
    _import_run,
    _list_transactions,
    _open_staged_run,
)

_CHEQUING_KEY = "bank:021000021:000111222333"


def _note_contains(value: str) -> dict:
    """Return a condition on the note containing some text"""
    return {"kind": "condition", "attribute": "note", "operator": "contains", "value": value}


async def _names(client, headers, path: str) -> set[str]:
    """Return the names a listing holds"""
    return {item["name"] for item in (await client.get(path, headers=headers)).json()}


def _tag_names(transaction: dict) -> list[str]:
    """Return the names of a saved transaction's tags, in order"""
    return sorted(tag["name"] for tag in transaction["tags"])


async def test_example_one_a_row_a_rule_matches_is_saved_under_the_rules_merchant_and_category_and_makes_no_merchant_of_its_name(client):
    """The matched row takes the rule's values over the file's, an unmatched row keeps the file's, and a covered name creates nothing"""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    market = await _make_merchant(client, headers, "Market")
    market_food = await _make_category(client, headers, "Market food")
    await _create_rule_ok(
        client, headers, name="Market", conditions=[_description_contains("sq *market")], merchant_id=market, category_id=market_food
    )

    resp = await _import_rows(
        client,
        headers,
        account_id,
        category_id,
        [
            {"merchant_name": "SQ *MARKET 1234 TORONTO", "amount": "-12.50"},
            {"merchant_name": "Corner Cafe", "amount": "-4.00"},
            {"amount": "-3.00"},
        ],
    )

    assert resp.status_code == 200, resp.text
    saved = {transaction["amount"]: transaction for transaction in await _list_transactions(client, headers)}
    assert (saved[-1250]["merchant_name"], saved[-1250]["category_id"]) == ("Market", market_food)
    assert (saved[-400]["merchant_name"], saved[-400]["category_id"]) == ("Corner Cafe", category_id)
    assert saved[-300]["category_id"] == category_id
    merchant_names = await _names(client, headers, "/merchants")
    assert "SQ *MARKET 1234 TORONTO" not in merchant_names, "a name whose every row took the rule's merchant creates none"
    summary = resp.json()
    assert (summary["merchants_created"], summary["merchants_reused"]) == (1, 1), "Corner Cafe was created and the rule's merchant reused"
    assert summary["categories_reused"] == 2, "the file's category and the rule's"


async def test_example_two_a_large_amazon_row_takes_both_rules_and_a_small_one_keeps_the_files_category(client):
    """Amazon above Large purchases: each value from the highest rule setting it, the tag from the rule below"""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    amazon = await _make_merchant(client, headers, "Amazon")
    large = await _make_category(client, headers, "Large purchases")
    review = await _make_tag(client, headers, "Review")
    await _create_rule_ok(client, headers, name="Amazon", conditions=[_description_contains("amazon")], merchant_id=amazon)
    await _create_rule_ok(client, headers, name="Large", conditions=[_amount_at_least("500")], category_id=large, tag_ids=[review])

    resp = await _import_rows(
        client,
        headers,
        account_id,
        category_id,
        [{"merchant_name": "AMAZON.CA", "amount": "-800.00"}, {"merchant_name": "AMAZON.CA", "amount": "-20.00"}],
    )

    assert resp.status_code == 200, resp.text
    saved = {transaction["amount"]: transaction for transaction in await _list_transactions(client, headers)}
    assert (saved[-80000]["merchant_name"], saved[-80000]["category_id"], _tag_names(saved[-80000])) == ("Amazon", large, ["Review"])
    assert (saved[-2000]["merchant_name"], saved[-2000]["category_id"], _tag_names(saved[-2000])) == ("Amazon", category_id, [])
    assert resp.json()["merchants_created"] == 0


async def test_a_merchant_name_one_row_still_carries_is_still_created_and_the_rules_merchant_wins_over_an_answer(client):
    """A name is dropped only when every row carrying it takes a rule's merchant, and an answer for a covered row is never read"""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    amazon = await _make_merchant(client, headers, "Amazon")
    await _create_rule_ok(client, headers, name="Large", conditions=[_amount_at_least("500")], merchant_id=amazon)

    resp = await _import_rows(
        client,
        headers,
        account_id,
        category_id,
        [
            {"merchant_name": "BIG SHOP", "amount": "-800.00"},
            {"merchant_name": "BIG SHOP", "amount": "-20.00"},
            {"merchant_name": "COVERED", "amount": "-900.00"},
        ],
        merchants=[{"source": "COVERED", "create": {"name": "Answered"}}],
    )

    assert resp.status_code == 200, resp.text
    saved = {transaction["amount"]: transaction["merchant_name"] for transaction in await _list_transactions(client, headers)}
    assert saved == {-80000: "Amazon", -2000: "BIG SHOP", -90000: "Amazon"}
    assert {"BIG SHOP"} <= await _names(client, headers, "/merchants")
    assert not {"COVERED", "Answered"} & await _names(client, headers, "/merchants")


async def test_a_rules_tags_are_added_to_the_files_and_a_tag_both_give_is_on_the_row_once(client):
    """Tags gather beside the file's rather than replacing them, and the summary counts the rule's tags as reused"""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    review = await _make_tag(client, headers, "Review")
    await _create_rule_ok(client, headers, name="Market", conditions=[_description_contains("market")], tag_ids=[review])

    resp = await _import_rows(
        client,
        headers,
        account_id,
        category_id,
        [
            {"merchant_name": "Market", "amount": "-1.00", "tag_names": ["Travel", "review"]},
            {"merchant_name": "Market", "amount": "-2.00"},
            {"merchant_name": "Elsewhere", "amount": "-3.00", "tag_names": ["Travel"]},
        ],
    )

    assert resp.status_code == 200, resp.text
    saved = {transaction["amount"]: _tag_names(transaction) for transaction in await _list_transactions(client, headers)}
    assert saved == {-100: ["Review", "Travel"], -200: ["Review"], -300: ["Travel"]}
    summary = resp.json()
    assert (summary["tags_created"], summary["tags_reused"]) == (1, 1), "Travel was made and Review reused, however many rows carry them"


async def test_a_file_tag_the_user_answered_skip_is_replaced_by_nothing_and_the_rules_tag_still_lands(client):
    """The file's tag leaving the row does not take the rule's with it, since the rule's tag is only counted as the file's by its name"""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    review = await _make_tag(client, headers, "Review")
    await _create_rule_ok(client, headers, name="Market", conditions=[_description_contains("market")], tag_ids=[review])

    resp = await _import_rows(
        client,
        headers,
        account_id,
        category_id,
        [{"merchant_name": "Market", "amount": "-1.00", "tag_names": ["review"]}],
        tags=[{"source": "review", "skip": True}],
    )

    assert resp.status_code == 200, resp.text
    assert [_tag_names(transaction) for transaction in await _list_transactions(client, headers)] == [["Review"]]


async def test_a_row_whose_file_tags_and_rule_tags_pass_32_is_refused_with_nothing_kept_and_32_are_saved(client):
    """Nothing is cut: the save refuses the row as a file row with too many tags is refused, and saves the one holding exactly 32"""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    review = await _make_tag(client, headers, "Review")
    await _create_rule_ok(client, headers, name="Market", conditions=[_description_contains("market")], tag_ids=[review])
    thirty_two = [f"tag {number}" for number in range(32)]
    row = {"merchant_name": "Market", "amount": "-1.00"}

    refused = await _import_rows(client, headers, account_id, category_id, [{**row, "tag_names": thirty_two}])

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == "There are 33 tags, and a transaction carries up to 32."
    assert await _list_transactions(client, headers) == []
    assert not {"tag 0", "tag 31"} & await _names(client, headers, "/tags"), "no tag of the refused file was created"

    saved = await _import_rows(client, headers, account_id, category_id, [{**row, "tag_names": [*thirty_two[:31], "REVIEW"]}])

    assert saved.status_code == 200, saved.text
    [transaction] = await _list_transactions(client, headers)
    assert len(transaction["tags"]) == 32


async def test_a_row_filed_as_a_transfer_or_a_balance_adjustment_keeps_all_the_file_gave_it(client):
    """Rules never touch a transfer: its category, merchant, tags and counterparty stay as the file has them"""
    headers, account_id, _ = await _setup_user_with_deps(client)
    savings_id = (await _create_account(client, headers, name="Main Savings", account_type="savings")).json()["id"]
    transfer_id = await _get_system_category_id(client, headers, "Transfer")
    adjustment_id = await _get_system_category_id(client, headers, "Balance Adjustment")
    market = await _make_merchant(client, headers, "Market")
    review = await _make_tag(client, headers, "Review")
    await _create_rule_ok(
        client,
        headers,
        name="Market",
        conditions=[_description_contains("sq *market")],
        merchant_id=market,
        category_id=await _make_category(client, headers, "Market food"),
        tag_ids=[review],
    )

    resp = await _import_run(
        client,
        headers,
        {
            "accounts": [{"source": "Chequing", "account_id": account_id}, {"source": "Savings", "account_id": savings_id}],
            "categories": [{"source": "Transfer", "category_id": transfer_id}, {"source": "Adjustment", "category_id": adjustment_id}],
            "rows": [
                {
                    "account_source": "Chequing",
                    "category_source": "Transfer",
                    "dt": "2026-04-11",
                    "amount": "-500.00",
                    "merchant_name": "SQ *MARKET 1",
                    "tag_names": ["Kept"],
                    "counterparty_account_source": "Savings",
                },
                {
                    "account_source": "Savings",
                    "category_source": "Adjustment",
                    "dt": "2026-04-12",
                    "amount": "10.00",
                    "merchant_name": "SQ *MARKET 2",
                    "tag_names": [],
                },
            ],
        },
    )

    assert resp.status_code == 200, resp.text
    saved = {transaction["amount"]: transaction for transaction in await _list_transactions(client, headers)}
    assert (saved[-50000]["merchant_name"], saved[-50000]["category_id"], _tag_names(saved[-50000])) == ("SQ *MARKET 1", transfer_id, ["Kept"])
    assert saved[-50000]["counterparty_account_id"] == savings_id
    assert (saved[1000]["merchant_name"], saved[1000]["category_id"], _tag_names(saved[1000])) == ("SQ *MARKET 2", adjustment_id, [])


async def test_a_rule_on_an_account_reads_an_account_the_import_creates_as_none_of_the_ones_it_names(client):
    """'Isn't chequing' holds for the new account and 'is chequing' does not"""
    headers, account_id, _ = await _setup_user_with_deps(client)
    other = await _make_tag(client, headers, "Other account")
    chequing = await _make_tag(client, headers, "Chequing")
    await _create_rule_ok(client, headers, name="Not chequing", conditions=[_account_is(account_id, "is_not")], tag_ids=[other])
    await _create_rule_ok(client, headers, name="Chequing", conditions=[_account_is(account_id)], tag_ids=[chequing])

    resp = await _import_run(client, headers, _csv_batch(["-4.50"]))

    assert resp.status_code == 200, resp.text
    [transaction] = await _list_transactions(client, headers)
    assert _tag_names(transaction) == ["Other account"]


async def test_a_rule_made_after_the_rows_were_staged_changes_the_save(client):
    """The rules are read when the commit runs, so a rule edited after the preview is the one that applies"""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    payload = {
        "accounts": [{"source": "Main Chequing", "account_id": account_id}],
        "categories": [{"source": "Groceries", "category_id": category_id}],
        "rows": [
            {
                "account_source": "Main Chequing",
                "category_source": "Groceries",
                "dt": "2026-04-10",
                "amount": "-1.00",
                "merchant_name": "Market",
            }
        ],
    }
    run_id = await _open_staged_run(client, headers, payload)
    market = await _make_merchant(client, headers, "Market rule")
    await _create_rule_ok(client, headers, name="Market", conditions=[_description_contains("market")], merchant_id=market)

    resp = await _commit_run(client, headers, run_id)

    assert resp.status_code == 200, resp.text
    assert [transaction["merchant_name"] for transaction in await _list_transactions(client, headers)] == ["Market rule"]


async def test_a_save_that_fails_after_the_rules_were_applied_keeps_nothing(client):
    """A tag answer the save refuses once merchants are written takes the merchants, the rows and the rules' effects with it"""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    market = await _make_merchant(client, headers, "Market")
    await _create_rule_ok(client, headers, name="Market", conditions=[_description_contains("market")], merchant_id=market)

    resp = await _import_rows(
        client,
        headers,
        account_id,
        category_id,
        [{"merchant_name": "Market 1", "amount": "-1.00"}, {"merchant_name": "Corner Cafe", "amount": "-2.00", "tag_names": ["Travel"]}],
        tags=[{"source": "Travel", "tag_id": NONEXISTENT_ID}],
    )

    assert resp.status_code == 422, resp.text
    assert (
        resp.json()["detail"]
        == 'The tag chosen for "Travel" is no longer available, so go back to Tag matching and choose another tag or skip it'
    )
    assert await _list_transactions(client, headers) == []
    assert "Corner Cafe" not in await _names(client, headers, "/merchants"), "the merchant written before the failure went with the rollback"


async def test_a_merchant_deleted_after_the_save_read_the_rules_answers_that_the_rules_changed_and_saves_nothing(client, monkeypatch):
    """The rule naming it goes with it once the save has read the rules, so the save asks to be tried again and keeps no row"""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    market = await _make_merchant(client, headers, "Market")
    rule = await _create_rule_ok(client, headers, name="Market", conditions=[_description_contains("market")], merchant_id=market)
    _delete_rule_and_record_after_rules_load(monkeypatch, rule_fill, rule["id"], Merchant, market)

    resp = await _import_rows(client, headers, account_id, category_id, [{"merchant_name": "Market 1", "amount": "-1.00"}])

    assert (resp.status_code, resp.json()["detail"]) == (409, "Your import rules or the records they name changed meanwhile. Please try again.")
    assert await _list_transactions(client, headers) == []


async def test_an_ofx_save_reads_the_payee_as_description_and_leaves_a_row_the_account_holds_alone(client):
    """The held row is left out before the rules run, so a rule made since never changes the transaction already saved"""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    def statement(*bank_ids):
        return {
            "accounts": [{"source": "Statement", "account_id": account_id}],
            "categories": [{"source": "Spending", "category_id": category_id}],
            "rows": [
                {
                    "account_source": "Statement",
                    "category_source": "Spending",
                    "dt": f"2026-03-{day:02d}",
                    "amount": "-10.00",
                    "merchant_name": f"Payee {bank_id}",
                    "notes": f"Memo {bank_id}",
                    "tag_names": [],
                    "bank_account": _CHEQUING_KEY,
                    "bank_transaction": bank_id,
                }
                for day, bank_id in enumerate(bank_ids, start=1)
            ],
        }

    assert (await _import_run(client, headers, statement("A1"), source="ofx")).status_code == 200
    market = await _make_merchant(client, headers, "Market")
    await _create_rule_ok(client, headers, name="Payees", conditions=[_description_contains("payee a")], merchant_id=market)

    resp = await _import_run(client, headers, statement("A1", "A3"), source="ofx")

    assert resp.status_code == 200, resp.text
    assert resp.json()["transactions_already_imported"] == 1
    assert sorted(transaction["merchant_name"] for transaction in await _list_transactions(client, headers)) == ["Market", "Payee A1"]


async def test_a_qif_save_reads_the_payee_as_description_and_the_memo_as_note(client):
    """A rule on both fields takes a row whose payee and memo both match, and not one matching only the payee"""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    rent = await _make_merchant(client, headers, "Landlord")
    await _create_rule_ok(
        client, headers, name="Rent", conditions=[_description_contains("property"), _note_contains("april rent")], merchant_id=rent
    )
    payload = _csv_batch([])
    payload["accounts"] = [{"source": "Main Chequing", "account_id": account_id}]
    payload["categories"] = [{"source": "Groceries", "category_id": category_id}]
    payload["rows"] = [
        {
            "account_source": "Main Chequing",
            "category_source": "Groceries",
            "dt": "2026-04-10",
            "amount": amount,
            "merchant_name": "Property Mgmt",
            "notes": memo,
            "tag_names": [],
        }
        for amount, memo in (("-900.00", "April rent"), ("-50.00", "Parking"))
    ]

    resp = await _import_run(client, headers, payload, source="qif")

    assert resp.status_code == 200, resp.text
    saved = {transaction["amount"]: transaction["merchant_name"] for transaction in await _list_transactions(client, headers)}
    assert saved == {-90000: "Landlord", -5000: "Property Mgmt"}


async def test_example_five_a_firefly_row_a_rule_would_match_is_saved_as_the_file_has_it(client):
    """Firefly III and Actual Budget imports don't use rules, so the row keeps its merchant, category and tags"""
    headers, _account_id, _category_id = await _setup_user_with_deps(client)
    market = await _make_merchant(client, headers, "Market")
    review = await _make_tag(client, headers, "Review")
    await _create_rule_ok(
        client,
        headers,
        name="Grocer",
        conditions=[_description_contains("grocer")],
        merchant_id=market,
        category_id=await _make_category(client, headers, "Market food"),
        tag_ids=[review],
    )

    resp = await _import_run(client, headers, _firefly_batch(1), source="firefly")

    assert resp.status_code == 200, resp.text
    [transaction] = await _list_transactions(client, headers)
    assert transaction["merchant_name"] == "Neighbourhood Grocer"
    assert transaction["tags"] == []
    assert transaction["category_id"] == await _get_system_category_id(client, headers, "Groceries")
