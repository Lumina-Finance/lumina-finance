"""GET /import-rules"""

from app.utils.pagination import LIST_PAGE_SIZE, LIST_SEARCH_MAX_LENGTH, MAX_LIST_OFFSET
from tests.routes.support import (
    _account_is,
    _amount_at_least,
    _create_account,
    _create_rule_ok,
    _create_second_user,
    _create_user,
    _description_contains,
    _direction_is,
    _get_auth_header,
    _group_of,
    _make_category,
    _make_merchant,
    _make_tag,
)
from tests.routes.support.query_helpers import _get_with_selects


async def _signed_in(client) -> dict:
    """Sign the default user up and return their auth headers"""
    return _get_auth_header(await _create_user(client))


async def _names(client, headers, path: str = "/import-rules") -> list[str]:
    """Return the names of the rules a listing returns, in the order it returns them"""
    response = await client.get(path, headers=headers)
    assert response.status_code == 200, response.text
    return [rule["name"] for rule in response.json()]


async def test_the_list_holds_only_the_users_own_rules_in_the_order_they_are_checked(client):
    """Rules read by position, not by name or age, and another user's never show"""
    headers = await _signed_in(client)
    tag_id = await _make_tag(client, headers)
    for name in ("Zeta", "Alpha", "Mid"):
        await _create_rule_ok(client, headers, name=name, tag_ids=[tag_id])
    other_headers = _get_auth_header(await _create_second_user(client))
    await _create_rule_ok(client, other_headers, name="Theirs", tag_ids=[await _make_tag(client, other_headers)])

    assert await _names(client, headers) == ["Zeta", "Alpha", "Mid"]
    assert await _names(client, other_headers) == ["Theirs"]


async def test_a_rule_that_names_a_deleted_account_says_so_and_one_that_names_an_archived_account_does_not(client):
    """A condition on a deleted account never matches, so the list tells the row to say so, while an archived account still exists"""
    headers = await _signed_in(client)
    kept = (await _create_account(client, headers, name="Kept")).json()["id"]
    archived = (await _create_account(client, headers, name="Archived")).json()["id"]
    gone = (await _create_account(client, headers, name="Gone")).json()["id"]
    await _create_rule_ok(
        client,
        headers,
        tag_ids=[await _make_tag(client, headers)],
        conditions=[_account_is(kept), _group_of("any", _account_is(archived), _account_is(gone, "is_not"))],
    )
    assert (await client.patch(f"/accounts/{archived}", json={"is_archived": True}, headers=headers)).status_code == 200
    assert (await client.delete(f"/accounts/{gone}", headers=headers)).status_code == 204

    [rule] = (await client.get("/import-rules", headers=headers)).json()

    states = [rule["conditions"][0], *rule["conditions"][1]["conditions"]]
    assert [(c["account_state"], c["account_name"]) for c in states] == [("exists", "Kept"), ("exists", "Archived"), ("deleted", None)]
    assert states[2]["value"] == gone, "the condition keeps the account it names, so it can be shown and replaced"


async def test_a_page_is_fifty_rules_and_the_next_starts_where_it_ended(client):
    """The list never returns every rule at once, and a limit and offset page through it in order"""
    headers = await _signed_in(client)
    tag_id = await _make_tag(client, headers)
    for number in range(LIST_PAGE_SIZE + 2):
        await _create_rule_ok(client, headers, name=f"Rule {number:03d}", tag_ids=[tag_id])

    first_page = await _names(client, headers)
    rest = await _names(client, headers, f"/import-rules?offset={LIST_PAGE_SIZE}")
    middle = await _names(client, headers, "/import-rules?limit=2&offset=1")

    assert first_page == [f"Rule {number:03d}" for number in range(LIST_PAGE_SIZE)]
    assert rest == ["Rule 050", "Rule 051"]
    assert middle == ["Rule 001", "Rule 002"]


async def test_paging_bounds_are_inclusive_and_anything_past_them_is_refused(client):
    """A limit or offset past what the list allows is a 422, and the largest allowed is answered"""
    headers = await _signed_in(client)

    for url in (
        "/import-rules?limit=0",
        f"/import-rules?limit={LIST_PAGE_SIZE + 1}",
        "/import-rules?offset=-1",
        f"/import-rules?offset={MAX_LIST_OFFSET + 1}",
    ):
        assert (await client.get(url, headers=headers)).status_code == 422, url
    for url in (f"/import-rules?limit={LIST_PAGE_SIZE}", f"/import-rules?offset={MAX_LIST_OFFSET}"):
        assert (await client.get(url, headers=headers)).status_code == 200, url


