"""Enable Banking failures on the per-account reads and on a server the environment doesn't allow

Guards which failures of a balance or a transactions read end the whole request, as a rejected key
does, and which stay with the one account, as a 500 does, that a request that has ended stops the
reads not yet sent, since the key or the quota they would use has just been refused, and that a server
the environment doesn't allow is named without blaming the key
"""

from datetime import UTC, datetime

import httpx
import pytest

from app.http_client import ResponseTooLargeError
from app.services.bank_sync.outbound import OutboundGuard
from app.services.bank_sync.providers.contract import ClaimRefused, ProviderErrorKind
from app.services.bank_sync.providers.enable_banking import adapter as adapter_module
from tests.services.bank_sync.providers.enable_banking.stand_ins import (
    CARD,
    CHECKING,
    CODE,
    CREDENTIAL,
    ENABLE_BANKING_ORIGIN,
    EXPONENTS,
    PRIVATE_KEY,
    REDIRECT_URL,
    STATE,
    SUPPLIED,
    Answer,
    EnableBankingApi,
    balance,
    balances_body,
    enable_banking_adapter,
    fetch,
    json_response,
    session_account,
    stored_credential,
    transactions_body,
)
from tests.services.bank_sync.stand_ins import PUBLIC_ADDRESS, FixedResolver, fail_with

_BALANCES = balances_body(balance("CLBD", "1500.50"))


@pytest.fixture(autouse=True)
def _reads_on_5_october(monkeypatch):
    """Make every read happen two days after the stand-in window, so the window is read by its exact dates"""
    monkeypatch.setattr(adapter_module, "_read_time", lambda: datetime(2026, 10, 5, 12, 0, tzinfo=UTC))


async def _discover(adapter: adapter_module.EnableBankingAdapter, *account_ids: str, credential: str = CREDENTIAL):
    """Discover the session's accounts"""
    return await adapter.discover(credential, currency_exponents=EXPONENTS)


async def _fetch(adapter: adapter_module.EnableBankingAdapter, *account_ids: str, credential: str = CREDENTIAL):
    """Fetch the stand-in window for the accounts"""
    return await fetch(adapter, *account_ids, credential=credential)


def _two_accounts(failing_path: str, answer: Answer) -> EnableBankingApi:
    """Return Enable Banking holding the checking account and the card, with an answer for one of the checking account's paths"""
    api = (
        EnableBankingApi()
        .serve_account("uid-checking", balances=_BALANCES, transactions=transactions_body())
        .serve_account("uid-card", balances=_BALANCES, transactions=transactions_body())
    )
    return api.serve("GET", f"/accounts/uid-checking/{failing_path}", answer)


@pytest.mark.parametrize("status", [401, 403])
@pytest.mark.parametrize(
    ("failing_path", "operation"),
    [("balances", _discover), ("balances", _fetch), ("transactions", _fetch)],
    ids=["discovery-balances", "fetch-balances", "fetch-transactions"],
)
async def test_a_rejected_key_on_an_account_read_fails_the_request_for_every_account(failing_path, operation, status):
    """A key Enable Banking turns away partway fails the whole request, so the user is asked to reconnect and no account is half-synced"""
    api = _two_accounts(failing_path, json_response('{"message": "Unauthorized", "error": "UNAUTHORIZED_ACCESS"}', status))

    result = await operation(enable_banking_adapter(api.transport), CHECKING, CARD)

    assert result.accounts == ()
    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.CREDENTIAL_REJECTED
    assert PRIVATE_KEY not in result.request_error.reason


