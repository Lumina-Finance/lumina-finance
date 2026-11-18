"""Pluggy failures on the requests of a sync

Guards which failures of a read end the whole request, as a rejected key does, and which stay with the
one account, as a 500 does, that a request that has ended stops the reads not yet sent, since the key or
the quota they would use has just been refused, and that a server the environment doesn't allow is told
by its host and sent nothing
"""

import httpx
import pytest

from app.http_client import ResponseTooLargeError
from app.models.bank_sync_job import ProviderErrorKind
from app.services.bank_sync.outbound import OutboundGuard
from app.services.bank_sync.providers.contract import ClaimRefused
from app.services.bank_sync.providers.pluggy import adapter as pluggy_module
from tests.services.bank_sync.providers.pluggy.stand_ins import (
    CLIENT_ID,
    CLIENT_SECRET,
    CREDENTIAL,
    EXPONENTS,
    ITEM_ID,
    PLUGGY_ORIGIN,
    TORONTO,
    WINDOW_END,
    WINDOW_START,
    PluggyApi,
    account,
    fetch,
    item,
    json_response,
    pluggy_adapter,
    transaction,
    transactions_body,
)
from tests.services.bank_sync.stand_ins import PUBLIC_ADDRESS, FixedResolver


async def _discover(adapter: pluggy_module.PluggyAdapter):
    """List the accounts the stored credential reaches"""
    return await adapter.discover(CREDENTIAL, currency_exponents=EXPONENTS)


def _two_accounts(answer: httpx.Response | Exception) -> PluggyApi:
    """Return Pluggy holding accounts acc-chk and acc-sav, with an answer for the first account's transactions"""
    return (
        PluggyApi()
        .serve_sign_in()
        .serve_item(item(), account("acc-chk"), account("acc-sav", name="Poupança"))
        .serve_transactions("acc-chk", answer)
        .serve_transactions("acc-sav", transactions_body(transaction()))
    )


@pytest.mark.parametrize("status", [401, 403])
async def test_a_rejected_key_on_a_transactions_read_fails_the_request_for_every_account(status):
    """A key Pluggy turns away partway fails the whole request, so the user is asked to reconnect and no account is half-synced"""
    api = _two_accounts(json_response('{"message": "Invalid API key"}', status))

    result = await fetch(pluggy_adapter(api.transport), "acc-chk", "acc-sav")

    assert result.accounts == ()
    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.CREDENTIAL_REJECTED


@pytest.mark.parametrize("status", [401, 429])
async def test_a_request_ending_failure_on_the_first_transactions_read_stops_the_reads_not_yet_sent(status):
    """With more accounts than the four requests allowed at once, a refused key or spent quota spares Pluggy the rest"""
    names = [f"acc-{number}" for number in range(12)]
    api = PluggyApi().serve_sign_in().serve_item(item(), *(account(name) for name in names))
    for name in names:
        api.serve_transactions(name, transactions_body(transaction()))
    api.serve_transactions("acc-0", json_response('{"message": "Refused"}', status))

    result = await fetch(pluggy_adapter(api.transport), *names)

    assert result.request_error is not None
    assert result.request_error.kind is (ProviderErrorKind.RATE_LIMITED if status == 429 else ProviderErrorKind.CREDENTIAL_REJECTED)
    assert 1 <= api.paths().count("/v2/transactions") <= 4


@pytest.mark.parametrize("status", [401, 429])
@pytest.mark.parametrize("operation", ["discover", "fetch"])
async def test_a_request_ending_failure_on_the_first_item_stops_the_reads_not_yet_sent(operation, status):
    """The same holds for an application with more items than the four requests allowed at once"""
    item_ids = [f"00000000-0000-4000-8000-{number:012x}" for number in range(12)]
    api = PluggyApi().serve_sign_in()
    for item_id in item_ids:
        api.serve_item(item(item_id), account(f"acc-{item_id[-2:]}", item_id=item_id), item_id=item_id)
    api.serve(f"/items/{item_ids[0]}", json_response('{"message": "Refused"}', status))
    credential = CREDENTIAL.replace(f'"{ITEM_ID}"', ", ".join(f'"{item_id}"' for item_id in item_ids))
    adapter = pluggy_adapter(api.transport)

    if operation == "discover":
        result = await adapter.discover(credential, currency_exponents=EXPONENTS)
    else:
        result = await adapter.fetch(
            credential,
            account_ids=["acc-00"],
            start=WINDOW_START,
            end=WINDOW_END,
            include_pending=False,
            timezone=TORONTO,
            currency_exponents=EXPONENTS,
        )

    assert result.request_error is not None
    assert result.request_error.kind is (ProviderErrorKind.RATE_LIMITED if status == 429 else ProviderErrorKind.CREDENTIAL_REJECTED)
    assert 1 <= sum(path.startswith("/items/") for path in api.paths()) <= 4