async def test_listing_without_auth_returns_401(client):
    """Rules are a signed-in user's"""
    assert (await client.get("/import-rules")).status_code == 401


async def _create_full_rule(client, headers, name: str, account_id: str, **names) -> dict:
    """Create a rule that names a merchant, a category, two tags and an account, so every name must be looked up

    It holds two conditions, so a full page of them is the 100 conditions a person's rules may hold in all
    """
    return await _create_rule_ok(
        client,
        headers,
        name=name,
        conditions=[_amount_at_least("5"), _account_is(account_id)],
        merchant_id=names["merchant"],
        category_id=names["category"],
        tag_ids=names["tags"],
    )


async def test_a_page_of_rules_costs_the_statements_one_rule_does(client):
    """The names rows show are read in a fixed number of statements, however many rules the page holds, with another user's rules beside"""
    headers = await _signed_in(client)
    account_id = (await _create_account(client, headers, name="Chequing")).json()["id"]
    names = {
        "merchant": await _make_merchant(client, headers),
        "category": await _make_category(client, headers),
        "tags": [await _make_tag(client, headers, "One"), await _make_tag(client, headers, "Two")],
    }
    other_headers = _get_auth_header(await _create_second_user(client))
    other_account_id = (await _create_account(client, other_headers, name="Theirs")).json()["id"]
    other_names = {
        "merchant": await _make_merchant(client, other_headers),
        "category": await _make_category(client, other_headers),
        "tags": [await _make_tag(client, other_headers, "One"), await _make_tag(client, other_headers, "Two")],
    }
    await _create_full_rule(client, other_headers, "Theirs", other_account_id, **other_names)

    await _create_full_rule(client, headers, "Rule 000", account_id, **names)
    _, for_one = await _get_with_selects(client, "/import-rules", headers)
    for number in range(1, LIST_PAGE_SIZE):
        await _create_full_rule(client, headers, f"Rule {number:03d}", account_id, **names)
    page, for_a_page = await _get_with_selects(client, "/import-rules", headers)

    assert len(page) == LIST_PAGE_SIZE
    assert len(for_a_page) == len(for_one), "\n".join(for_a_page)


async def _search(client, headers, text: str, extra: str = "") -> list[str]:
    """Return the names of the rules a search finds, in the order the listing returns them"""
    return await _names(client, headers, f"/import-rules?q={text}{extra}")


async def test_a_search_finds_a_rule_by_its_name_whatever_the_case(client):
    """The text is looked for in the rule's name, ignoring case, and a rule that lacks it is left out"""
    headers = await _signed_in(client)
    tag_id = await _make_tag(client, headers)
    for name in ("Fuel stop", "Weekly GROCERIES", "Streaming"):
        await _create_rule_ok(client, headers, name=name, tag_ids=[tag_id])

    assert await _search(client, headers, "groceries") == ["Weekly GROCERIES"]
    assert await _search(client, headers, "FUEL") == ["Fuel stop"]
    assert await _search(client, headers, "nothing") == []


async def test_a_search_finds_the_text_a_description_or_note_condition_looks_for_inside_groups_too(client):
    """The values of Description and Note conditions match, at the top and inside a group, ignoring case"""
    headers = await _signed_in(client)
    tag_id = await _make_tag(client, headers)
    note = {"kind": "condition", "attribute": "note", "operator": "contains", "value": "Reimburse me"}
    await _create_rule_ok(client, headers, name="One", tag_ids=[tag_id], conditions=[_description_contains("SHELL")])
    await _create_rule_ok(client, headers, name="Two", tag_ids=[tag_id], conditions=[_direction_is("out"), _group_of("any", note)])
    await _create_rule_ok(client, headers, name="Three", tag_ids=[tag_id], conditions=[_description_contains("other")])

    assert await _search(client, headers, "shell") == ["One"]
    assert await _search(client, headers, "REIMBURSE") == ["Two"]


