"""Lunch Flow failures on the per-account reads

Guards which failures of a balance or a transactions read end the whole request, as a rejected key
does, and which stay with the one account, as a 500 does, and that a request that has ended stops the
reads not yet sent, since the key or the quota they would use has just been refused
"""

from datetime import UTC, datetime

import httpx
import pytest

from app.http_client import ResponseTooLargeError
from app.models.bank_sync_job import ProviderErrorKind
from app.services.bank_sync.outbound import OutboundGuard
from app.services.bank_sync.providers.contract import ClaimRefused
from app.services.bank_sync.providers.lunchflow.adapter import LunchFlowAdapter
from tests.services.bank_sync.providers.lunchflow.stand_ins import (
    API_KEY,
    LUNCH_FLOW_ORIGIN,
    Answer,
    LunchFlowApi,
    account,
    accounts_body,
    json_response,
    lunchflow_adapter,
)
from tests.services.bank_sync.stand_ins import PUBLIC_ADDRESS, FixedResolver

_EXPONENTS = {"CAD": 2}
_START = datetime(2026, 10, 1, tzinfo=UTC)
_END = datetime(2026, 10, 4, tzinfo=UTC)


async def _discover(adapter: LunchFlowAdapter, *account_ids: str):
    """Discover the key's accounts"""
    return await adapter.discover(API_KEY, currency_exponents=_EXPONENTS)


async def _fetch(adapter: LunchFlowAdapter, *account_ids: str):
    """Fetch the accounts' last three days"""
    return await adapter.fetch(
        API_KEY,
        account_ids=account_ids,
        start=_START,
        end=_END,
        include_pending=False,
        timezone=UTC,
        currency_exponents=_EXPONENTS,
    )


def _two_accounts(failing_path: str, answer: Answer) -> LunchFlowApi:
    """Return Lunch Flow holding accounts 11 and 12, with an answer for one of the first account's paths"""
    chequing = account(11)
    savings = account(12, name="Online Savings")
    api = LunchFlowApi().serve("/accounts", accounts_body(chequing, savings)).serve_account(chequing).serve_account(savings)
    return api.serve(f"/accounts/11/{failing_path}", answer)


@pytest.mark.parametrize("status", [401, 403])
@pytest.mark.parametrize(
    ("failing_path", "operation"),
    [("balance", _discover), ("balance", _fetch), ("transactions", _fetch)],
    ids=["discovery-balance", "fetch-balance", "fetch-transactions"],
)
async def test_a_rejected_key_on_an_account_read_fails_the_request_for_every_account(failing_path, operation, status):
    """A key Lunch Flow turns away partway fails the whole request, so the user is asked to reconnect and no account is half-synced"""
    api = _two_accounts(failing_path, json_response('{"error": "Unauthorized", "message": "Invalid API key"}', status))

    result = await operation(lunchflow_adapter(api.transport), "11", "12")

    assert result.accounts == ()
    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.CREDENTIAL_REJECTED
    assert API_KEY not in result.request_error.reason


@pytest.mark.parametrize("status", [401, 429])
@pytest.mark.parametrize("operation", [_discover, _fetch])
async def test_a_request_ending_failure_on_the_first_read_stops_the_reads_not_yet_sent(operation, status):
    """With more accounts than the four requests allowed at once, a refused key or spent quota spares Lunch Flow the rest"""
    wire_accounts = [account(number) for number in range(20, 32)]
    api = LunchFlowApi().serve("/accounts", accounts_body(*wire_accounts))
    for wire_account in wire_accounts:
        api.serve_account(wire_account)
    api.serve("/accounts/20/balance", json_response('{"error": "Refused"}', status))

    result = await operation(lunchflow_adapter(api.transport), *(str(number) for number in range(20, 32)))

    assert result.request_error is not None
    assert result.request_error.kind is (ProviderErrorKind.RATE_LIMITED if status == 429 else ProviderErrorKind.CREDENTIAL_REJECTED)
    balance_reads = [path for path in api.paths() if path.endswith("/balance")]
    assert 1 <= len(balance_reads) <= 4


@pytest.mark.parametrize("failing_path", ["balance", "transactions"])
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
        (httpx.Response(308, headers={"Location": f"{LUNCH_FLOW_ORIGIN}/api/v1/accounts/11"}), ProviderErrorKind.UNKNOWN),
        (ResponseTooLargeError("too large"), ProviderErrorKind.UNKNOWN),
    ],
    ids=["html-403", "tag-403-as-text", "tag-401-as-bytes", "400", "404", "418", "499", "500", "503", "redirect", "too-large"],
)
async def test_a_failed_account_read_is_that_accounts_error_alone(failing_path, answer, kind):
    """A page from the edge, a 500 or an answer that makes no sense is no verdict on the key, so the other account still syncs"""
    api = _two_accounts(failing_path, answer)

    result = await _fetch(lunchflow_adapter(api.transport), "11", "12")

    assert result.request_error is None
    assert [found.external_id for found in result.accounts] == ["12"]
    assert set(result.account_errors) == {"11"}
    assert result.account_errors["11"].kind is kind


def _adapter_not_allowed_to_reach_lunch_flow(api: LunchFlowApi) -> LunchFlowAdapter:
    """Return an adapter whose guard allows another origin only"""
    return LunchFlowAdapter(OutboundGuard(["https://another.example"], resolve=FixedResolver(PUBLIC_ADDRESS), transport=api.transport))


async def test_fetch_for_an_origin_the_guard_refuses_fails_the_request_naming_the_host_and_sends_nothing():
    """A server the environment no longer allows says nothing about the key, so it is no rejected credential"""
    api = LunchFlowApi().serve("/accounts", accounts_body(account(11)))

    result = await _fetch(_adapter_not_allowed_to_reach_lunch_flow(api), "11")

    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.UNKNOWN
    assert result.request_error.reason == "This Lumina Finance server is not set up to contact www.lunchflow.app"
    assert api.requests == []


async def test_claim_for_an_origin_the_guard_refuses_says_which_host_and_sends_nothing():
    """The user is told the server isn't set up for Lunch Flow, not that the key is wrong or to try again"""
    api = LunchFlowApi().serve("/accounts", accounts_body(account(11)))

    with pytest.raises(ClaimRefused, match=r"www\.lunchflow\.app"):
        await _adapter_not_allowed_to_reach_lunch_flow(api).claim({"api_key": API_KEY})

    assert api.requests == []