@pytest.mark.parametrize(
    ("answer", "kind"),
    [
        (
            httpx.Response(403, content=b"<html>Blocked</html>", headers={"Content-Type": "text/html; charset=utf-8"}),
            ProviderErrorKind.TEMPORARY,
        ),
        (
            httpx.Response(403, content=b"  <!doctype html><title>Blocked</title>", headers={"Content-Type": "text/plain"}),
            ProviderErrorKind.TEMPORARY,
        ),
        (
            httpx.Response(401, content=b"<html>Sign in</html>", headers={"Content-Type": "application/octet-stream"}),
            ProviderErrorKind.TEMPORARY,
        ),
        (json_response("{}", 400), ProviderErrorKind.UNKNOWN),
        (json_response("{}", 404), ProviderErrorKind.UNKNOWN),
        (json_response("{}", 418), ProviderErrorKind.UNKNOWN),
        (json_response("{}", 499), ProviderErrorKind.UNKNOWN),
        (json_response("{}", 500), ProviderErrorKind.TEMPORARY),
        (json_response("{}", 503), ProviderErrorKind.TEMPORARY),
        (httpx.Response(308, headers={"Location": f"{PLUGGY_ORIGIN}/v2/transactions"}), ProviderErrorKind.UNKNOWN),
        (ResponseTooLargeError("too large"), ProviderErrorKind.UNKNOWN),
        (httpx.ReadTimeout("slow"), ProviderErrorKind.TEMPORARY),
        (httpx.ConnectTimeout("slow"), ProviderErrorKind.TEMPORARY),
    ],
    ids=[
        "html-403",
        "tag-403-as-text",
        "tag-401-as-bytes",
        "400",
        "404",
        "418",
        "499",
        "500",
        "503",
        "redirect",
        "too-large",
        "read-timeout",
        "connect-timeout",
    ],
)
async def test_a_failed_transactions_read_is_that_accounts_error_alone(answer, kind):
    """A page from the edge, a 500, a timeout or an answer that makes no sense is no verdict on the keys, so the other account still syncs"""
    api = _two_accounts(answer)

    result = await fetch(pluggy_adapter(api.transport), "acc-chk", "acc-sav")

    assert result.request_error is None
    assert [found.external_id for found in result.accounts] == ["acc-sav"]
    assert set(result.account_errors) == {"acc-chk"}
    assert result.account_errors["acc-chk"].kind is kind


@pytest.mark.parametrize(
    ("timeout", "reason"),
    [
        (httpx.ReadTimeout("slow"), "Pluggy did not respond in time"),
        (httpx.ConnectTimeout("slow"), "Lumina Finance couldn't reach Pluggy"),
    ],
    ids=["read-timeout", "connect-timeout"],
)
async def test_a_timeout_says_whether_pluggy_was_reached_and_names_no_key(timeout, reason):
    """A connection that never opened and an answer that never came are both temporary, each told as what happened"""
    api = _two_accounts(timeout)

    result = await fetch(pluggy_adapter(api.transport), "acc-chk", "acc-sav")

    assert result.account_errors["acc-chk"].reason == reason


async def test_a_timeout_on_sign_in_fails_the_request_as_temporary():
    """Without a key nothing can be read, and a slow Pluggy is no rejection of the keys"""
    api = PluggyApi().serve("/auth", httpx.ReadTimeout("slow"))

    result = await _discover(pluggy_adapter(api.transport))

    assert result.accounts == ()
    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.TEMPORARY
    assert CLIENT_SECRET not in result.request_error.reason


async def test_an_oversized_answer_to_sign_in_fails_the_request_as_unknown():
    """A body too large to read is neither an outage nor a rejected key, so the sync stops after one series of retries"""
    api = PluggyApi().serve("/auth", ResponseTooLargeError("too large"))

    result = await _discover(pluggy_adapter(api.transport))

    assert result.accounts == ()
    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.UNKNOWN


def _adapter_not_allowed_to_reach_pluggy(api: PluggyApi) -> pluggy_module.PluggyAdapter:
    """Return an adapter whose guard allows another origin only"""
    return pluggy_module.PluggyAdapter(
        OutboundGuard(["https://another.example"], resolve=FixedResolver(PUBLIC_ADDRESS), transport=api.transport)
    )


async def test_fetch_for_an_origin_the_guard_refuses_fails_the_request_naming_the_host_and_sends_nothing():
    """A server the environment no longer allows says nothing about the keys, so it is no rejected credential"""
    api = PluggyApi().serve_sign_in().serve_item(item(), account())

    result = await fetch(_adapter_not_allowed_to_reach_pluggy(api), "acc-chk")

    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.UNKNOWN
    assert result.request_error.reason == "This Lumina Finance server is not set up to contact api.pluggy.ai"
    assert api.requests == []


async def test_claim_for_an_origin_the_guard_refuses_says_which_host_and_sends_nothing():
    """The user is told the server isn't set up for Pluggy, not that the keys are wrong or to try again"""
    api = PluggyApi().serve_sign_in().serve_item(item())
    supplied = {"client_id": CLIENT_ID, "client_secret": CLIENT_SECRET, "item_ids": ITEM_ID}

    with pytest.raises(ClaimRefused, match=r"api\.pluggy\.ai"):
        await _adapter_not_allowed_to_reach_pluggy(api).claim(supplied)

    assert api.requests == []
