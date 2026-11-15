"""Akahu claim tests

Guards what the user is told when a pair of tokens can't be used: a pair Akahu rejects is refused
with where to check both, while an Akahu that can't be reached leaves the pair to be tried again.
The tokens are secrets, so they travel only in headers, and only the pair itself is stored
"""

import json

import httpx
import pytest

from app.services.bank_sync.providers.contract import ClaimRefused, ProviderUnreachable
from tests.services.bank_sync.providers.akahu.stand_ins import (
    APP_ID_TOKEN,
    USER_ACCESS_TOKEN,
    AkahuApi,
    akahu_adapter,
    json_response,
)
from tests.services.bank_sync.stand_ins import fail_with

_SUPPLIED = {"app_id_token": APP_ID_TOKEN, "user_access_token": USER_ACCESS_TOKEN}
_REFUSED = "Akahu rejected these tokens. Please check both the app ID token and the user access token in your Akahu personal app and try again"


async def test_claim_proves_the_pair_with_one_me_request_and_stores_both_tokens():
    """Both tokens are what is stored, sent in headers of a single GET /me and nowhere else"""
    api = AkahuApi().serve_me()

    stored = await akahu_adapter(api.transport).claim({"app_id_token": f"  {APP_ID_TOKEN}\n", "user_access_token": USER_ACCESS_TOKEN})

    assert json.loads(stored) == _SUPPLIED
    [request] = api.requests
    assert (request.method, request.headers["host"], request.url.path, request.url.query) == ("GET", "api.akahu.io", "/v1/me", b"")
    assert request.headers["authorization"] == f"Bearer {USER_ACCESS_TOKEN}"
    assert request.headers["x-akahu-id"] == APP_ID_TOKEN
    assert APP_ID_TOKEN not in str(request.url)
    assert USER_ACCESS_TOKEN not in str(request.url)


@pytest.mark.parametrize("status", [401, 403])
async def test_claim_with_tokens_akahu_rejects_says_to_check_both(status):
    """A rejected pair is the user's to fix, so it is refused with where to look"""
    api = AkahuApi().serve("/me", '{"success": false, "message": "Invalid token"}', status)

    with pytest.raises(ClaimRefused) as refusal:
        await akahu_adapter(api.transport).claim(_SUPPLIED)

    assert str(refusal.value) == _REFUSED
    assert APP_ID_TOKEN not in str(refusal.value)
    assert USER_ACCESS_TOKEN not in str(refusal.value)


@pytest.mark.parametrize(
    ("supplied", "message"),
    [
        (
            {**_SUPPLIED, "app_id_token": "   "},
            "That doesn't look like an Akahu app ID token. Please copy the whole token from your Akahu personal app and try again",
        ),
        (
            {**_SUPPLIED, "user_access_token": "user token with spaces"},
            "That doesn't look like an Akahu user access token. Please copy the whole token from your Akahu personal app and try again",
        ),
        (
            {**_SUPPLIED, "user_access_token": "user_ké"},
            "That doesn't look like an Akahu user access token. Please copy the whole token from your Akahu personal app and try again",
        ),
        (
            {**_SUPPLIED, "app_id_token": "k" * 513},
            "That doesn't look like an Akahu app ID token. Please copy the whole token from your Akahu personal app and try again",
        ),
    ],
    ids=["blank", "inner-spaces", "not-ascii", "too-long"],
)
async def test_claim_with_a_token_that_is_not_a_token_is_refused_before_anything_is_sent(supplied, message):
    """A token that can't be a header value is refused, without a request"""
    api = AkahuApi().serve_me()

    with pytest.raises(ClaimRefused) as refusal:
        await akahu_adapter(api.transport).claim(supplied)

    assert str(refusal.value) == message
    assert api.requests == []


@pytest.mark.parametrize(
    "respond",
    [
        json_response('{"success": false, "message": "Unavailable"}', 503),
        json_response("{}", 429),
        httpx.Response(403, content=b"<html>Blocked</html>", headers={"Content-Type": "text/html"}),
        json_response("not json"),
        json_response('{"success": false}'),
        fail_with(httpx.ConnectError),
    ],
    ids=["503", "429", "edge-page-403", "unreadable", "unsuccessful", "connection-failed"],
)
async def test_claim_without_a_usable_answer_leaves_the_pair_to_try_again(respond):
    """A busy Akahu, an edge page or a lost connection says nothing about the tokens, so they aren't refused"""
    api = AkahuApi().serve("/me", respond)

    with pytest.raises(ProviderUnreachable) as unreachable:
        await akahu_adapter(api.transport).claim(_SUPPLIED)

    assert str(unreachable.value) == "Lumina Finance couldn't reach Akahu. Please try again in a few minutes"


async def test_claim_for_a_host_resolving_privately_is_refused_without_a_request():
    """The outbound guard still applies, so Akahu's name resolving to an internal address sends nothing"""
    api = AkahuApi().serve_me()

    with pytest.raises(ProviderUnreachable):
        await akahu_adapter(api.transport, "10.0.4.2").claim(_SUPPLIED)

    assert api.requests == []
