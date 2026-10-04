"""SimpleFIN adapter: claims setup tokens and reads accounts over protocol version 2

The Access URL embeds the credentials, and a setup token's claim URL is itself a secret, so
neither appears in a request URL, a log, an exception or a reason. Only the host is ever named
"""

import base64
import logging
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime, time, timedelta
from typing import override
from zoneinfo import ZoneInfo

import httpx

from app.config.bank_sync import BANK_SYNC_SIMPLEFIN_ORIGINS, BANK_SYNC_SIMPLEFIN_TEST_ORIGIN
from app.config.runtime import APP_VERSION
from app.http_client import ResponseTooLargeError
from app.services.bank_sync.outbound import AddressRefused, OriginRefused, OutboundGuard
from app.services.bank_sync.providers.contract import (
    ClaimRefused,
    ConnectsFrom,
    FetchResult,
    ProviderAdapter,
    ProviderError,
    ProviderErrorKind,
    ProviderUnreachable,
)
from app.services.bank_sync.providers.simplefin.account_set import (
    RecordDating,
    UnreadableAccountSet,
    read_account_set,
    read_external_accounts,
)
from app.services.bank_sync.providers.simplefin.errlist import CREDENTIAL_REJECTED_MESSAGE, RATE_LIMITED_MESSAGE, fetch_result

logger = logging.getLogger(__name__)

# Every request names the app and its version
_HEADERS = {"User-Agent": f"LuminaFinance/{APP_VERSION}" if APP_VERSION else "LuminaFinance"}

# Version 2 carries each account's bank login and the structured errlist. SimpleFIN Bridge still
# answers version 1 to a client that doesn't ask
_PROTOCOL_VERSION = ("version", "2")

_SETUP_UNREADABLE_MESSAGE = "That doesn't look like a SimpleFIN setup token. Copy the whole token from SimpleFIN Bridge and try again"
_SETUP_HOST_NOT_ALLOWED_MESSAGE = "This setup token points to {host}, which this Lumina Finance server is not set up to contact"
_SETUP_ALREADY_USED_MESSAGE = "This setup token has already been used. Create a new one in SimpleFIN Bridge"
_UNREACHABLE_MESSAGE = "SimpleFIN Bridge couldn't be reached"
_UNREADABLE_MESSAGE = "SimpleFIN Bridge sent a response Lumina Finance couldn't read"
_TIMED_OUT_MESSAGE = "SimpleFIN Bridge did not respond in time"
_PAYMENT_MESSAGE = "SimpleFIN Bridge reports a payment problem"
_SERVER_NOT_ALLOWED_MESSAGE = "This Lumina Finance server is not set up to contact {host}"


