"""Akahu adapter: reads accounts, balances and transactions through an Akahu personal app

The two tokens are sent only in headers, so they never appear in a request URL, a log, an exception
or a reason. Only the host is ever named. Akahu answers a transactions request one page at a time,
so a fetch follows each account's cursor to its end, a few accounts at a time, all inside one
operation
"""

import asyncio
import json
import logging
import re
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import override
from zoneinfo import ZoneInfo

import httpx

from app.config.runtime import APP_VERSION
from app.http_client import ResponseTooLargeError
from app.models.bank_connection import ConnectsFrom
from app.services.bank_sync.outbound import AddressRefused, OriginRefused, OutboundGuard
from app.services.bank_sync.providers.akahu.config import (
    AKAHU_DAILY_REQUESTS,
    AKAHU_ORIGIN,
    AKAHU_TEST_ORIGIN,
    PROVIDER_ID,
    warn_if_test_origin_set,
)
from app.services.bank_sync.providers.akahu.wire import (
    ACTIVE_STATUS,
    TRANSACTIONS_ATTRIBUTE,
    PendingTransactions,
    UnreadableResponse,
    WireAccount,
    exponent_of,
    external_account,
    read_accounts,
    read_me,
    read_pending,
    read_transaction_page,
)
from app.services.bank_sync.providers.contract import (
    ClaimRefused,
    CredentialField,
    ExternalAccount,
    FetchResult,
    ProviderAdapter,
    ProviderError,
    ProviderErrorKind,
    ProviderRecord,
    ProviderUnreachable,
)

logger = logging.getLogger(__name__)

# Every request names the app and its version
_USER_AGENT = f"LuminaFinance/{APP_VERSION}" if APP_VERSION else "LuminaFinance"

# Each token is sent in a header, so it is held to the printable ASCII an HTTP header holds. Akahu's
# tokens are far shorter, so this leaves room to spare. The providers list sends the same limit to
# the Connect dialogue
MAX_TOKEN_LENGTH = 512
_TOKEN_SHAPE = re.compile(r"[!-~]+")

# The names the claim sends the two tokens under
APP_ID_TOKEN_FIELD = "app_id_token"  # noqa: S105 - a field name, not a secret
USER_ACCESS_TOKEN_FIELD = "user_access_token"  # noqa: S105 - a field name, not a secret

# Requests to Akahu in flight at once, since it publishes no rate limit and a user with many
# accounts would otherwise send them all together
MAX_CONCURRENT_REQUESTS = 4

# Akahu sends up to 100 transactions a page. A cursor that never ends would otherwise keep an
# account's read going for ever, so a read stops after this many pages and says it was cut off
MAX_PAGES_PER_ACCOUNT = 200

_API_PATH = "/v1"

_TOKENS_REFUSED_MESSAGE = (
    "Akahu rejected these tokens. Please check both the app ID token and the user access token in your Akahu personal app and try again"
)
_NOT_A_TOKEN_MESSAGE = "That doesn't look like an Akahu {noun}. Please copy the whole token from your Akahu personal app and try again"  # noqa: S105 - a message, not a secret
_CLAIM_UNREACHABLE_MESSAGE = "Lumina Finance couldn't reach Akahu. Please try again in a few minutes"
_CREDENTIAL_REJECTED_MESSAGE = "Akahu rejected the stored tokens"
_RATE_LIMITED_MESSAGE = "Akahu asked Lumina Finance to make fewer requests"
_UNREACHABLE_MESSAGE = "Lumina Finance couldn't reach Akahu"
_UNREADABLE_MESSAGE = "Lumina Finance couldn't read the response from Akahu"
_TIMED_OUT_MESSAGE = "Akahu did not respond in time"
_SERVER_NOT_ALLOWED_MESSAGE = "This Lumina Finance server is not set up to contact {host}"
_RECONNECT_MESSAGE = "Akahu says this bank needs a reconnection. Please reconnect it in your Akahu personal app, then sync again"
_MISSING_ACCOUNT_MESSAGE = "Akahu didn't return this account"
_NO_CURRENCY_MESSAGE = "Akahu didn't say which currency this account is in"
_SKIPPED_ONE_PENDING_MESSAGE = "1 pending transaction from Akahu isn't shown: it's missing a date, an amount or an account"
_SKIPPED_PENDING_MESSAGE = "{count} pending transactions from Akahu aren't shown: they're missing a date, an amount or an account"
_PENDING_UNAVAILABLE_MESSAGE = "Lumina Finance couldn't read Akahu's pending transactions"
_CUT_OFF_MESSAGE = "Akahu sent more pages of transactions than Lumina Finance reads at once"


