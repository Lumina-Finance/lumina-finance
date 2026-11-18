"""Akahu failures on a request

Guards which failures end the whole request, as a rejected token does, and which stay with the one
account, as a 500 does, that a request that has ended stops the reads not yet sent, and what a
timeout, an oversized body, a page from the edge or a server the environment doesn't allow says
about the tokens, which is nothing
"""

import httpx
import pytest

from app.http_client import ResponseTooLargeError
from app.models.bank_sync_job import ProviderErrorKind
from app.services.bank_sync.outbound import OutboundGuard
from app.services.bank_sync.providers.akahu.adapter import AkahuAdapter
from app.services.bank_sync.providers.contract import ClaimRefused, ProviderUnreachable
from tests.services.bank_sync.providers.akahu.stand_ins import (
    AKAHU_ORIGIN,
    APP_ID_TOKEN,
    USER_ACCESS_TOKEN,
    AkahuApi,
    Answer,
    account,
    accounts_body,
    akahu_adapter,
    fetch,
    json_response,
    transaction,
    transactions_body,
)
from tests.services.bank_sync.stand_ins import PUBLIC_ADDRESS, FixedResolver

_SUPPLIED = {"app_id_token": APP_ID_TOKEN, "user_access_token": USER_ACCESS_TOKEN}


def _two_accounts(answer: Answer) -> AkahuApi:
    """Return Akahu holding accounts acc_chq and acc_sav, with an answer for the first account's transactions"""
    return (
        AkahuApi()
        .serve("/accounts", accounts_body(account("acc_chq"), account("acc_sav", name="Online Savings")))
        .serve("/accounts/acc_chq/transactions", answer)
        .serve("/accounts/acc_sav/transactions", transactions_body(transaction("trans_2", account_id="acc_sav")))
    )


@pytest.mark.parametrize("status", [401, 429])
async def test_a_request_ending_failure_on_the_first_read_stops_the_reads_not_yet_sent(status):
    """With more accounts than the four requests allowed at once, rejected tokens or a spent quota spare Akahu the rest"""
    numbers = range(12)
    api = AkahuApi().serve("/accounts", accounts_body(*(account(f"acc_{number}", name=f"Account {number}") for number in numbers)))
    for number in numbers:
        api.serve(f"/accounts/acc_{number}/transactions", transactions_body(transaction(f"trans_{number}", account_id=f"acc_{number}")))
    api.serve("/accounts/acc_0/transactions", json_response('{"success": false, "message": "Refused"}', status))

    result = await fetch(akahu_adapter(api.transport), *(f"acc_{number}" for number in numbers))

    assert result.accounts == ()
    assert result.request_error is not None
    assert result.request_error.kind is (ProviderErrorKind.RATE_LIMITED if status == 429 else ProviderErrorKind.CREDENTIAL_REJECTED)
    assert 1 <= len([path for path in api.paths() if path.endswith("/transactions")]) <= 4


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
        (json_response("{}", 500), ProviderErrorKind.TEMPORARY),
        (json_response("{}", 503), ProviderErrorKind.TEMPORARY),
        (httpx.Response(308, headers={"Location": f"{AKAHU_ORIGIN}/v1/accounts/acc_chq/transactions"}), ProviderErrorKind.UNKNOWN),
        (ResponseTooLargeError("too large"), ProviderErrorKind.UNKNOWN),
        (httpx.ReadTimeout("slow"), ProviderErrorKind.TEMPORARY),
        (httpx.ConnectTimeout("slow"), ProviderErrorKind.TEMPORARY),
        (httpx.ConnectError("refused"), ProviderErrorKind.TEMPORARY),
    ],
    ids=[
        "html-403",
        "tag-403-as-text",
        "tag-401-as-bytes",
        "400",
        "404",
        "418",
        "500",
        "503",
        "redirect",
        "too-large",
        "read-timeout",
        "connect-timeout",
        "connection-failed",
    ],
)
async def test_a_failed_account_read_is_that_accounts_error_alone(answer, kind):
    """A page from the edge, a timeout, a 500 or an answer that makes no sense is no verdict on the tokens, so the other account syncs"""
    api = _two_accounts(answer)

    result = await fetch(akahu_adapter(api.transport), "acc_chq", "acc_sav")

    assert result.request_error is None
    assert [found.external_id for found in result.accounts] == ["acc_sav"]
    assert set(result.account_errors) == {"acc_chq"}
    assert result.account_errors["acc_chq"].kind is kind
    assert USER_ACCESS_TOKEN not in result.account_errors["acc_chq"].reason
    assert APP_ID_TOKEN not in result.account_errors["acc_chq"].reason


