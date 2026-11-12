"""SimpleFIN adapter: claims setup tokens and reads accounts over protocol version 2

The Access URL embeds the credentials, and a setup token's claim URL is itself a secret, so
neither appears in a request URL, a log, an exception or a reason. Only the host is ever named
"""

import base64
import logging
from collections.abc import Mapping, Sequence
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
from app.services.bank_sync.providers.simplefin.config import (
    PROVIDER_ID,
    SIMPLEFIN_DAILY_REQUESTS,
    SIMPLEFIN_HISTORY_MONTHS,
    SIMPLEFIN_ORIGINS,
    SIMPLEFIN_TEST_ORIGIN,
    warn_if_test_origin_set,
)
from app.services.bank_sync.providers.simplefin.errlist import CREDENTIAL_REJECTED_MESSAGE, RATE_LIMITED_MESSAGE, fetch_result

logger = logging.getLogger(__name__)

# Every request names the app and its version
_HEADERS = {"User-Agent": f"LuminaFinance/{APP_VERSION}" if APP_VERSION else "LuminaFinance"}

# Version 2 carries each account's bank login and the structured errlist. SimpleFIN Bridge still
# answers version 1 to a client that doesn't ask
_PROTOCOL_VERSION = ("version", "2")

# A setup token is the base64 of one claim URL, about 100 characters, so this leaves room to spare.
# The Connect dialogue holds the same limit. The providers list sends it
MAX_SETUP_TOKEN_LENGTH = 2048

# The one credential field. The claim sends the setup token under that name
SETUP_TOKEN_KEY = "setup_token"  # noqa: S105 - a field name, not a secret

_SETUP_BLANK_MESSAGE = "Please paste the setup token from SimpleFIN Bridge"
_SETUP_UNREADABLE_MESSAGE = "That doesn't look like a SimpleFIN setup token. Please copy the whole token from SimpleFIN Bridge and try again"
_SETUP_TOO_LONG_MESSAGE = "That setup token is too long. Please copy only the token from SimpleFIN Bridge and try again"
_CLAIM_UNREACHABLE_MESSAGE = "SimpleFIN Bridge couldn't be reached. Please try again in a few minutes"
_SETUP_HOST_NOT_ALLOWED_MESSAGE = "This setup token points to {host}. This Lumina Finance server isn't set up to contact {host}"
_SETUP_ALREADY_USED_MESSAGE = "This setup token has already been used. Please create a new one in SimpleFIN Bridge"
_UNREACHABLE_MESSAGE = "SimpleFIN Bridge couldn't be reached"
_UNREADABLE_MESSAGE = "SimpleFIN Bridge sent a response Lumina Finance couldn't read"
_TIMED_OUT_MESSAGE = "SimpleFIN Bridge did not respond in time"
_PAYMENT_MESSAGE = "SimpleFIN Bridge reports a payment problem"
_SERVER_NOT_ALLOWED_MESSAGE = "This Lumina Finance server is not set up to contact {host}"