@pytest.mark.parametrize("status", [401, 429])
@pytest.mark.parametrize("operation", [_discover, _fetch])
async def test_a_request_ending_failure_on_the_first_read_stops_the_reads_not_yet_sent(operation, status):
    """With more accounts than the four requests allowed at once, a refused key or spent quota spares Enable Banking the rest"""
    uids = [f"uid-{index}" for index in range(12)]
    api = EnableBankingApi()
    for uid in uids:
        api.serve_account(uid, balances=_BALANCES, transactions=transactions_body())
    api.serve("GET", "/accounts/uid-0/balances", json_response('{"message": "Refused"}', status))
    credential = stored_credential(*((uid, f"hash-{uid}", uid, "EUR") for uid in uids))

    result = await operation(enable_banking_adapter(api.transport), *(f"hash-{uid}" for uid in uids), credential=credential)

    assert result.request_error is not None
    assert result.request_error.kind is (ProviderErrorKind.RATE_LIMITED if status == 429 else ProviderErrorKind.CREDENTIAL_REJECTED)
    balance_reads = [path for path in api.paths() if path.endswith("/balances")]
    assert 1 <= len(balance_reads) <= 4


@pytest.mark.parametrize("failing_path", ["balances", "transactions"])
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
        (httpx.Response(308, headers={"Location": f"{ENABLE_BANKING_ORIGIN}/accounts/uid-checking"}), ProviderErrorKind.UNKNOWN),
        (ResponseTooLargeError("too large"), ProviderErrorKind.UNKNOWN),
        (fail_with(httpx.ReadTimeout), ProviderErrorKind.TEMPORARY),
    ],
    ids=["html-403", "tag-403-as-text", "tag-401-as-bytes", "400", "404", "418", "499", "500", "503", "redirect", "too-large", "timed-out"],
)
async def test_a_failed_account_read_is_that_accounts_error_alone(failing_path, answer, kind):
    """A page from the edge, a 500, a timeout or an answer that makes no sense is no verdict on the key, so the other account still syncs"""
    api = _two_accounts(failing_path, answer)

    result = await _fetch(enable_banking_adapter(api.transport), CHECKING, CARD)

    assert result.request_error is None
    assert [found.external_id for found in result.accounts] == [CARD]
    assert set(result.account_errors) == {CHECKING}
    assert result.account_errors[CHECKING].kind is kind


def _adapter_not_allowed_to_reach_enable_banking(api: EnableBankingApi) -> adapter_module.EnableBankingAdapter:
    """Return an adapter whose guard allows another origin only"""
    return adapter_module.EnableBankingAdapter(
        OutboundGuard(["https://another.example"], resolve=FixedResolver(PUBLIC_ADDRESS), transport=api.transport)
    )


@pytest.mark.parametrize("operation", [_discover, _fetch])
async def test_a_read_for_an_origin_the_guard_refuses_fails_the_request_naming_the_host_and_sends_nothing(operation):
    """A server the environment no longer allows says nothing about the key, so it is no rejected credential"""
    api = _two_accounts("transactions", transactions_body())

    result = await operation(_adapter_not_allowed_to_reach_enable_banking(api), CHECKING)

    assert result.request_error is not None
    assert result.request_error.kind is ProviderErrorKind.UNKNOWN
    assert result.request_error.reason == "This Lumina Finance server is not set up to contact api.enablebanking.com"
    assert api.requests == []


async def test_start_for_an_origin_the_guard_refuses_says_which_host_and_sends_nothing():
    """The user is told the server isn't set up for Enable Banking, not that the key or the bank is wrong"""
    api = EnableBankingApi().serve_session(session_account("uid-checking", CHECKING))
    adapter = _adapter_not_allowed_to_reach_enable_banking(api)

    with pytest.raises(ClaimRefused, match=r"api\.enablebanking\.com") as refused:
        await adapter.start_authorization(SUPPLIED, redirect_url=REDIRECT_URL, state=STATE)

    assert refused.value.fields == ()
    assert api.requests == []


async def test_claim_authorized_for_an_origin_the_guard_refuses_says_which_host_and_sends_nothing():
    """A sign-in the bank approved can't be finished from this server, which says why rather than blaming the code"""
    api = EnableBankingApi().serve_session(session_account("uid-checking", CHECKING))

    with pytest.raises(ClaimRefused, match=r"api\.enablebanking\.com"):
        await _adapter_not_allowed_to_reach_enable_banking(api).claim_authorized(SUPPLIED, code=CODE)

    assert api.requests == []
