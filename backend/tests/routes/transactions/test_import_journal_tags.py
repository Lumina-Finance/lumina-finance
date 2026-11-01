"""Firefly III and Actual Budget imports write tags through the same writer the CSV import uses, which folds capitals"""

import pytest

from tests.routes.support import _create_user, _get_auth_header
from tests.routes.transactions._import_helpers import _GROCERIES, _chequing_mapping, _firefly_row, _import_run

_ACTUAL_CHECKING = {"source": "Checking", "create": {"name": "Checking", "account_type": "checking", "currency": "CAD"}}
_ACTUAL_FOOD = {"source": "Food", "create": {"name": "Food", "kind": "expense"}}


def _firefly_payload(tag_names_by_row):
    """Build a Firefly III payload with one withdrawal for each list of tag names"""
    return {
        "accounts": [_chequing_mapping()],
        "categories": [_GROCERIES],
        "rows": [_firefly_row(journal_id=str(index), tag_names=names) for index, names in enumerate(tag_names_by_row)],
    }


def _actual_payload(tag_names_by_row):
    """Build an Actual Budget payload with one withdrawal for each list of tag names"""
    return {
        "accounts": [_ACTUAL_CHECKING],
        "categories": [_ACTUAL_FOOD],
        "rows": [
            {
                "journal_id": f"a1f0c7e2-000{index}",
                "type": "withdrawal",
                "dt": "2026-01-10",
                "amount": "45.67",
                "currency_code": "CAD",
                "description": "Weekly groceries",
                "source_account": "Checking",
                "destination_name": "Neighbourhood Grocer",
                "category": "Food",
                "tag_names": names,
            }
            for index, names in enumerate(tag_names_by_row)
        ],
    }


@pytest.mark.parametrize(
    ("source", "build"),
    [("firefly", _firefly_payload), ("actual_budget", _actual_payload)],
)
async def test_tag_names_differing_only_in_capitals_make_one_tag_that_both_rows_carry(client, source, build):
    """Travel on one row and TRAVEL on another are one tag, written under the first spelling."""
    headers = _get_auth_header(await _create_user(client))

    resp = await _import_run(client, headers, build([["Travel"], ["TRAVEL"]]), source=source)

    assert resp.status_code == 201, resp.text
    assert resp.json()["tags_created"] == 1
    tags = (await client.get("/tags", headers=headers)).json()
    assert [tag["name"] for tag in tags] == ["Travel"]
    transactions = (await client.get("/transactions", headers=headers)).json()
    assert [[tag["id"] for tag in transaction["tags"]] for transaction in transactions] == [[tags[0]["id"]]] * 2


@pytest.mark.parametrize(
    ("source", "build"),
    [("firefly", _firefly_payload), ("actual_budget", _actual_payload)],
)
async def test_tag_name_of_exactly_64_characters_is_accepted(client, source, build):
    """The longest tag a person can have imports, so the limit is not off by one."""
    headers = _get_auth_header(await _create_user(client))
    name = "t" * 64

    resp = await _import_run(client, headers, build([[name]]), source=source)

    assert resp.status_code == 201, resp.text
    assert [tag["name"] for tag in (await client.get("/tags", headers=headers)).json()] == [name]


@pytest.mark.parametrize(
    ("source", "build"),
    [("firefly", _firefly_payload), ("actual_budget", _actual_payload)],
)
async def test_tag_name_of_65_characters_is_refused_and_nothing_is_written(client, source, build):
    """One character past the limit refuses the whole import with 422 before anything is written."""
    headers = _get_auth_header(await _create_user(client))

    resp = await _import_run(client, headers, build([["t" * 65]]), source=source)

    assert resp.status_code == 422, resp.text
    assert (await client.get("/tags", headers=headers)).json() == []
    assert (await client.get("/transactions", headers=headers)).json() == []
