"""Lunch Flow adapter: reads accounts, balances and transactions through the Personal API

The API key is sent only in the x-api-key header, so it never appears in a request URL, a log, an
exception or a reason. Only the host is ever named. Lunch Flow answers one account per request, so a
discovery or a fetch sends a request or two for every account, a few at a time
"""

import asyncio
import logging
import re
from collections.abc import Awaitable, Callable, Mapping, Sequence
from datetime import UTC, datetime, timedelta
from typing import override
from zoneinfo import ZoneInfo

import httpx

from app.config.runtime import APP_VERSION
from app.http_client import ResponseTooLargeError
from app.models.bank_connection import ConnectsFrom
from app.services.bank_sync.outbound import AddressRefused, OriginRefused, OutboundGuard
from app.services.bank_sync.providers.contract import (
    ClaimRefused,
    CredentialField,
    ExternalAccount,
    FetchResult,
    ProviderAdapter,
    ProviderError,
    ProviderErrorKind,
    ProviderUnreachable,
)
from app.services.bank_sync.providers.lunchflow.config import (
    LUNCHFLOW_DAILY_REQUESTS,
    LUNCHFLOW_ORIGIN,
    LUNCHFLOW_TEST_ORIGIN,
    PROVIDER_ID,
    warn_if_test_origin_set,
)
from app.services.bank_sync.providers.lunchflow.wire import (
    ACTIVE_STATUS,
    UnreadableResponse,
    WireAccount,
    exponent_of,
    external_account,
    read_accounts,
    read_balance,
    read_transactions,
)

logger = logging.getLogger(__name__)

# Every request names the app and its version
_HEADERS = {"User-Agent": f"LuminaFinance/{APP_VERSION}" if APP_VERSION else "LuminaFinance"}

# The key is sent in a header, so it is held to the printable ASCII an HTTP header holds. Lunch Flow's
# keys are far shorter, so this leaves room to spare. The providers list sends the same limit to the
# Connect dialogue
MAX_API_KEY_LENGTH = 512
_API_KEY_SHAPE = re.compile(r"[!-~]+")

# The one credential field, and the name the claim sends the API key under
API_KEY_FIELD = "api_key"

# Requests to Lunch Flow in flight at once, since it publishes no rate limit and a user with many
# accounts would otherwise send them all together
MAX_CONCURRENT_REQUESTS = 4

_API_PATH = "/api/v1"

_API_KEY_BLANK_MESSAGE = "Please paste the API key from Lunch Flow"
_API_KEY_UNREADABLE_MESSAGE = (
    "That doesn't look like a Lunch Flow API key. Please copy the whole key from your Lunch Flow API destination and try again"
)
_API_KEY_TOO_LONG_MESSAGE = "That API key is too long. Please copy only the key from your Lunch Flow API destination and try again"
_API_KEY_REFUSED_MESSAGE = "Lunch Flow rejected this API key. Please create a new key in your Lunch Flow API destination and try again"
_CLAIM_UNREACHABLE_MESSAGE = "There was no answer from Lunch Flow. Please try again in a few minutes"
_CREDENTIAL_REJECTED_MESSAGE = "Lunch Flow rejected the stored API key"
_RATE_LIMITED_MESSAGE = "Lunch Flow asked Lumina Finance to make fewer requests"
_UNREACHABLE_MESSAGE = "There was no answer from Lunch Flow"
_UNREADABLE_MESSAGE = "Lunch Flow sent an unreadable response"
_TIMED_OUT_MESSAGE = "Lunch Flow did not respond in time"
_SERVER_NOT_ALLOWED_MESSAGE = "This Lumina Finance server is not set up to contact {host}"
_NEEDS_ATTENTION_MESSAGE = "Lunch Flow says this connection needs attention. Please reconnect it in Lunch Flow, then sync again"
_MISSING_ACCOUNT_MESSAGE = "Lunch Flow didn't return this account"
_SKIPPED_ONE_WITHOUT_ID_MESSAGE = "1 transaction from Lunch Flow isn't imported: it has no id"
_SKIPPED_WITHOUT_ID_MESSAGE = "{count} transactions from Lunch Flow aren't imported: they have no id"


class _Failed(Exception):
    """One request to Lunch Flow didn't give a usable answer"""

    def __init__(self, error: ProviderError, *, ends_request: bool = False, server_refused: bool = False) -> None:
        """Hold the failure

        Args:
            error: What went wrong, as the contract reports it
            ends_request: Whether it fails every account of the operation, as a rejected key or a
                spent quota does, rather than only the account whose request it was
            server_refused: Whether the environment doesn't allow the server the request was for
        """
        super().__init__(error.reason)
        self.error = error
        self.ends_request = ends_request
        self.server_refused = server_refused


