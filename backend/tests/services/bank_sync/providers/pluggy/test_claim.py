"""Pluggy claim tests

Guards what the user is told when an application's keys and items can't be used: keys Pluggy rejects
are refused with where to check them, an item ID that isn't one or isn't in the application is
refused by name, and a Pluggy that can't be reached leaves the entry to be tried again. The client
secret is a secret, so it travels only in the sign-in body, and only the entry itself is stored
"""

import json

import httpx
import pytest

from app.services.bank_sync.providers.contract import ClaimRefused, ProviderUnreachable
from tests.services.bank_sync.providers.pluggy.stand_ins import (
    API_KEY,
    CLIENT_ID,
    CLIENT_SECRET,
    ITEM_ID,
    OTHER_ITEM_ID,
    PluggyApi,
    item,
    json_response,
    pluggy_adapter,
)
from tests.services.bank_sync.stand_ins import fail_with

_SUPPLIED = {"client_id": CLIENT_ID, "client_secret": CLIENT_SECRET, "item_ids": ITEM_ID}
_NOT_AN_ITEM = (
    '"{entry}" doesn\'t look like a Pluggy item ID. Please copy each whole item ID from your application at dashboard.pluggy.ai and try again'
)
_REJECTED = "Pluggy rejected these keys. Please check the client ID and client secret of your Pluggy application and try again"


def _api() -> PluggyApi:
    """Return Pluggy holding two items"""
    return PluggyApi().serve_sign_in().serve_item(item()).serve_item(item(OTHER_ITEM_ID), item_id=OTHER_ITEM_ID)


async def test_claim_signs_in_once_proves_every_item_and_stores_all_three_entries():
    """The secret goes in the sign-in body alone, the key in a header, and the item IDs are stored as a list in the order pasted"""
    api = _api()
    supplied = {**_SUPPLIED, "client_id": f"  {CLIENT_ID}\n", "item_ids": f" {OTHER_ITEM_ID.upper()}, {ITEM_ID}\n"}

    stored = await pluggy_adapter(api.transport).claim(supplied)

    assert json.loads(stored) == {"client_id": CLIENT_ID, "client_secret": CLIENT_SECRET, "item_ids": [OTHER_ITEM_ID, ITEM_ID]}
    assert sorted(api.paths()) == sorted(["/auth", f"/items/{ITEM_ID}", f"/items/{OTHER_ITEM_ID}"])
    sign_in = next(request for request in api.requests if request.url.path == "/auth")
    assert (sign_in.method, sign_in.headers["host"]) == ("POST", "api.pluggy.ai")
    assert json.loads(sign_in.content) == {"clientId": CLIENT_ID, "clientSecret": CLIENT_SECRET}
    for request in api.requests:
        assert CLIENT_SECRET not in str(request.url)
        assert API_KEY not in str(request.url)
        if request.url.path != "/auth":
            assert (request.method, request.headers["x-api-key"]) == ("GET", API_KEY)
            assert CLIENT_SECRET.encode() not in request.content


@pytest.mark.parametrize("status", [400, 401, 403])
async def test_claim_with_keys_pluggy_rejects_says_to_check_both(status):
    """A rejected client ID and secret is the user's to fix, so it is refused with where to look"""
    api = PluggyApi().serve("/auth", '{"code": 401, "message": "Invalid credentials"}', status)

    with pytest.raises(ClaimRefused) as refusal:
        await pluggy_adapter(api.transport).claim(_SUPPLIED)

    assert str(refusal.value) == _REJECTED
    assert CLIENT_SECRET not in str(refusal.value)
    assert api.paths() == ["/auth"]


async def test_claim_with_a_key_pluggy_rejects_on_an_item_says_to_check_both_keys():
    """A 403 on an item means the API key was refused, not that the item is missing, so no item is named"""
    api = _api().serve(f"/items/{OTHER_ITEM_ID}", '{"code": 403, "codeDescription": "API_KEY_MISSING_OR_INVALID"}', 403)

    with pytest.raises(ClaimRefused) as refusal:
        await pluggy_adapter(api.transport).claim({**_SUPPLIED, "item_ids": f"{ITEM_ID}, {OTHER_ITEM_ID}"})

    assert str(refusal.value) == _REJECTED


@pytest.mark.parametrize("status", [400, 404])
async def test_claim_with_an_item_pluggy_does_not_have_names_that_item(status):
    """An item ID from another application, one already deleted or one Pluggy refuses is named, the one that failed and no other"""
    api = _api().serve(f"/items/{OTHER_ITEM_ID}", '{"code": 404, "codeDescription": "ITEM_NOT_FOUND", "message": "item not found"}', status)

    with pytest.raises(ClaimRefused) as refusal:
        await pluggy_adapter(api.transport).claim({**_SUPPLIED, "item_ids": f"{ITEM_ID}, {OTHER_ITEM_ID}"})

    assert str(refusal.value) == (
        f'Pluggy doesn\'t have the item ID "{OTHER_ITEM_ID}" in this application. '
        "Please check it in your application at dashboard.pluggy.ai and try again"
    )


