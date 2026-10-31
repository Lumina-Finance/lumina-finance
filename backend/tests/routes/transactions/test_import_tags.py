"""Tags an import carries are matched to the user's own tags ignoring capitals, and created once per name"""

from tests.routes.transactions._helpers import _create_tag, _setup_user_with_deps
from tests.routes.transactions._import_helpers import _import_rows


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
