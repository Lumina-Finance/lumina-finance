"""Tags an import carries are matched to the user's own tags ignoring capitals, and created once per name"""

import uuid

import pytest
from sqlalchemy import select

from app.models.import_run import ImportRun
from tests.conftest import TestSession
from tests.routes.transactions._helpers import _create_tag, _setup_user_with_deps
from tests.routes.transactions._import_helpers import _import_rows, _open_run, _stage_batch


async def _list_tag_names(client, headers):
    """Return the names of the user's own tags"""
    return sorted(tag["name"] for tag in (await client.get("/tags", headers=headers)).json())


async def test_an_imported_tag_differing_only_in_capitals_is_filed_under_the_existing_tag(client):
    """Travel in the file is the user's travel, not a second tag beside it."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    existing = (await _create_tag(client, headers, name="Travel")).json()

    resp = await _import_rows(client, headers, account_id, category_id, [{"tag_names": ["travel"]}])

    assert resp.status_code == 201
    assert resp.json()["tags_created"] == 0
    assert resp.json()["tags_reused"] == 1
    assert resp.json()["created_tag_ids"] == []
    assert await _list_tag_names(client, headers) == ["Travel"]
    transaction = (await client.get("/transactions", headers=headers)).json()[0]
    assert [tag["id"] for tag in transaction["tags"]] == [existing["id"]]


async def test_two_spellings_of_one_tag_in_a_file_make_one_tag(client):
    """A file carrying both spellings creates one tag, under the spelling it uses first."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    resp = await _import_rows(
        client,
        headers,
        account_id,
        category_id,
        [{"tag_names": ["Travel"]}, {"tag_names": ["TRAVEL"], "amount": "-2.00"}],
    )

    assert resp.status_code == 201
    assert resp.json()["tags_created"] == 1
    assert await _list_tag_names(client, headers) == ["Travel"]
    transactions = (await client.get("/transactions", headers=headers)).json()
    assert {tag["id"] for transaction in transactions for tag in transaction["tags"]} == set(resp.json()["created_tag_ids"])


async def test_a_row_naming_one_tag_in_two_spellings_carries_it_once(client):
    """Two spellings on one row are one tag, so the row is tagged once rather than failing on the pair."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    resp = await _import_rows(client, headers, account_id, category_id, [{"tag_names": ["Travel", "travel", "Food"]}])

    assert resp.status_code == 201
    assert resp.json()["tags_created"] == 2
    transaction = (await client.get("/transactions", headers=headers)).json()[0]
    assert sorted(tag["name"] for tag in transaction["tags"]) == ["Food", "Travel"]


async def test_an_imported_tag_does_not_match_another_users_tag(client):
    """Only the importing user's own tags are matched, whatever another user has named theirs."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    other_headers, _, _ = await _setup_user_with_deps(client, email="other-importer@example.com", name_prefix="Other")
    other_tag = (await _create_tag(client, other_headers, name="travel")).json()

    resp = await _import_rows(client, headers, account_id, category_id, [{"tag_names": ["Travel"]}])

    assert resp.status_code == 201
    assert resp.json()["tags_created"] == 1
    assert resp.json()["created_tag_ids"] != [other_tag["id"]]
    assert await _list_tag_names(client, headers) == ["Travel"]


async def test_an_imported_tag_does_not_match_a_group_tag(client):
    """A group's tag is not the user's own, so the import writes a personal one beside it."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    group_id = (await client.post("/groups", json={"name": "Household"}, headers=headers)).json()["id"]
    group_tag = (await _create_tag(client, headers, name="Travel", group_id=group_id)).json()

    resp = await _import_rows(client, headers, account_id, category_id, [{"tag_names": ["travel"]}])

    assert resp.status_code == 201
    assert resp.json()["tags_created"] == 1
    assert resp.json()["created_tag_ids"] != [group_tag["id"]]
    transaction = (await client.get("/transactions", headers=headers)).json()[0]
    assert [(tag["name"], tag["group_id"]) for tag in transaction["tags"]] == [("travel", None)]


async def _tag_names_on_transactions(client, headers):
    """Return each transaction's tag names, oldest amount first"""
    transactions = (await client.get("/transactions", headers=headers, params={"sort_by": "dt", "sort_order": "asc"})).json()
    return [sorted(tag["name"] for tag in transaction["tags"]) for transaction in transactions]


