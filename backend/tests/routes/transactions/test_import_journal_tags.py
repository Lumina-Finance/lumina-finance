"""Firefly III and Actual Budget imports write tags through the same writer the CSV import uses, which folds capitals"""

import pytest

from tests.routes.base_budgets._helpers import _create_second_user
from tests.routes.support import _create_user, _get_auth_header
from tests.routes.transactions._import_helpers import (
    _GROCERIES,
    _chequing_mapping,
    _commit_run,
    _firefly_row,
    _import_run,
    _open_staged_run,
)

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


def _with_tags(payload, tags):
    """Return the payload carrying the given tag answers"""
    return {**payload, "tags": tags}


async def _create_tag(client, headers, name):
    """Create a personal tag and return it"""
    resp = await client.post("/tags", json={"name": name}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _list_written_records(client, headers):
    """Return what the user owns of each kind an import writes, leaving out the categories every user starts with"""
    records = {}
    for kind in ("transactions", "accounts", "categories", "tags"):
        found = (await client.get(f"/{kind}", headers=headers)).json()
        records[kind] = [record for record in found if record.get("owner_id", "mine") is not None]
    return records


@pytest.mark.parametrize(
    ("source", "build"),
    [("firefly", _firefly_payload), ("actual_budget", _actual_payload)],
)
async def test_a_tag_answered_skip_is_left_off_its_rows_and_the_rows_still_import(client, source, build):
    """Skipping a tag leaves it off every row that carries it, without creating it or dropping the transaction."""
    headers = _get_auth_header(await _create_user(client))

    resp = await _import_run(
        client,
        headers,
        _with_tags(build([["Trip", "Food"]]), [{"source": "Trip", "skip": True}]),
        source=source,
    )

    assert resp.status_code == 201, resp.text
    assert resp.json()["tags_created"] == 1
    assert [tag["name"] for tag in (await client.get("/tags", headers=headers)).json()] == ["Food"]
    transactions = (await client.get("/transactions", headers=headers)).json()
    assert [[tag["name"] for tag in transaction["tags"]] for transaction in transactions] == [["Food"]]


@pytest.mark.parametrize(
    ("source", "build"),
    [("firefly", _firefly_payload), ("actual_budget", _actual_payload)],
)
async def test_a_tag_answered_with_a_corrected_name_is_created_under_it(client, source, build):
    """A name typed for a tag is the name it is created under, and the rows carry that tag."""
    headers = _get_auth_header(await _create_user(client))

    resp = await _import_run(
        client,
        headers,
        _with_tags(build([["trip"]]), [{"source": "trip", "create": {"name": "Holiday trip"}}]),
        source=source,
    )

    assert resp.status_code == 201, resp.text
    assert [tag["name"] for tag in (await client.get("/tags", headers=headers)).json()] == ["Holiday trip"]
    transactions = (await client.get("/transactions", headers=headers)).json()
    assert [[tag["name"] for tag in transaction["tags"]] for transaction in transactions] == [["Holiday trip"]]


@pytest.mark.parametrize(
    ("source", "build"),
    [("firefly", _firefly_payload), ("actual_budget", _actual_payload)],
)
async def test_a_tag_pointed_at_an_existing_tag_files_its_rows_under_it(client, source, build):
    """The value Trip is answered with the tag Holiday, so no tag is created and the rows carry Holiday."""
    headers = _get_auth_header(await _create_user(client))
    holiday = await _create_tag(client, headers, "Holiday")

    resp = await _import_run(
        client,
        headers,
        _with_tags(build([["Trip"]]), [{"source": "Trip", "tag_id": holiday["id"]}]),
        source=source,
    )

    assert resp.status_code == 201, resp.text
    assert resp.json()["tags_created"] == 0
    assert [tag["name"] for tag in (await client.get("/tags", headers=headers)).json()] == ["Holiday"]
    transactions = (await client.get("/transactions", headers=headers)).json()
    assert [[tag["id"] for tag in transaction["tags"]] for transaction in transactions] == [[holiday["id"]]]


@pytest.mark.parametrize(
    ("source", "build"),
    [("firefly", _firefly_payload), ("actual_budget", _actual_payload)],
)
async def test_a_tag_answer_for_a_tag_deleted_before_staging_is_refused_naming_the_value(client, source, build):
    """The refusal says which file value lost its tag, and nothing is written."""
    headers = _get_auth_header(await _create_user(client))
    holiday = await _create_tag(client, headers, "Holiday")
    assert (await client.delete(f"/tags/{holiday['id']}", headers=headers)).status_code == 204

    resp = await _import_run(
        client,
        headers,
        _with_tags(build([["Trip"]]), [{"source": "Trip", "tag_id": holiday["id"]}]),
        source=source,
    )

    assert resp.status_code == 422
    assert (
        resp.json()["detail"]
        == 'The tag chosen for "Trip" is no longer available, so go back to Tag matching and choose another tag or skip it'
    )
    assert (await client.get("/transactions", headers=headers)).json() == []


@pytest.mark.parametrize(
    ("source", "build"),
    [("firefly", _firefly_payload), ("actual_budget", _actual_payload)],
)
async def test_a_tag_answer_for_a_tag_deleted_before_the_commit_is_refused_and_writes_nothing(client, source, build):
    """The tag existed when the batch was staged, so the commit refuses it by value and the run stays unwritten."""
    headers = _get_auth_header(await _create_user(client))
    holiday = await _create_tag(client, headers, "Holiday")
    run_id = await _open_staged_run(
        client,
        headers,
        _with_tags(build([["Trip"]]), [{"source": "Trip", "tag_id": holiday["id"]}]),
        source,
    )
    assert (await client.delete(f"/tags/{holiday['id']}", headers=headers)).status_code == 204

    resp = await _commit_run(client, headers, run_id, source)

    assert resp.status_code == 422
    assert (
        resp.json()["detail"]
        == 'The tag chosen for "Trip" is no longer available, so go back to Tag matching and choose another tag or skip it'
    )
    # The account and category the same commit reaches before the tags are rolled back with it
    assert await _list_written_records(client, headers) == {"transactions": [], "accounts": [], "categories": [], "tags": []}


@pytest.mark.parametrize(
    ("source", "build"),
    [("firefly", _firefly_payload), ("actual_budget", _actual_payload)],
)
async def test_a_tag_answer_pointing_at_another_users_tag_is_refused_like_a_deleted_one(client, source, build):
    """Another user's tag is refused with the deleted tag's message, so it reveals nothing, and nothing is written."""
    headers = _get_auth_header(await _create_user(client))
    other_headers, _ = await _create_second_user(client)
    theirs = await _create_tag(client, other_headers, "Theirs")

    resp = await _import_run(
        client,
        headers,
        _with_tags(build([["Trip"]]), [{"source": "Trip", "tag_id": theirs["id"]}]),
        source=source,
    )

    assert resp.status_code == 422
    assert (
        resp.json()["detail"]
        == 'The tag chosen for "Trip" is no longer available, so go back to Tag matching and choose another tag or skip it'
    )
    assert await _list_written_records(client, headers) == {"transactions": [], "accounts": [], "categories": [], "tags": []}
    assert [tag["id"] for tag in (await client.get("/tags", headers=other_headers)).json()] == [theirs["id"]]