@dataclass(frozen=True)
class _Tokens:
    """The pair of tokens a personal app is reached with"""

    app_id: str
    user_access: str

    def headers(self) -> dict[str, str]:
        """Return the headers that carry them"""
        return {"User-Agent": _USER_AGENT, "Authorization": f"Bearer {self.user_access}", "X-Akahu-Id": self.app_id}


class _Failed(Exception):
    """One request to Akahu didn't give a usable answer"""

    def __init__(self, error: ProviderError, *, ends_request: bool = False, is_server_refused: bool = False) -> None:
        """Hold the failure

        Args:
            error: What went wrong, as the contract reports it
            ends_request: Whether it fails every account of the operation, as a rejected token or a
                spent quota does, instead of only the account whose request it was
            is_server_refused: Whether this environment doesn't allow the server the request was for
        """
        super().__init__(error.reason)
        self.error = error
        self.ends_request = ends_request
        self.is_server_refused = is_server_refused


@dataclass(frozen=True)
class _AccountRead:
    """The records read for one account, and whether its pages ran past the cap"""

    records: tuple[ProviderRecord, ...]
    is_cut_off: bool


class AkahuAdapter(ProviderAdapter):
    """Akahu, reached through a personal app's App ID Token and User Access Token"""

    provider_id = PROVIDER_ID
    provider_name = "Akahu"
    display_order = 30
    provider_site = "my.akahu.nz"
    provider_description = "One Akahu personal app reaches all your New Zealand banks."
    in_beta = True
    credential_fields = (
        CredentialField(APP_ID_TOKEN_FIELD, "App ID token", "Paste the token", MAX_TOKEN_LENGTH),
        CredentialField(USER_ACCESS_TOKEN_FIELD, "User access token", "Paste the token", MAX_TOKEN_LENGTH),
    )
    connect_steps = (
        "Sign in at my.akahu.nz, open Developers and create a personal app.",
        "Connect your bank accounts in the app, then copy its app ID token and user access token.",
        "Paste them here. Lumina Finance uses them to read your accounts and never sees your bank login.",
    )

    # Personal apps reach 730 days of history, and some banks hold less
    history_limit_months = 24
    advertises_history = False
    revisit_overlap_days = 14

    # Akahu documents no limit on a range, so this keeps an account's pages to a size one read holds
    max_window_days = 90
    daily_request_budget = AKAHU_DAILY_REQUESTS
    connects_from = ConnectsFrom.SETTINGS

    @override
    @classmethod
    def on_startup(cls) -> None:
        warn_if_test_origin_set()

    def __init__(self, guard: OutboundGuard | None = None) -> None:
        """Build the adapter over Akahu, or over a guard tests supply

        Args:
            guard: The guard requests go through
        """
        self._guard = guard or OutboundGuard([AKAHU_ORIGIN], AKAHU_TEST_ORIGIN)
        self._api_url = httpx.URL(AKAHU_TEST_ORIGIN or AKAHU_ORIGIN).copy_with(path=_API_PATH)

    @override
    async def claim(self, supplied: Mapping[str, str]) -> str:
        tokens = _Tokens(
            _read_token(supplied, APP_ID_TOKEN_FIELD, "app ID token"), _read_token(supplied, USER_ACCESS_TOKEN_FIELD, "user access token")
        )
        try:
            read_me(await self._get(tokens, "/me"))
        except UnreadableResponse:
            raise ProviderUnreachable(_CLAIM_UNREACHABLE_MESSAGE) from None
        except _Failed as failed:
            if failed.error.kind is ProviderErrorKind.CREDENTIAL_REJECTED:
                raise ClaimRefused(_TOKENS_REFUSED_MESSAGE) from None
            if failed.is_server_refused:
                raise ClaimRefused(failed.error.reason) from None
            raise ProviderUnreachable(_CLAIM_UNREACHABLE_MESSAGE) from None
        return json.dumps({APP_ID_TOKEN_FIELD: tokens.app_id, USER_ACCESS_TOKEN_FIELD: tokens.user_access})

    @override
    def server_host(self, credential: str) -> str:
        return self._api_url.host

    @override
    async def discover(self, credential: str, *, currency_exponents: Mapping[str, int]) -> FetchResult:
        read_at = datetime.now(UTC)
        try:
            listed = await self._list_accounts(_tokens_of(credential))
        except _Failed as failed:
            return FetchResult(request_error=failed.error)

        # An account listed without a balance is left out, since a bank account is stored with a
        # currency and only the balance gives it. An inactive one needs no error of its own, as its
        # bank's login error already asks for the reconnection
        accounts: list[ExternalAccount] = []
        account_errors: dict[str, ProviderError] = {}
        for account in listed:
            if account.has_currency:
                accounts.append(
                    external_account(account, currency_exponents=currency_exponents, balance_at=read_at, has_balance=_is_active(account))
                )
            elif _is_active(account):
                account_errors[account.id] = ProviderError(ProviderErrorKind.UNKNOWN, _NO_CURRENCY_MESSAGE)
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
            raise ValueError("An Akahu window needs timezone-aware start and end times")
        elapsed = end.astimezone(UTC) - start.astimezone(UTC)
        if not timedelta(0) < elapsed <= timedelta(days=self.max_window_days):
            raise ValueError(f"An Akahu window must end after it starts and span at most {self.max_window_days} days")

        # Akahu's start is exclusive and its end inclusive, at the millisecond. The window holds the
        # instants from start up to but not including end, so each bound moves back by one millisecond
        params = [("start", _akahu_instant(start - timedelta(milliseconds=1))), ("end", _akahu_instant(end - timedelta(milliseconds=1)))]

        tokens = _tokens_of(credential)
        read_at = datetime.now(UTC)
        try:
            listed = await self._list_accounts(tokens)
            chosen = [account for account in listed if account.id in account_ids]
            readable = [
                account for account in chosen if account.has_currency and _is_active(account) and TRANSACTIONS_ATTRIBUTE in account.attributes
            ]
            reads = await self._per_account(
                readable, lambda account: self._read_account(tokens, account, params, exponent_of(account, currency_exponents), timezone)
            )
            pending, pending_failure = await self._read_pending(tokens, readable, include_pending, currency_exponents, timezone)
        except _Failed as failed:
            return FetchResult(request_error=failed.error)

        accounts: list[ExternalAccount] = []
        account_errors: dict[str, ProviderError] = {}
        is_cut_off = False
        for account in chosen:
            if not account.has_currency:
                if _is_active(account):
                    account_errors[account.id] = ProviderError(ProviderErrorKind.UNKNOWN, _NO_CURRENCY_MESSAGE)
                continue
            read = reads.get(account.id)
            if isinstance(read, _Failed):
                account_errors[account.id] = read.error
                continue
            if read is not None and pending_failure is not None:
                account_errors[account.id] = pending_failure.error
                continue
            records = (*read.records, *pending.records.get(account.id, ())) if read is not None else ()
            is_cut_off = is_cut_off or (read is not None and read.is_cut_off)
            accounts.append(
                external_account(
                    account, currency_exponents=currency_exponents, balance_at=read_at, records=records, has_balance=_is_active(account)
                )
            )

        listed_ids = {account.id for account in listed}
        for account_id in account_ids:
            if account_id not in listed_ids:
                account_errors[account_id] = ProviderError(ProviderErrorKind.UNKNOWN, _MISSING_ACCOUNT_MESSAGE)
        warnings: list[ProviderError] = []
        if is_cut_off:
            warnings.append(ProviderError(ProviderErrorKind.UNKNOWN, _CUT_OFF_MESSAGE))
        if pending.skipped_incomplete:
            message = (
                _SKIPPED_ONE_PENDING_MESSAGE
                if pending.skipped_incomplete == 1
                else _SKIPPED_PENDING_MESSAGE.format(count=pending.skipped_incomplete)
            )
            warnings.append(ProviderError(ProviderErrorKind.UNKNOWN, message))
        return FetchResult(
            accounts=tuple(accounts),
            account_errors=account_errors,
            login_errors=_login_errors(chosen),
            warnings=tuple(warnings),
            possibly_cut_off=is_cut_off,
        )

    async def _read_account(
        self, tokens: _Tokens, account: WireAccount, params: list[tuple[str, str]], exponent: int | None, timezone: ZoneInfo
    ) -> _AccountRead:
        """Read every page of one account's transactions, following the cursor with the same range"""
        records: list[ProviderRecord] = []
        cursor: str | None = None
        for _ in range(MAX_PAGES_PER_ACCOUNT):
            page_params = params if cursor is None else [*params, ("cursor", cursor)]
            body = await self._get(tokens, f"/accounts/{account.id}/transactions", page_params)
            try:
                page = read_transaction_page(body, account, exponent=exponent, timezone=timezone)
            except UnreadableResponse:
                raise _Failed(ProviderError(ProviderErrorKind.UNKNOWN, _UNREADABLE_MESSAGE)) from None
            records.extend(page.records)
            cursor = page.next_cursor
            if cursor is None:
                return _AccountRead(tuple(records), is_cut_off=False)
        return _AccountRead(tuple(records), is_cut_off=True)

    async def _read_pending(
        self,
        tokens: _Tokens,
        accounts: Sequence[WireAccount],
        include_pending: bool,
        currency_exponents: Mapping[str, int],
        timezone: ZoneInfo,
    ) -> tuple[PendingTransactions, _Failed | None]:
        """Read the pending transactions of the accounts, since Akahu answers for every account at once

        Returns:
            The records by account id, and the failure of this request when it alone failed

        Raises:
            _Failed: A failure that ends the request
        """
        none_read = PendingTransactions({}, 0)
        if not include_pending or not accounts:
            return none_read, None
        try:
            body = await self._get(tokens, "/transactions/pending")
            return read_pending(
                body, {account.id: account for account in accounts}, currency_exponents=currency_exponents, timezone=timezone
            ), None
        except UnreadableResponse:
            return none_read, _Failed(ProviderError(ProviderErrorKind.UNKNOWN, _UNREADABLE_MESSAGE))
        except _Failed as failed:
            if failed.ends_request:
                raise
            # The failure it wraps decides whether this is an outage
            return none_read, _Failed(ProviderError(failed.error.kind, _PENDING_UNAVAILABLE_MESSAGE))

    async def _list_accounts(self, tokens: _Tokens) -> tuple[WireAccount, ...]:
        """List the accounts the personal app reaches

        Raises:
            _Failed: The request failed or its answer couldn't be read
        """
        try:
            return read_accounts(await self._get(tokens, "/accounts"))
        except UnreadableResponse:
            raise _Failed(ProviderError(ProviderErrorKind.UNKNOWN, _UNREADABLE_MESSAGE), ends_request=True) from None

    async def _per_account[T](self, accounts: Sequence[WireAccount], read: Callable[[WireAccount], Awaitable[T]]) -> dict[str, T | _Failed]:
        """Run a read for each account, a few at a time, keeping a failure under its account

        A failure that ends the request stops the reads not yet started, since the tokens or the
        quota they would be sent with has just been refused

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

    async def _get(self, tokens: _Tokens, path: str, params: Sequence[tuple[str, str]] | None = None) -> bytes:
        """Send one GET request and return the body of a 200 answer

        Raises:
            _Failed: The request didn't reach Akahu, or the answer wasn't a 200
        """
        url = self._api_url.copy_with(path=f"{self._api_url.path}{path}")
        try:
            response = await self._guard.send("GET", url, headers=tokens.headers(), params=params)

        # The environment no longer allows the server this connection was made with, or a
        # development instance allows only its fake Akahu. Neither says anything about the tokens,
        # so the connection isn't marked for reconnecting and its owner isn't emailed
        except OriginRefused:
            raise _Failed(
                ProviderError(ProviderErrorKind.UNKNOWN, _SERVER_NOT_ALLOWED_MESSAGE.format(host=url.host)),
                ends_request=True,
                is_server_refused=True,
            ) from None
        except AddressRefused:
            logger.warning("Refused to reach Akahu at %s because it resolves to an address that isn't public", url.host)
            raise _Failed(ProviderError(ProviderErrorKind.TEMPORARY, _UNREACHABLE_MESSAGE), ends_request=True) from None
        except ResponseTooLargeError:
            raise _Failed(ProviderError(ProviderErrorKind.UNKNOWN, _UNREADABLE_MESSAGE)) from None

        # A lookup or connection that ran out of time never reached Akahu
        except httpx.ConnectTimeout:
            raise _Failed(ProviderError(ProviderErrorKind.TEMPORARY, _UNREACHABLE_MESSAGE)) from None
        except httpx.TimeoutException:
            raise _Failed(ProviderError(ProviderErrorKind.TEMPORARY, _TIMED_OUT_MESSAGE)) from None
        except httpx.RequestError:
            raise _Failed(ProviderError(ProviderErrorKind.TEMPORARY, _UNREACHABLE_MESSAGE)) from None
        if response.status_code != 200:
            raise _status_failure(response)
        return response.content


def _read_token(supplied: Mapping[str, str], key: str, noun: str) -> str:
    """Return one pasted token, trimmed

    Raises:
        ClaimRefused: The token can't be a header value
    """
    token = supplied[key].strip()
    if not token or len(token) > MAX_TOKEN_LENGTH or not _TOKEN_SHAPE.fullmatch(token):
        raise ClaimRefused(_NOT_A_TOKEN_MESSAGE.format(noun=noun))
    return token


def _tokens_of(credential: str) -> _Tokens:
    """Return the tokens a stored credential holds"""
    stored = json.loads(credential)
    return _Tokens(stored[APP_ID_TOKEN_FIELD], stored[USER_ACCESS_TOKEN_FIELD])


def _akahu_instant(moment: datetime) -> str:
    """Write an instant the way Akahu reads one: ISO 8601 in UTC to the millisecond"""
    return moment.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _is_active(account: WireAccount) -> bool:
    """Return whether the account's bank access works"""
    return account.status == ACTIVE_STATUS