class LunchFlowAdapter(ProviderAdapter):
    """Lunch Flow, reached through its Personal API with an API key from an API destination"""

    provider_id = PROVIDER_ID
    provider_name = "Lunch Flow"
    display_order = 20
    provider_site = "Lunch Flow"
    provider_description = "One API key reaches every bank you connect in Lunch Flow."
    in_beta = True
    credential_fields = (CredentialField(API_KEY_FIELD, "API key", "Paste the key", MAX_API_KEY_LENGTH),)
    connect_steps = (
        "Open Lunch Flow and connect your banks there.",
        "Add an API destination and copy its key.",
        "Paste it here. Lumina Finance uses it to read your accounts and never sees your bank login.",
    )

    # Most banks give Lunch Flow about three months of history
    history_limit_months = 3
    advertises_history = False
    revisit_overlap_days = 14

    # Lunch Flow documents no limit, so this keeps a request's answer to a size one account holds
    max_window_days = 90
    daily_request_budget = LUNCHFLOW_DAILY_REQUESTS
    connects_from = ConnectsFrom.SETTINGS

    @override
    @classmethod
    def on_startup(cls) -> None:
        warn_if_test_origin_set()

    def __init__(self, guard: OutboundGuard | None = None) -> None:
        """Build the adapter over Lunch Flow, or over a guard tests supply

        Args:
            guard: The guard requests go through
        """
        self._guard = guard or OutboundGuard([LUNCHFLOW_ORIGIN], LUNCHFLOW_TEST_ORIGIN)
        self._api_url = httpx.URL(LUNCHFLOW_TEST_ORIGIN or LUNCHFLOW_ORIGIN).copy_with(path=_API_PATH)

    @override
    async def claim(self, supplied: Mapping[str, str]) -> str:
        api_key = supplied[API_KEY_FIELD].strip()
        if not api_key:
            raise ClaimRefused(_API_KEY_BLANK_MESSAGE)
        if len(api_key) > MAX_API_KEY_LENGTH:
            raise ClaimRefused(_API_KEY_TOO_LONG_MESSAGE)
        if not _API_KEY_SHAPE.fullmatch(api_key):
            raise ClaimRefused(_API_KEY_UNREADABLE_MESSAGE)

        try:
            await self._list_accounts(api_key)
        except _Failed as failed:
            if failed.error.kind is ProviderErrorKind.CREDENTIAL_REJECTED:
                raise ClaimRefused(_API_KEY_REFUSED_MESSAGE) from None
            if failed.server_refused:
                raise ClaimRefused(failed.error.reason) from None
            raise ProviderUnreachable(_CLAIM_UNREACHABLE_MESSAGE) from None
        return api_key

    @override
    def server_host(self, credential: str) -> str:
        return self._api_url.host

    @override
    async def discover(self, credential: str, *, currency_exponents: Mapping[str, int]) -> FetchResult:
        read_at = datetime.now(UTC)
        try:
            listed = await self._list_accounts(credential)
            active = [account for account in listed if account.status == ACTIVE_STATUS]
            balances = await self._per_account(active, lambda account: self._read_balance(credential, account, currency_exponents))
        except _Failed as failed:
            return FetchResult(request_error=failed.error)

        accounts: list[ExternalAccount] = []
        account_errors: dict[str, ProviderError] = {}
        for account in listed:
            if account.status != ACTIVE_STATUS:
                accounts.append(external_account(account, balance=None, balance_at=read_at))
                continue
            read = balances[account.id]
            if isinstance(read, _Failed):
                account_errors[str(account.id)] = read.error
            else:
                completed, balance = read
                accounts.append(external_account(completed, balance=balance, balance_at=read_at))
        return FetchResult(accounts=tuple(accounts), account_errors=account_errors, login_errors=_login_errors(listed))

    @override
    async def fetch(
        self,
        credential: str,
        *,
        account_ids: Sequence[str],
        start: datetime,
        end: datetime,
        include_pending: bool,
        timezone: ZoneInfo,
        currency_exponents: Mapping[str, int],
    ) -> FetchResult:
        if start.utcoffset() is None or end.utcoffset() is None:
            raise ValueError("A Lunch Flow window needs timezone-aware start and end times")
        elapsed = end.astimezone(UTC) - start.astimezone(UTC)
        if not timedelta(0) < elapsed <= timedelta(days=self.max_window_days):
            raise ValueError(f"A Lunch Flow window must end after it starts and span at most {self.max_window_days} days")

        # Both ends are inclusive dates in the user's timezone, so the last one is the day before end
        first_day = start.astimezone(timezone).date()
        last_day = (end - timedelta(microseconds=1)).astimezone(timezone).date()
        params = [
            ("from", first_day.isoformat()),
            ("to", last_day.isoformat()),
            ("include_pending", "true" if include_pending else "false"),
        ]

        read_at = datetime.now(UTC)
        try:
            listed = await self._list_accounts(credential)
            chosen = [account for account in listed if str(account.id) in account_ids]
            active = [account for account in chosen if account.status == ACTIVE_STATUS]
            reads = await self._per_account(
                active, lambda account: self._read_account(credential, account, params, currency_exponents, read_at)
            )
        except _Failed as failed:
            return FetchResult(request_error=failed.error)

        accounts: list[ExternalAccount] = []
        account_errors: dict[str, ProviderError] = {}
        warnings: list[ProviderError] = []
        skipped_without_id = 0
        is_cut_off = False
        for account in chosen:
            if account.status != ACTIVE_STATUS:
                accounts.append(external_account(account, balance=None, balance_at=read_at))
                continue
            read = reads[account.id]
            if isinstance(read, _Failed):
                account_errors[str(account.id)] = read.error
                continue
            accounts.append(read[0])
            skipped_without_id += read[1]
            is_cut_off = is_cut_off or read[2]

        if skipped_without_id:
            message = (
                _SKIPPED_ONE_WITHOUT_ID_MESSAGE if skipped_without_id == 1 else _SKIPPED_WITHOUT_ID_MESSAGE.format(count=skipped_without_id)
            )
            warnings.append(ProviderError(ProviderErrorKind.UNKNOWN, message))
        listed_ids = {str(account.id) for account in listed}
        for account_id in account_ids:
            if account_id not in listed_ids:
                account_errors[account_id] = ProviderError(ProviderErrorKind.UNKNOWN, _MISSING_ACCOUNT_MESSAGE)
        return FetchResult(
            accounts=tuple(accounts),
            account_errors=account_errors,
            login_errors=_login_errors(chosen),
            warnings=tuple(warnings),
            possibly_cut_off=is_cut_off,
        )

    async def _read_balance(self, api_key: str, account: WireAccount, currency_exponents: Mapping[str, int]) -> tuple[WireAccount, int | None]:
        """Read one account's balance in minor units, with the account given the balance's currency if it had none"""
        body = await self._get(api_key, f"/accounts/{account.id}/balance")
        try:
            return read_balance(body, account, currency_exponents=currency_exponents)
        except UnreadableResponse:
            raise _Failed(ProviderError(ProviderErrorKind.UNKNOWN, _UNREADABLE_MESSAGE)) from None

    async def _read_account(
        self,
        api_key: str,
        account: WireAccount,
        params: list[tuple[str, str]],
        currency_exponents: Mapping[str, int],
        read_at: datetime,
    ) -> tuple[ExternalAccount, int, bool]:
        """Read one account's balance and transactions

        The balance comes first, since its currency is the account's when the account list sent none

        Returns:
            The account with its records, how many transactions had no id, and whether they were cut off
        """
        account, balance = await self._read_balance(api_key, account, currency_exponents)
        body = await self._get(api_key, f"/accounts/{account.id}/transactions", params)
        try:
            transactions = read_transactions(body, account, exponent=exponent_of(account, currency_exponents))
        except UnreadableResponse:
            raise _Failed(ProviderError(ProviderErrorKind.UNKNOWN, _UNREADABLE_MESSAGE)) from None
        read = external_account(account, balance=balance, balance_at=read_at, records=transactions.records)
        return read, transactions.skipped_without_id, transactions.is_cut_off

    async def _list_accounts(self, api_key: str) -> tuple[WireAccount, ...]:
        """List the accounts the key reaches

        Raises:
            _Failed: The request failed or its answer couldn't be read
        """
        try:
            return read_accounts(await self._get(api_key, "/accounts"))
        except UnreadableResponse:
            raise _Failed(ProviderError(ProviderErrorKind.UNKNOWN, _UNREADABLE_MESSAGE), ends_request=True) from None

    async def _per_account[T](self, accounts: Sequence[WireAccount], read: Callable[[WireAccount], Awaitable[T]]) -> dict[int, T | _Failed]:
        """Run a read for each account, a few at a time, keeping a failure under its account

        A failure that ends the request stops the reads not yet started, since the key or the quota
        they would be sent with has just been refused

        Raises:
            _Failed: A failure that ends the request
        """
        slots = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)
        ended: _Failed | None = None

        async def run(account: WireAccount) -> T | _Failed:
            """Run one account's read once a slot is free"""
            nonlocal ended
            async with slots:
                if ended is not None:
                    return ended
                try:
                    return await read(account)
                except _Failed as failed:
                    if failed.ends_request:
                        ended = failed
                    return failed

        results = await asyncio.gather(*(run(account) for account in accounts))
        if ended is not None:
            raise ended
        return {account.id: result for account, result in zip(accounts, results, strict=True)}

    async def _get(self, api_key: str, path: str, params: Sequence[tuple[str, str]] | None = None) -> bytes:
        """Send one GET request and return the body of a 200 answer

        Raises:
            _Failed: The request didn't reach Lunch Flow, or the answer wasn't a 200
        """
        url = self._api_url.copy_with(path=f"{self._api_url.path}{path}")
        try:
            response = await self._guard.send("GET", url, headers={**_HEADERS, "x-api-key": api_key}, params=params)

        # The environment no longer allows the server this connection was made with, or a
        # development instance allows only its fake Lunch Flow. Neither says anything about the key,
        # so the connection isn't marked for reconnecting and its owner isn't emailed
        except OriginRefused:
            raise _Failed(
                ProviderError(ProviderErrorKind.UNKNOWN, _SERVER_NOT_ALLOWED_MESSAGE.format(host=url.host)),
                ends_request=True,
                server_refused=True,
            ) from None
        except AddressRefused:
            logger.warning("Refused to reach Lunch Flow at %s because it resolves to an address that isn't public", url.host)
            raise _Failed(ProviderError(ProviderErrorKind.TEMPORARY, _UNREACHABLE_MESSAGE), ends_request=True) from None
        except ResponseTooLargeError:
            raise _Failed(ProviderError(ProviderErrorKind.UNKNOWN, _UNREADABLE_MESSAGE)) from None

        # A lookup or connection that ran out of time never reached Lunch Flow
        except httpx.ConnectTimeout:
            raise _Failed(ProviderError(ProviderErrorKind.TEMPORARY, _UNREACHABLE_MESSAGE)) from None
        except httpx.TimeoutException:
            raise _Failed(ProviderError(ProviderErrorKind.TEMPORARY, _TIMED_OUT_MESSAGE)) from None
        except httpx.RequestError:
            raise _Failed(ProviderError(ProviderErrorKind.TEMPORARY, _UNREACHABLE_MESSAGE)) from None
        if response.status_code != 200:
            raise _status_failure(response)
        return response.content