class SimpleFinAdapter(ProviderAdapter):
    """SimpleFIN, reached through SimpleFIN Bridge or another SimpleFIN server set in the environment"""

    provider_id = PROVIDER_ID
    provider_name = "SimpleFIN"
    display_order = 10
    provider_site = "SimpleFIN Bridge"
    provider_description = "One setup token reaches every bank you add in SimpleFIN Bridge."
    credential_fields = (CredentialField(SETUP_TOKEN_KEY, "Setup token", "Paste the token", MAX_SETUP_TOKEN_LENGTH),)
    connect_steps = (
        "Open SimpleFIN Bridge and connect your banks there.",
        "Create a setup token. Each token works once and expires if unused.",
        "Paste the token here. Lumina Finance never sees your bank login.",
    )
    history_limit_months = SIMPLEFIN_HISTORY_MONTHS
    advertises_history = False
    revisit_overlap_days = 14

    # SimpleFIN Bridge refuses an accounts request spanning more
    max_window_days = 90
    daily_request_budget = SIMPLEFIN_DAILY_REQUESTS

    # SimpleFIN Bridge's quota counts accounts requests. A claim spends a one-time setup token instead
    claim_is_counted = False
    connects_from = ConnectsFrom.SETTINGS

    @override
    @classmethod
    def on_startup(cls) -> None:
        warn_if_test_origin_set()

    def __init__(self, guard: OutboundGuard | None = None) -> None:
        """Build the adapter over the configured origins, or over a guard tests supply

        Args:
            guard: The guard requests go through
        """
        self._guard = guard or OutboundGuard(SIMPLEFIN_ORIGINS, SIMPLEFIN_TEST_ORIGIN)

    @override
    async def claim(self, supplied: Mapping[str, str]) -> str:
        return await self.claim_setup_token(supplied[SETUP_TOKEN_KEY])

    async def claim_setup_token(self, supplied_credential: str) -> str:
        """Exchange a setup token for the access URL it claims, checking it again for a caller other than the engine

        Args:
            supplied_credential: The setup token as pasted

        Returns:
            The access URL, to store encrypted

        Raises:
            ClaimRefused: The token is blank, too long, unreadable, already used, or points where
                this server may not reach
            ProviderUnreachable: SimpleFIN Bridge couldn't be reached or gave no usable answer
        """
        if not supplied_credential.strip():
            raise ClaimRefused(_SETUP_BLANK_MESSAGE)
        if len(supplied_credential) > MAX_SETUP_TOKEN_LENGTH:
            raise ClaimRefused(_SETUP_TOO_LONG_MESSAGE)
        claim_url = self._decode_setup_token(supplied_credential)
        try:
            response = await self._guard.send("POST", claim_url, headers=_HEADERS, content=b"")
        except AddressRefused:
            logger.warning("Refused to claim a SimpleFIN setup token from %s: it resolves to an address that isn't public", claim_url.host)
            raise ClaimRefused(_SETUP_HOST_NOT_ALLOWED_MESSAGE.format(host=claim_url.host)) from None
        except httpx.RequestError:
            raise ProviderUnreachable(_CLAIM_UNREACHABLE_MESSAGE) from None

        # SimpleFIN answers a used or unknown token with a 403, while the edge in front of it
        # answers its own failures with an HTML page
        if response.status_code == 403 and not _is_html(response):
            raise ClaimRefused(_SETUP_ALREADY_USED_MESSAGE)

        # A payment problem is the user's to settle with SimpleFIN Bridge, so it is named rather
        # than passed off as the Bridge being unreachable
        if response.status_code == 402:
            raise ClaimRefused(_PAYMENT_MESSAGE)
        if response.status_code != 200:
            raise ProviderUnreachable(_CLAIM_UNREACHABLE_MESSAGE)

        access_url = response.text.strip()
        try:
            base_url, _ = _split_access_url(access_url)
        except ValueError:
            raise ProviderUnreachable(_CLAIM_UNREACHABLE_MESSAGE) from None
        try:
            self._guard.check_origin(base_url)
        except OriginRefused:
            raise ClaimRefused(_SETUP_HOST_NOT_ALLOWED_MESSAGE.format(host=base_url.host)) from None
        return access_url

    @override
    def server_host(self, credential: str) -> str:
        base_url, _ = _split_access_url(credential)
        return base_url.host

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

        # Asked for as the sync says, never checked against this clock's today: a sync that fixed its
        # today before midnight and sends after it still needs the pending set it replaces
        if include_pending:
            params.append(("pending", "1"))
        params.extend(("account", account_id) for account_id in account_ids)

        dating = RecordDating(timezone=timezone, requested_on=datetime.now(timezone).date())
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

        # The environment no longer allows the server this connection was made with, or a
        # development instance allows only its fake Bridge. Neither says anything about the
        # credential, so the connection isn't marked for reconnecting and its owner isn't emailed
        except OriginRefused:
            return _failed(ProviderErrorKind.UNKNOWN, _SERVER_NOT_ALLOWED_MESSAGE.format(host=base_url.host))
        except AddressRefused:
            logger.warning("Refused to reach SimpleFIN at %s: it resolves to an address that isn't public", base_url.host)
            return _failed(ProviderErrorKind.TEMPORARY, _UNREACHABLE_MESSAGE)
        except ResponseTooLargeError:
            return _failed(ProviderErrorKind.UNKNOWN, _UNREADABLE_MESSAGE)

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
            return _failed(ProviderErrorKind.UNKNOWN, _UNREADABLE_MESSAGE)
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