def _login_errors(accounts: Sequence[WireAccount]) -> dict[str, ProviderError]:
    """Return the error of each bank connection holding an inactive account, keyed by connection id"""
    return {
        account.connection.id: ProviderError(ProviderErrorKind.BANK_LOGIN_NEEDED, _RECONNECT_MESSAGE)
        for account in accounts
        if not _is_active(account)
    }


def _status_failure(response: httpx.Response) -> _Failed:
    """Return the failure an answer with a status other than 200 stands for"""
    status = response.status_code

    # The edge in front of Akahu answers its own failures with an HTML page that says nothing about the tokens
    if status in (401, 403) and not _is_html(response):
        return _Failed(ProviderError(ProviderErrorKind.CREDENTIAL_REJECTED, _CREDENTIAL_REJECTED_MESSAGE), ends_request=True)
    if status == 429:
        return _Failed(ProviderError(ProviderErrorKind.RATE_LIMITED, _RATE_LIMITED_MESSAGE), ends_request=True)
    if status in (401, 403) or status >= 500:
        return _Failed(ProviderError(ProviderErrorKind.TEMPORARY, _UNREACHABLE_MESSAGE))
    return _Failed(ProviderError(ProviderErrorKind.UNKNOWN, _UNREADABLE_MESSAGE))


def _is_html(response: httpx.Response) -> bool:
    """Return whether a response is an HTML page rather than an answer from Akahu itself"""
    return "html" in response.headers.get("content-type", "").lower() or response.text.lstrip().startswith("<")
