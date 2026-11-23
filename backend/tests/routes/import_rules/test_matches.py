"""POST /import-rules/matches"""

import pytest

from app.models.category import Category
from app.models.merchant import Merchant
from app.services.import_rules import matches
from tests.routes.support import (
    _amount_at_least,
    _create_rule_ok,
    _create_second_user,
    _create_user,
    _description_contains,
    _get_auth_header,
    _make_category,
    _make_merchant,
    _make_tag,
)
from tests.routes.support.import_rule_helpers import _delete_rule_and_record_after_rules_load

URL = "/import-rules/matches"
CHANGED = "Your import rules or the records they name changed meanwhile. Please try again."


def _row(description: str | None = "AMAZON.CA", amount: str = "-20.00", **overrides) -> dict:
    """Return a file row as the import page sends it"""
    return {"description": description, "note": None, "amount": amount, "currency": "CAD", "account_id": None, "is_transfer": False} | overrides


async def _signed_in(client) -> dict:
    """Sign the default user up and return their auth headers"""
    return _get_auth_header(await _create_user(client))


async def _amazon_and_large_rules(client, headers) -> dict:
    """Create example 2's rules: Amazon above Large purchases, which adds the Review tag"""
    ids = {
        "amazon": await _make_merchant(client, headers, "Amazon"),
        "large": await _make_category(client, headers, "Large purchases"),
        "review": await _make_tag(client, headers, "Review"),
    }
    ids["amazon_rule"] = (
        await _create_rule_ok(client, headers, name="Amazon", merchant_id=ids["amazon"], conditions=[_description_contains("amazon")])
    )["id"]
    ids["large_rule"] = (
        await _create_rule_ok(
            client, headers, name="Large", category_id=ids["large"], tag_ids=[ids["review"]], conditions=[_amount_at_least("500")]
        )
    )["id"]
    return ids


async def test_the_answer_gives_each_rows_values_with_their_rules_and_counts_the_rows_each_rule_won(client):
    """Example 2 row by row: a transfer is left alone, another currency misses the amount rule, and a tag the file gives counts for no rule"""
    headers = await _signed_in(client)
    ids = await _amazon_and_large_rules(client, headers)
    amazon, large = {"id": ids["amazon_rule"], "name": "Amazon"}, {"id": ids["large_rule"], "name": "Large"}

    response = await client.post(
        URL,
        json={
            "rows": [
                _row(amount="-800.00"),
                _row(amount="-20.00"),
                _row(amount="-800.00", is_transfer=True),
                _row("Corner shop", "-900.00", tag_names=["review"]),
                _row(amount="-800.00", currency="USD"),
            ]
        },
        headers=headers,
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["rows"][0] == {
        "merchant": {"id": ids["amazon"], "name": "Amazon", "rule": amazon},
        "category": {"id": ids["large"], "name": "Large purchases", "rule": large},
        "tags": [{"id": ids["review"], "name": "Review", "rule": large}],
        "tag_count": 1,
    }
    assert body["rows"][1] == {
        "merchant": {"id": ids["amazon"], "name": "Amazon", "rule": amazon},
        "category": None,
        "tags": [],
        "tag_count": 0,
    }
    assert body["rows"][2] == {"merchant": None, "category": None, "tags": [], "tag_count": 0}
    assert body["rows"][3] == {
        "merchant": None,
        "category": {"id": ids["large"], "name": "Large purchases", "rule": large},
        "tags": [],
        "tag_count": 1,
    }
    assert body["rows"][4]["merchant"]["rule"] == amazon and body["rows"][4]["category"] is None
    assert body["rules"] == [{"rule": amazon, "row_count": 3}, {"rule": large, "row_count": 2}]
    assert len(body["rules_version"]) == 64


async def test_the_version_stays_while_the_rules_do_and_changes_when_one_is_edited(client):
    """A file checked in batches tells from the version whether a rule changed between them"""
    headers = await _signed_in(client)
    ids = await _amazon_and_large_rules(client, headers)

    first = (await client.post(URL, json={"rows": [_row()]}, headers=headers)).json()["rules_version"]
    again = (await client.post(URL, json={"rows": [_row("Other")]}, headers=headers)).json()["rules_version"]
    assert (await client.patch(f"/import-rules/{ids['amazon_rule']}", json={"name": "Amazon.ca"}, headers=headers)).status_code == 200
    edited = (await client.post(URL, json={"rows": [_row()]}, headers=headers)).json()["rules_version"]

    assert first == again
    assert edited != first


async def test_a_person_with_no_rules_gets_an_empty_answer_for_every_row(client):
    """Nothing matches, no rule is counted, and the request still answers"""
    headers = await _signed_in(client)

    response = await client.post(URL, json={"rows": [_row(), _row("Other")]}, headers=headers)

    assert response.status_code == 200, response.text
    assert response.json()["rows"] == [{"merchant": None, "category": None, "tags": [], "tag_count": 0}] * 2
    assert response.json()["rules"] == []


async def test_another_users_rules_are_never_applied(client):
    """Rules belong to their owner, so a second user's rows match none of the first's"""
    headers = await _signed_in(client)
    await _amazon_and_large_rules(client, headers)
    other_headers = _get_auth_header(await _create_second_user(client))

    response = await client.post(URL, json={"rows": [_row(amount="-800.00")]}, headers=other_headers)

    assert response.status_code == 200, response.text
    assert response.json()["rows"][0]["merchant"] is None
    assert response.json()["rules"] == []


async def test_an_amount_the_currency_cannot_hold_fails_no_request_and_matches_no_amount_or_direction_condition(client):
    """The save refuses such a row before any rule runs, so the preview just leaves its amount out of the matching"""
    headers = await _signed_in(client)
    tag_id = await _make_tag(client, headers, "Review")
    await _create_rule_ok(client, headers, name="Big", tag_ids=[tag_id], conditions=[_amount_at_least("5")])
    await _create_rule_ok(
        client,
        headers,
        name="Money out",
        tag_ids=[tag_id],
        conditions=[{"kind": "condition", "attribute": "direction", "operator": "is", "value": "out"}],
    )
    await _create_rule_ok(client, headers, name="Amazon", tag_ids=[tag_id], conditions=[_description_contains("amazon")])
    unreadable = [_row(amount="abc"), _row(amount="-1.234"), _row(amount="-100", currency="ZZZ"), _row(amount="9" * 40)]

    response = await client.post(URL, json={"rows": unreadable}, headers=headers)

    assert response.status_code == 200, response.text
    assert [[tag["rule"]["name"] for tag in row["tags"]] for row in response.json()["rows"]] == [["Amazon"]] * 4


@pytest.mark.parametrize(("model", "kind"), [(Merchant, "amazon"), (Category, "large")])
async def test_a_merchant_or_category_deleted_after_the_rules_were_read_answers_that_the_rules_changed(client, monkeypatch, model, kind):
    """The rule naming it goes with it after the request read the rules, so the answer would name what is gone and asks to try again"""
    headers = await _signed_in(client)
    ids = await _amazon_and_large_rules(client, headers)
    _delete_rule_and_record_after_rules_load(monkeypatch, matches, ids[f"{kind}_rule"], model, ids[kind])

    response = await client.post(URL, json={"rows": [_row(amount="-800.00")]}, headers=headers)

    assert (response.status_code, response.json()["detail"]) == (409, CHANGED)


async def test_matching_without_auth_returns_401(client):
    """Rules are a signed-in user's"""
    assert (await client.post(URL, json={"rows": [_row()]})).status_code == 401