async def test_a_tag_name_pointed_at_an_existing_tag_files_its_rows_under_it(client):
    """Answering a file's tag name with a tag of the user's own creates nothing and uses that tag."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    chosen = (await _create_tag(client, headers, name="Holiday")).json()

    resp = await _import_rows(
        client,
        headers,
        account_id,
        category_id,
        [{"tag_names": ["Trip"]}],
        tags=[{"source": "Trip", "tag_id": chosen["id"]}],
    )

    assert resp.status_code == 201
    assert resp.json()["tags_created"] == 0
    assert await _list_tag_names(client, headers) == ["Holiday"]
    assert await _tag_names_on_transactions(client, headers) == [["Holiday"]]


async def test_a_tag_name_corrected_is_created_under_the_name_given(client):
    """The corrected spelling is what is written, and every row carrying the file's spelling gets it."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    resp = await _import_rows(
        client,
        headers,
        account_id,
        category_id,
        [{"tag_names": ["trvl"]}, {"tag_names": ["TRVL"], "amount": "-2.00"}],
        tags=[{"source": "trvl", "create": {"name": "Travel"}}],
    )

    assert resp.status_code == 201
    assert resp.json()["tags_created"] == 1
    assert await _list_tag_names(client, headers) == ["Travel"]
    assert await _tag_names_on_transactions(client, headers) == [["Travel"], ["Travel"]]


async def test_two_tag_names_corrected_to_one_name_make_one_tag(client):
    """Corrections landing on one name, capitals aside, share the tag rather than clashing on it."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    resp = await _import_rows(
        client,
        headers,
        account_id,
        category_id,
        [{"tag_names": ["trvl"]}, {"tag_names": ["trip"], "amount": "-2.00"}],
        tags=[{"source": "trvl", "create": {"name": "Travel"}}, {"source": "trip", "create": {"name": "TRAVEL"}}],
    )

    assert resp.status_code == 201
    assert resp.json()["tags_created"] == 1
    assert await _list_tag_names(client, headers) == ["Travel"]
    assert await _tag_names_on_transactions(client, headers) == [["Travel"], ["Travel"]]


async def test_a_tag_name_corrected_to_an_existing_tag_reuses_it(client):
    """A correction that spells a tag the user has, in other capitals, is that tag."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    await _create_tag(client, headers, name="Travel")

    resp = await _import_rows(
        client,
        headers,
        account_id,
        category_id,
        [{"tag_names": ["trvl"]}],
        tags=[{"source": "trvl", "create": {"name": "TRAVEL"}}],
    )

    assert resp.status_code == 201
    assert resp.json()["tags_created"] == 0
    assert await _list_tag_names(client, headers) == ["Travel"]
    assert await _tag_names_on_transactions(client, headers) == [["Travel"]]


async def test_a_skipped_tag_name_leaves_its_rows_without_that_tag_only(client):
    """Skipping drops the one tag from each row and creates nothing, while the row's other tags stay."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    resp = await _import_rows(
        client,
        headers,
        account_id,
        category_id,
        [{"tag_names": ["Junk", "Food"]}],
        tags=[{"source": "JUNK", "skip": True}],
    )

    assert resp.status_code == 201
    assert resp.json()["tags_created"] == 1
    assert await _list_tag_names(client, headers) == ["Food"]
    assert await _tag_names_on_transactions(client, headers) == [["Food"]]


async def test_a_tag_name_answered_in_other_capitals_still_answers_its_rows(client):
    """The answer is found by the name with capitals folded, as the rows' names are."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    chosen = (await _create_tag(client, headers, name="Holiday")).json()

    resp = await _import_rows(
        client,
        headers,
        account_id,
        category_id,
        [{"tag_names": ["TRIP"]}],
        tags=[{"source": "trip", "tag_id": chosen["id"]}],
    )

    assert resp.status_code == 201
    assert await _tag_names_on_transactions(client, headers) == [["Holiday"]]