class SimpleFinAdapter(ProviderAdapter):
    """SimpleFIN, reached through SimpleFIN Bridge or an operator's own SimpleFIN server"""

    provider_id = "simplefin"
    provider_name = "SimpleFIN"
    history_limit_months = 12
    advertises_history = False
    revisit_overlap_days = 14

    # SimpleFIN Bridge refuses an accounts request spanning more
    max_window_days = 90

    # Below the 24 a day SimpleFIN Bridge expects, so setup and retries never earn a warning
    daily_request_budget = 20
    connects_from = ConnectsFrom.SETTINGS

    def __init__(self, guard: OutboundGuard | None = None) -> None:
        """Build the adapter over the configured origins, or over a guard tests supply

        Args:
            guard: The guard requests go through
        """
        self._guard = guard or OutboundGuard(BANK_SYNC_SIMPLEFIN_ORIGINS, BANK_SYNC_SIMPLEFIN_TEST_ORIGIN)

    @override
    async def claim(self, supplied_credential: str) -> str:
        claim_url = self._decode_setup_token(supplied_credential)
        try:
            response = await self._guard.send("POST", claim_url, headers=_HEADERS, content=b"")
        except AddressRefused:
            logger.warning("Refused to claim a SimpleFIN setup token from %s, which resolves to an address that isn't public", claim_url.host)
            raise ClaimRefused(_SETUP_HOST_NOT_ALLOWED_MESSAGE.format(host=claim_url.host)) from None
        except httpx.RequestError:
            raise ProviderUnreachable(_UNREACHABLE_MESSAGE) from None

        # SimpleFIN answers a used or unknown token with a 403, while the edge in front of it
        # answers its own failures with an HTML page
        if response.status_code == 403 and not _is_html(response):
            raise ClaimRefused(_SETUP_ALREADY_USED_MESSAGE)

        # A payment problem is the user's to settle with SimpleFIN Bridge, so it is named rather
        # than passed off as the Bridge being unreachable
        if response.status_code == 402:
            raise ClaimRefused(_PAYMENT_MESSAGE)
        if response.status_code != 200:
            raise ProviderUnreachable(_UNREACHABLE_MESSAGE)

        access_url = response.text.strip()
        try:
            base_url, _ = _split_access_url(access_url)
        except ValueError:
            raise ProviderUnreachable(_UNREACHABLE_MESSAGE) from None
        try:
            self._guard.check_origin(base_url)
        except OriginRefused:
            raise ClaimRefused(_SETUP_HOST_NOT_ALLOWED_MESSAGE.format(host=base_url.host)) from None
        return access_url

    @override
    async def discover(self, credential: str, *, currency_exponents: Mapping[str, int]) -> FetchResult:
        params = [_PROTOCOL_VERSION, ("balances-only", "1")]
        return await self._read_accounts(credential, params, currency_exponents=currency_exponents, dating=None)

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
            raise ValueError("A SimpleFIN window needs timezone-aware start and end times")

        # Elapsed time, as SimpleFIN Bridge measures it, so a window crossing a clock change can't
        # run an hour past the limit and be refused on every retry
        elapsed = end.astimezone(UTC) - start.astimezone(UTC)
        if not timedelta(0) < elapsed <= timedelta(days=self.max_window_days):
            raise ValueError(f"A SimpleFIN window must end after it starts and span at most {self.max_window_days} days")

        # start-date is inclusive and end-date exclusive, both in epoch seconds
        params = [_PROTOCOL_VERSION, ("start-date", str(int(start.timestamp()))), ("end-date", str(int(end.timestamp())))]

        # Pending records are still settling, so only a window that reaches today asks for them
        today = datetime.now(timezone).date()
        if include_pending and end > datetime.combine(today, time.min, tzinfo=timezone):
            params.append(("pending", "1"))
        params.extend(("account", account_id) for account_id in account_ids)

        dating = RecordDating(timezone=timezone, requested_on=today)
        return await self._read_accounts(
            credential, params, currency_exponents=currency_exponents, dating=dating, requested_account_ids=account_ids
        )

    def _decode_setup_token(self, setup_token: str) -> httpx.URL:
        """Return the claim URL a setup token holds, once the guard allows its origin

        Raises:
            ClaimRefused: The token isn't a SimpleFIN setup token, or points somewhere not allowed
        """
        # Copying a token can add line breaks or drop its padding
        compact = "".join(setup_token.split())
        try:
            claim_url = httpx.URL(base64.b64decode(compact + "=" * (-len(compact) % 4), validate=True).decode("ascii"))
        except ValueError, httpx.InvalidURL:
            raise ClaimRefused(_SETUP_UNREADABLE_MESSAGE) from None
        if claim_url.scheme not in ("http", "https") or not claim_url.host or claim_url.userinfo:
            raise ClaimRefused(_SETUP_UNREADABLE_MESSAGE)

        try:
            self._guard.check_origin(claim_url)
        except OriginRefused:
            if claim_url.scheme == "https":
                raise ClaimRefused(_SETUP_HOST_NOT_ALLOWED_MESSAGE.format(host=claim_url.host)) from None
            raise ClaimRefused(_SETUP_UNREADABLE_MESSAGE) from None
        return claim_url

    async def _read_accounts(
        self,
        credential: str,
        params: list[tuple[str, str]],
        *,
        currency_exponents: Mapping[str, int],
        dating: RecordDating | None,
        requested_account_ids: Sequence[str] = (),
    ) -> FetchResult:
        """Send one accounts request and normalize what comes back, or why nothing usable did"""
        base_url, auth = _split_access_url(credential)
        accounts_url = base_url.copy_with(path=f"{base_url.path.rstrip('/')}/accounts")
        try:
            response = await self._guard.send("GET", accounts_url, headers=_HEADERS, params=params, auth=auth)

        # The operator has stopped allowing the server this connection was made with
        except OriginRefused:
            return _failed(ProviderErrorKind.CREDENTIAL_REJECTED, _SERVER_NOT_ALLOWED_MESSAGE.format(host=base_url.host))
        except AddressRefused:
            logger.warning("Refused to reach SimpleFIN at %s, which resolves to an address that isn't public", base_url.host)
            return _failed(ProviderErrorKind.TEMPORARY, _UNREACHABLE_MESSAGE)
        except ResponseTooLargeError:
            return _failed(ProviderErrorKind.TEMPORARY, _UNREADABLE_MESSAGE)

        # A lookup or connection that ran out of time never reached the Bridge
        except httpx.ConnectTimeout:
            return _failed(ProviderErrorKind.TEMPORARY, _UNREACHABLE_MESSAGE)
        except httpx.TimeoutException:
            return _failed(ProviderErrorKind.TEMPORARY, _TIMED_OUT_MESSAGE)
        except httpx.RequestError:
            return _failed(ProviderErrorKind.TEMPORARY, _UNREACHABLE_MESSAGE)
        if response.status_code != 200:
            return FetchResult(request_error=_status_error(response))

        try:
            account_set = read_account_set(response.content)
            accounts = read_external_accounts(account_set, currency_exponents=currency_exponents, dating=dating)
        except UnreadableAccountSet:
            return _failed(ProviderErrorKind.TEMPORARY, _UNREADABLE_MESSAGE)
        return fetch_result(account_set, accounts, requested_account_ids=requested_account_ids)