@pytest.mark.parametrize(
    ("answer", "reason"),
    [
        (httpx.ReadTimeout("slow"), "Akahu did not respond in time"),
        (httpx.ConnectTimeout("slow"), "Lumina Finance couldn't reach Akahu"),
        (ResponseTooLargeError("too large"), "Lumina Finance couldn't read the response from Akahu"),
    ],
    ids=["read-timeout", "connect-timeout", "too-large"],
)
async def test_a_timeout_or_an_oversized_body_says_what_happened_without_a_token(answer, reason):
    """A slow Akahu, one that never answered and a body past the limit each get their own plain reason"""
    api = _two_accounts(answer)

    result = await fetch(akahu_adapter(api.transport), "acc_chq", "acc_sav")

    assert result.account_errors["acc_chq"].reason == reason


@pytest.mark.parametrize("status", [401, 403])
async def test_an_html_page_for_the_account_list_is_an_outage_not_rejected_tokens(status):
    """The edge in front of Akahu answers its own failures in HTML, so a 401 or 403 page is no verdict on the tokens"""
    api = AkahuApi().serve("/accounts", httpx.Response(status, content=b"<html>Sign in</html>", headers={"Content-Type": "text/html"}))

    result = await fetch(akahu_adapter(api.transport), "acc_chq")

    assert result.accounts == ()
    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.TEMPORARY


def _adapter_not_allowed_to_reach_akahu(api: AkahuApi) -> AkahuAdapter:
    """Return an adapter whose guard allows another origin only"""
    return AkahuAdapter(OutboundGuard(["https://another.example"], resolve=FixedResolver(PUBLIC_ADDRESS), transport=api.transport))


async def test_fetch_for_an_origin_the_guard_refuses_fails_the_request_naming_the_host_and_sends_nothing():
    """A server the environment no longer allows says nothing about the tokens, so it is no rejected credential"""
    api = AkahuApi().serve("/accounts", accounts_body(account()))

    result = await fetch(_adapter_not_allowed_to_reach_akahu(api), "acc_chq")

    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.UNKNOWN
    assert result.request_error.reason == "This Lumina Finance server is not set up to contact api.akahu.io"
    assert api.requests == []


async def test_claim_for_an_origin_the_guard_refuses_says_which_host_and_sends_nothing():
    """The user is told the server isn't set up for Akahu, not that the tokens are wrong or to try again"""
    api = AkahuApi().serve_me()

    with pytest.raises(ClaimRefused, match=r"api\.akahu\.io"):
        await _adapter_not_allowed_to_reach_akahu(api).claim(_SUPPLIED)

    assert api.requests == []


@pytest.mark.parametrize(
    "answer", [json_response('{"success": false, "message": "Bad request"}', 400), json_response("{}", 404)], ids=["400", "404"]
)
async def test_claim_with_a_refusal_that_is_no_verdict_on_the_tokens_leaves_them_to_try_again(answer):
    """A 400 or a 404 on GET /me isn't Akahu rejecting the pair, so the user isn't told to replace the tokens"""
    api = AkahuApi().serve("/me", answer)

    with pytest.raises(ProviderUnreachable) as unreachable:
        await akahu_adapter(api.transport).claim(_SUPPLIED)

    assert str(unreachable.value) == "Lumina Finance couldn't reach Akahu. Please try again in a few minutes"


@pytest.mark.parametrize("answer", [httpx.ReadTimeout("slow"), ResponseTooLargeError("too large")], ids=["timeout", "too-large"])
async def test_claim_that_times_out_or_meets_an_oversized_body_leaves_the_tokens_to_try_again(answer):
    """Neither says anything about the tokens, so neither refuses them"""
    api = AkahuApi().serve("/me", answer)

    with pytest.raises(ProviderUnreachable):
        await akahu_adapter(api.transport).claim(_SUPPLIED)