def _login_errors(accounts: Sequence[WireAccount]) -> dict[str, ProviderError]:
    """Return the error of each connection holding an account whose status isn't ACTIVE, keyed by connection id"""
    return {
        str(account.connection_id): ProviderError(ProviderErrorKind.BANK_LOGIN_NEEDED, _NEEDS_ATTENTION_MESSAGE)
        for account in accounts
        if account.status != ACTIVE_STATUS
    }


def _status_failure(response: httpx.Response) -> _Failed:
    """Return the failure an answer with a status other than 200 stands for"""
    status = response.status_code
    logger.warning("Lunch Flow answered %s with status %s", response.request.url.path, status)

    # The edge in front of Lunch Flow answers its own failures with an HTML page that says nothing about the key
    if status in (401, 403) and not _is_html(response):
        return _Failed(ProviderError(ProviderErrorKind.CREDENTIAL_REJECTED, _CREDENTIAL_REJECTED_MESSAGE), ends_request=True)
    if status == 429:
        return _Failed(ProviderError(ProviderErrorKind.RATE_LIMITED, _RATE_LIMITED_MESSAGE), ends_request=True)
    if status in (401, 403) or status >= 500:
        return _Failed(ProviderError(ProviderErrorKind.TEMPORARY, _UNREACHABLE_MESSAGE))
    return _Failed(ProviderError(ProviderErrorKind.UNKNOWN, _UNREADABLE_MESSAGE))


def _is_html(response: httpx.Response) -> bool:
    """Return whether a response is an HTML page rather than an answer from Lunch Flow itself"""
    return "html" in response.headers.get("content-type", "").lower() or response.text.lstrip().startswith("<")