def _failed(kind: ProviderErrorKind, reason: str) -> FetchResult:
    """Return a result failing every account in the request"""
    return FetchResult(request_error=ProviderError(kind, reason))


def _status_error(response: httpx.Response) -> ProviderError:
    """Return the failure an accounts response with a status other than 200 stands for"""
    status = response.status_code

    # SimpleFIN answers a revoked or unknown Access URL with a 403, while the edge in front of it
    # answers its own failures with an HTML page
    if status == 403 and not _is_html(response):
        return ProviderError(ProviderErrorKind.CREDENTIAL_REJECTED, CREDENTIAL_REJECTED_MESSAGE)
    if status == 429:
        return ProviderError(ProviderErrorKind.RATE_LIMITED, RATE_LIMITED_MESSAGE)
    if status == 402:
        return ProviderError(ProviderErrorKind.PAYMENT_REQUIRED, _PAYMENT_MESSAGE)
    if status == 403 or status >= 500:
        return ProviderError(ProviderErrorKind.TEMPORARY, _UNREACHABLE_MESSAGE)
    return ProviderError(ProviderErrorKind.UNKNOWN, _UNREADABLE_MESSAGE)


def _is_html(response: httpx.Response) -> bool:
    """Return whether a response is an HTML page rather than an answer from SimpleFIN itself"""
    return "html" in response.headers.get("content-type", "").lower() or response.text.lstrip().startswith("<")


def _split_access_url(access_url: str) -> tuple[httpx.URL, httpx.BasicAuth]:
    """Split an Access URL into where requests go and the credentials they carry

    Args:
        access_url: The Access URL, with its credentials as user info

    Returns:
        The URL without user info, and the credentials to send as HTTP Basic

    Raises:
        ValueError: The text isn't a URL carrying a username and password. The message never repeats it
    """
    try:
        url = httpx.URL(access_url)
    except httpx.InvalidURL:
        raise ValueError("The Access URL is not a URL") from None
    if not url.host or not url.username or not url.password:
        raise ValueError("The Access URL carries no credentials")
    return url.copy_with(username=None, password=None), httpx.BasicAuth(url.username, url.password)