@pytest.mark.parametrize(
    ("supplied", "message"),
    [
        (
            {**_SUPPLIED, "client_id": "   "},
            "That doesn't look like a Pluggy client ID. Please copy the whole client ID from your Pluggy application and try again",
        ),
        (
            {**_SUPPLIED, "client_secret": "secret with spaces"},
            "That doesn't look like a Pluggy client secret. Please copy the whole client secret from your Pluggy application and try again",
        ),
        (
            {**_SUPPLIED, "client_secret": "k" * 129},
            "That doesn't look like a Pluggy client secret. Please copy the whole client secret from your Pluggy application and try again",
        ),
        (
            {**_SUPPLIED, "item_ids": "not-an-item"},
            _NOT_AN_ITEM.format(entry="not-an-item"),
        ),
        (
            {**_SUPPLIED, "item_ids": f"{ITEM_ID}; {OTHER_ITEM_ID}"},
            _NOT_AN_ITEM.format(entry=f"{ITEM_ID};"),
        ),
        (
            {**_SUPPLIED, "item_ids": f"{ITEM_ID[:-1]}"},
            _NOT_AN_ITEM.format(entry=ITEM_ID[:-1]),
        ),
        (
            {**_SUPPLIED, "item_ids": f"{ITEM_ID}, {OTHER_ITEM_ID},{ITEM_ID.upper()}"},
            f'The Pluggy item ID "{ITEM_ID.upper()}" is listed more than once. Please list each item ID once and try again',
        ),
        (
            {**_SUPPLIED, "item_ids": "x" * 80},
            _NOT_AN_ITEM.format(entry=f"{'x' * 40}…"),
        ),
    ],
    ids=["blank-id", "secret-spaces", "secret-too-long", "not-a-uuid", "semicolon", "truncated-uuid", "repeated", "long-entry-cut-in-echo"],
)
async def test_claim_with_an_entry_that_is_not_what_it_names_is_refused_before_anything_is_sent(supplied, message):
    """Nothing the user typed is dropped: an entry that can't be an ID, key or secret, or a repeated item, is refused by name"""
    api = _api()

    with pytest.raises(ClaimRefused) as refusal:
        await pluggy_adapter(api.transport).claim(supplied)

    assert str(refusal.value) == message
    assert api.requests == []


@pytest.mark.parametrize("separator", [",", ", ", " ", "\n", " ,\n"])
async def test_claim_takes_item_ids_separated_by_commas_spaces_or_lines(separator):
    """However the user pastes the list, every item is read"""
    api = _api()

    await pluggy_adapter(api.transport).claim({**_SUPPLIED, "item_ids": f"{ITEM_ID}{separator}{OTHER_ITEM_ID}"})

    assert {request.url.path for request in api.requests} == {"/auth", f"/items/{ITEM_ID}", f"/items/{OTHER_ITEM_ID}"}


@pytest.mark.parametrize(
    "respond",
    [
        json_response('{"message": "Unavailable"}', 503),
        json_response("{}", 429),
        httpx.Response(403, content=b"<html>Blocked</html>", headers={"Content-Type": "text/html"}),
        json_response("not json"),
        json_response('{"noKey": true}'),
        fail_with(httpx.ConnectError),
    ],
    ids=["503", "429", "edge-page-403", "unreadable", "no-key", "connection-failed"],
)
async def test_claim_without_a_usable_sign_in_leaves_the_entry_to_try_again(respond):
    """A busy Pluggy, an edge page or a lost connection says nothing about the keys, so they aren't refused"""
    api = PluggyApi().serve("/auth", respond)

    with pytest.raises(ProviderUnreachable) as unreachable:
        await pluggy_adapter(api.transport).claim(_SUPPLIED)

    assert str(unreachable.value) == "Lumina Finance couldn't reach Pluggy. Please try again in a few minutes"


async def test_claim_when_an_item_cannot_be_read_leaves_the_entry_to_try_again():
    """A failing item request that isn't a missing item says nothing about the entry"""
    api = _api().serve(f"/items/{ITEM_ID}", '{"message": "Down"}', 500)

    with pytest.raises(ProviderUnreachable):
        await pluggy_adapter(api.transport).claim(_SUPPLIED)


async def test_claim_for_a_host_resolving_privately_is_refused_without_a_request():
    """The outbound guard still applies, so Pluggy's name resolving to an internal address sends nothing"""
    api = _api()

    with pytest.raises(ProviderUnreachable):
        await pluggy_adapter(api.transport, "10.0.4.2").claim(_SUPPLIED)

    assert api.requests == []
