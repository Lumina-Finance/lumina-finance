"""Lunch Flow claim tests

Guards what the user is told when a key can't be used: a key Lunch Flow rejects is refused with the
way to make a new one, while a Lunch Flow that can't be reached leaves the key to be tried again.
The key is a secret, so it travels only in a header, and only the key itself is stored
"""

import httpx
import pytest

from app.services.bank_sync.providers.contract import ClaimRefused, ProviderUnreachable
from tests.services.bank_sync.providers.lunchflow.stand_ins import (
    API_KEY,
    LunchFlowApi,
    account,
    accounts_body,
    json_response,
    lunchflow_adapter,
)
from tests.services.bank_sync.stand_ins import fail_with

_REFUSED = "Lunch Flow rejected this API key. Please create a new key in your Lunch Flow API destination and try again"


async def test_claim_proves_the_key_with_one_accounts_request_and_stores_only_the_key():
    """The key is what is stored, sent in the x-api-key header of a single GET /accounts and nowhere else"""
    api = LunchFlowApi().serve("/accounts", accounts_body(account()))

    stored = await lunchflow_adapter(api.transport).claim({"api_key": f"  {API_KEY}\n"})

    assert stored == API_KEY
    [request] = api.requests
    assert (request.method, request.headers["host"], request.url.path, request.url.query) == (
        "GET",
        "www.lunchflow.app",
        "/api/v1/accounts",
        b"",
    )
    assert request.headers["x-api-key"] == API_KEY
    assert API_KEY not in str(request.url)


@pytest.mark.parametrize("status", [401, 403])
async def test_claim_with_a_key_lunch_flow_rejects_says_to_create_a_new_one(status):
    """A rejected key is the user's to replace, so it is refused with where to make another"""
    api = LunchFlowApi().serve("/accounts", '{"error": "Unauthorized", "message": "Invalid API key"}', status)

    with pytest.raises(ClaimRefused) as refusal:
        await lunchflow_adapter(api.transport).claim({"api_key": API_KEY})

    assert str(refusal.value) == _REFUSED
    assert API_KEY not in str(refusal.value)


@pytest.mark.parametrize(
    ("key", "message"),
    [
        ("   ", "Please paste the API key from Lunch Flow"),
        (
            "lf key with spaces",
            "That doesn't look like a Lunch Flow API key. Please copy the whole key from your Lunch Flow API destination and try again",
        ),
        (
            "lf_ké",
            "That doesn't look like a Lunch Flow API key. Please copy the whole key from your Lunch Flow API destination and try again",
        ),
        ("k" * 513, "That API key is too long. Please copy only the key from your Lunch Flow API destination and try again"),
    ],
    ids=["blank", "inner-spaces", "not-ascii", "too-long"],
)
async def test_claim_with_a_key_that_is_not_a_key_is_refused_before_anything_is_sent(key, message):
    """A key that can't be a header value is refused on the field, without a request"""
    api = LunchFlowApi()

    with pytest.raises(ClaimRefused) as refusal:
        await lunchflow_adapter(api.transport).claim({"api_key": key})

    assert str(refusal.value) == message
    assert api.requests == []


@pytest.mark.parametrize(
    "respond",
    [
        json_response('{"error": "Unavailable", "message": "Try later"}', 503),
        json_response("{}", 429),
        httpx.Response(403, content=b"<html>Blocked</html>", headers={"Content-Type": "text/html"}),
        json_response("not json"),
        fail_with(httpx.ConnectError),
    ],
    ids=["503", "429", "edge-page-403", "unreadable", "connection-failed"],
)
async def test_claim_without_a_usable_answer_leaves_the_key_to_try_again(respond):
    """A busy Lunch Flow, an edge page or a lost connection says nothing about the key, so it isn't refused"""
    api = LunchFlowApi().serve("/accounts", respond)

    with pytest.raises(ProviderUnreachable) as unreachable:
        await lunchflow_adapter(api.transport).claim({"api_key": API_KEY})

    assert str(unreachable.value) == "There was no answer from Lunch Flow. Please try again in a few minutes"


async def test_claim_for_a_host_resolving_privately_is_refused_without_a_request():
    """The outbound guard still applies, so Lunch Flow's name resolving to an internal address sends nothing"""
    api = LunchFlowApi().serve("/accounts", accounts_body(account()))

    with pytest.raises(ProviderUnreachable):
        await lunchflow_adapter(api.transport, "10.0.4.2").claim({"api_key": API_KEY})

    assert api.requests == []
