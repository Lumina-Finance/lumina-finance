"""POST /tags/name-matches, which tells the import page which of a file's tag names already have a tag"""

import pytest

from tests.routes.support import _create_user, _get_auth_header
from tests.routes.tags._helpers import _create_group, _create_second_user, _create_tag


async def test_name_matches_answers_each_value_with_the_tag_ignoring_capitals(client):
    """A file's name is matched to the user's tag whatever its capitals, and is answered as it was asked."""
    headers = _get_auth_header(await _create_user(client))
    created = (await _create_tag(client, headers, name="Travel")).json()

    resp = await client.post("/tags/name-matches", json={"names": ["  TRAVEL ", "food"]}, headers=headers)

    assert resp.status_code == 200

    # The value comes back as it was asked about, and one with no tag is left out
    assert resp.json() == [{"source": "TRAVEL", "tag": created}]


async def test_name_matches_answers_a_value_the_database_lowercases_like_a_tag(client):
    """Matched by PostgreSQL's lowercase, as the import is, where Python's differs for the dotted capital I."""
    headers = _get_auth_header(await _create_user(client))
    created = (await _create_tag(client, headers, name="ISTANBUL")).json()

    resp = await client.post("/tags/name-matches", json={"names": ["İstanbul"]}, headers=headers)

    assert resp.status_code == 200
    assert resp.json() == [{"source": "İstanbul", "tag": created}]


async def test_name_matches_leaves_out_another_users_tag(client):
    """One user's tags are not something another user's import can be told about."""
    headers = _get_auth_header(await _create_user(client))
    other_headers = _get_auth_header(await _create_second_user(client))
    await _create_tag(client, other_headers, name="Theirs")

    resp = await client.post("/tags/name-matches", json={"names": ["Theirs"]}, headers=headers)

    assert resp.status_code == 200
    assert resp.json() == []


async def test_name_matches_leaves_out_a_group_tag(client):
    """A group's tag is never what an import files rows under, so it is not offered as a match."""
    headers = _get_auth_header(await _create_user(client))
    group_id = await _create_group(client, headers)
    await _create_tag(client, headers, name="Shared", group_id=group_id)

    resp = await client.post("/tags/name-matches", json={"names": ["shared"]}, headers=headers)

    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.parametrize(
    "names",
    [[], ["x" * 65], ["x" * 257], ["x" * 100_000], [""], ["   "], [f"tag {index}" for index in range(1001)]],
    ids=["none", "65 characters", "257 characters", "100,000 characters", "blank", "spaces", "over 1,000 names"],
)
async def test_name_matches_refuses_names_outside_its_limits(client, names):
    """One to 1,000 names of one to 64 characters each are asked about, and nothing else is."""
    headers = _get_auth_header(await _create_user(client))

    resp = await client.post("/tags/name-matches", json={"names": names}, headers=headers)

    assert resp.status_code == 422


async def test_name_matches_takes_the_most_names_and_the_longest_name_allowed(client):
    """The limits are inclusive at both ends."""
    headers = _get_auth_header(await _create_user(client))
    names = ["x" * 64] + [f"tag {index}" for index in range(999)]

    resp = await client.post("/tags/name-matches", json={"names": names}, headers=headers)

    assert resp.status_code == 200


async def test_name_matches_without_auth_returns_401(client):
    """POST /tags/name-matches without an Authorization header returns 401."""
    resp = await client.post("/tags/name-matches", json={"names": ["Travel"]})
    assert resp.status_code == 401