async def test_a_search_finds_the_merchant_category_and_tags_a_rule_sets(client):
    """The names of what a rule sets match, and a rule that sets none of them does not"""
    headers = await _signed_in(client)
    merchant_id = await _make_merchant(client, headers, "Corner Market")
    category_id = await _make_category(client, headers, "Pet supplies")
    holiday = await _make_tag(client, headers, "Holiday")
    shared = await _make_tag(client, headers, "Shared")
    await _create_rule_ok(client, headers, name="A", merchant_id=merchant_id)
    await _create_rule_ok(client, headers, name="B", category_id=category_id)
    await _create_rule_ok(client, headers, name="C", tag_ids=[holiday, shared])
    await _create_rule_ok(client, headers, name="D", tag_ids=[await _make_tag(client, headers, "Other")])

    assert await _search(client, headers, "corner") == ["A"]
    assert await _search(client, headers, "PET%20SUP") == ["B"]
    assert await _search(client, headers, "SHARED") == ["C"]


async def test_a_search_never_matches_an_operator_an_attribute_an_amount_or_an_account(client):
    """Only text the person typed or a name they chose matches: the words the row builds its sentence from do not"""
    headers = await _signed_in(client)
    account_id = (await _create_account(client, headers, name="Chequing")).json()["id"]
    tag_id = await _make_tag(client, headers)
    await _create_rule_ok(
        client,
        headers,
        name="Plain",
        tag_ids=[tag_id],
        conditions=[_description_contains("shell"), _amount_at_least("1234.50"), _direction_is("out"), _account_is(account_id)],
    )

    for text in ("contains", "description", "amount", "at_least", "least", "1234", "direction", "out", "account", "Chequing", account_id):
        assert await _search(client, headers, text) == [], text


async def test_a_search_keeps_the_order_and_pages_through_what_it_found(client):
    """Matches come in the order the rules are checked, and a limit and offset page through them, not through every rule"""
    headers = await _signed_in(client)
    tag_id = await _make_tag(client, headers)
    for name in ("Fuel 1", "Other", "Fuel 2", "Fuel 3", "Another", "Fuel 4"):
        await _create_rule_ok(client, headers, name=name, tag_ids=[tag_id])

    assert await _search(client, headers, "fuel") == ["Fuel 1", "Fuel 2", "Fuel 3", "Fuel 4"]
    assert await _search(client, headers, "fuel", "&limit=2") == ["Fuel 1", "Fuel 2"]
    assert await _search(client, headers, "fuel", "&limit=2&offset=2") == ["Fuel 3", "Fuel 4"]
    assert await _search(client, headers, "fuel", "&limit=2&offset=4") == []


async def test_a_search_treats_wildcards_as_text_and_ignores_blank_text(client):
    """A percent sign or an underscore matches only itself, and a search of spaces lists every rule"""
    headers = await _signed_in(client)
    tag_id = await _make_tag(client, headers)
    await _create_rule_ok(client, headers, name="Half off 50% today", tag_ids=[tag_id])
    await _create_rule_ok(client, headers, name="Plain", tag_ids=[tag_id])

    assert await _search(client, headers, "%25") == ["Half off 50% today"]
    assert await _search(client, headers, "_") == []
    assert await _search(client, headers, "%20%20") == ["Half off 50% today", "Plain"]


async def test_a_search_never_returns_another_users_rule(client):
    """Another person's rules are neither listed nor matched, by name or by what they set"""
    headers = await _signed_in(client)
    other_headers = _get_auth_header(await _create_second_user(client))
    other_merchant = await _make_merchant(client, other_headers, "Corner Market")
    await _create_rule_ok(client, other_headers, name="Theirs", merchant_id=other_merchant, conditions=[_description_contains("shell")])
    await _create_rule_ok(client, headers, name="Mine", tag_ids=[await _make_tag(client, headers)])

    for text in ("theirs", "shell", "corner"):
        assert await _search(client, headers, text) == [], text
    assert await _search(client, other_headers, "shell") == ["Theirs"]


async def test_a_search_of_the_most_text_allowed_is_answered_and_one_more_is_refused(client):
    """The text is bounded as the merchants search is"""
    headers = await _signed_in(client)

    assert (await client.get("/import-rules", params={"q": "x" * LIST_SEARCH_MAX_LENGTH}, headers=headers)).status_code == 200
    assert (await client.get("/import-rules", params={"q": "x" * (LIST_SEARCH_MAX_LENGTH + 1)}, headers=headers)).status_code == 422