async def test_a_tag_name_left_unanswered_keeps_matching_and_creating_by_name(client):
    """Answering one name changes nothing for the others in the file."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    await _create_tag(client, headers, name="Food")

    resp = await _import_rows(
        client,
        headers,
        account_id,
        category_id,
        [{"tag_names": ["food", "Trip", "Fun"]}],
        tags=[{"source": "Fun", "skip": True}],
    )

    assert resp.status_code == 201
    assert resp.json()["tags_created"] == 1
    assert await _list_tag_names(client, headers) == ["Food", "Trip"]


async def test_an_answer_pointing_at_another_users_tag_is_refused_and_writes_nothing(client):
    """A tag the user does not own is refused as the batch is staged, so no transaction or tag is written."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    other_headers, _, _ = await _setup_user_with_deps(client, email="other-answer@example.com", name_prefix="Other")
    other_tag = (await _create_tag(client, other_headers, name="Theirs")).json()

    resp = await _import_rows(
        client,
        headers,
        account_id,
        category_id,
        [{"tag_names": ["Trip"]}],
        tags=[{"source": "Trip", "tag_id": other_tag["id"]}],
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Tag not found"
    assert await _list_tag_names(client, headers) == []
    assert (await client.get("/transactions", headers=headers)).json() == []


async def test_an_answer_pointing_at_a_group_tag_is_refused(client):
    """A group's tag is not one an import files rows under, even for its own member."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    group_id = (await client.post("/groups", json={"name": "Household"}, headers=headers)).json()["id"]
    group_tag = (await _create_tag(client, headers, name="Shared", group_id=group_id)).json()

    resp = await _import_rows(
        client,
        headers,
        account_id,
        category_id,
        [{"tag_names": ["Trip"]}],
        tags=[{"source": "Trip", "tag_id": group_tag["id"]}],
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Tag not found"


@pytest.mark.parametrize(
    "answer",
    [
        {"source": "Trip"},
        {"source": "Trip", "skip": True, "create": {"name": "Travel"}},
        {"source": "Trip", "skip": True, "tag_id": "11111111-1111-1111-1111-111111111111"},
    ],
    ids=["no action", "skip and create", "skip and a tag"],
)
async def test_an_answer_stating_other_than_one_action_is_refused(client, answer):
    """Exactly one of a tag, a new name or skip must be stated for a tag name."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    resp = await _import_rows(client, headers, account_id, category_id, [{"tag_names": ["Trip"]}], tags=[answer])

    assert resp.status_code == 422
    assert resp.json()["detail"] == "The tag source Trip must map to exactly one tag action"
    assert await _list_tag_names(client, headers) == []


async def test_a_tag_name_declared_twice_with_different_answers_is_refused_across_batches(client):
    """Two spellings of one name are one answer, so a second batch cannot say something else."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    run_id = await _open_run(client, headers, 2)
    row = {"account_source": "Main Chequing", "category_source": "Groceries", "dt": "2026-04-10", "amount": "-1.00", "tag_names": ["Trip"]}
    batch = {
        "start_row_index": 0,
        "accounts": [{"source": "Main Chequing", "account_id": account_id}],
        "categories": [{"source": "Groceries", "category_id": category_id}],
        "tags": [{"source": "Trip", "skip": True}],
        "rows": [row],
    }
    assert (await _stage_batch(client, headers, run_id, batch)).status_code == 204

    second = {**batch, "start_row_index": 1, "tags": [{"source": "TRIP", "create": {"name": "Travel"}}]}
    resp = await _stage_batch(client, headers, run_id, second)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "The tag source TRIP is declared twice with different answers"


async def test_staging_a_tag_answer_keeps_it_on_the_run_and_a_replay_is_accepted(client):
    """The answer is held by the name's key, so the same answer sent again is not a second one."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    run_id = await _open_run(client, headers, 1)
    row = {"account_source": "Main Chequing", "category_source": "Groceries", "dt": "2026-04-10", "amount": "-1.00", "tag_names": ["Trip"]}
    batch = {
        "start_row_index": 0,
        "accounts": [{"source": "Main Chequing", "account_id": account_id}],
        "categories": [{"source": "Groceries", "category_id": category_id}],
        "tags": [{"source": "Trip", "skip": True}],
        "rows": [row],
    }

    assert (await _stage_batch(client, headers, run_id, batch)).status_code == 204
    assert (await _stage_batch(client, headers, run_id, batch)).status_code == 204
    async with TestSession() as session:
        run = (await session.execute(select(ImportRun).where(ImportRun.id == uuid.UUID(run_id)))).scalar_one()

    assert run.tag_mappings == {"trip": {"source": "Trip", "tag_id": None, "create": None, "skip": True}}


@pytest.mark.parametrize("name", ["", "   ", "t" * 65], ids=["blank", "spaces", "too long"])
async def test_a_corrected_tag_name_that_is_blank_or_too_long_is_refused_and_writes_nothing(client, name):
    """The name a tag is created under is held to what a tag can be named, before anything is staged."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    resp = await _import_rows(
        client,
        headers,
        account_id,
        category_id,
        [{"tag_names": ["Trip"]}],
        tags=[{"source": "Trip", "create": {"name": name}}],
    )

    assert resp.status_code == 422
    assert resp.json()["detail"][0]["loc"][-2:] == ["create", "name"]
    assert await _list_tag_names(client, headers) == []
    assert (await client.get("/transactions", headers=headers)).json() == []


async def test_a_corrected_tag_name_of_the_longest_length_a_tag_can_have_is_accepted(client):
    """The limit is on characters over 64, so a name of exactly 64 is created."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    name = "t" * 64

    resp = await _import_rows(
        client,
        headers,
        account_id,
        category_id,
        [{"tag_names": ["Trip"]}],
        tags=[{"source": "Trip", "create": {"name": name}}],
    )

    assert resp.status_code == 201
    assert await _list_tag_names(client, headers) == [name]
