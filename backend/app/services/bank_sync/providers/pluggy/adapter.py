"""Pluggy adapter: reads accounts, balances and transactions through a Pluggy application

The client secret is sent only in the body of the sign-in request, and the key it returns only in a
header, so neither appears in a request URL, a log, an exception or a reason. Only the host is ever
named. Pluggy has no call that lists an application's bank connections, so the user pastes the IDs
of the items to read. Each operation signs in once and reads those items, a few requests at a time
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
from app.services.bank_sync.providers.pluggy.config import (
    PLUGGY_DAILY_REQUESTS,
    PLUGGY_ORIGIN,
    PLUGGY_TEST_ORIGIN,
    PROVIDER_ID,
    warn_if_test_origin_set,
)
from app.services.bank_sync.providers.pluggy.wire import (
    TRANSACTIONS_PATH,
    UnreadableResponse,
    WireAccount,
    WireItem,
    exponent_of,
    external_account,
    read_account_page,
    read_api_key,
    read_item,
    read_transaction_page,
)

logger = logging.getLogger(__name__)

# Every request names the app and its version
_USER_AGENT = f"LuminaFinance/{APP_VERSION}" if APP_VERSION else "LuminaFinance"

# The names the claim sends the three fields under
CLIENT_ID_FIELD = "client_id"
CLIENT_SECRET_FIELD = "client_secret"  # noqa: S105 - a field name, not a secret
ITEM_IDS_FIELD = "item_ids"

# Pluggy's client ID and secret are 36 characters, so this leaves room to spare. The providers list
# sends the same limit to the Connect dialogue
MAX_KEY_LENGTH = 128
_KEY_SHAPE = re.compile(r"[!-~]+")

# Room for a couple of dozen 36-character item IDs and their separators
MAX_ITEM_IDS_LENGTH = 1024
_ITEM_ID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
_ITEM_SEPARATORS = re.compile(r"[,\s]+")

# The longest an item ID is echoed back in a refusal
_MAX_ECHOED_LENGTH = 40

# Requests to Pluggy in flight at once. Pluggy allows 360 a minute for each endpoint, and a user
# with many accounts would otherwise send all their reads together
MAX_CONCURRENT_REQUESTS = 4

# Pluggy sends up to 500 transactions a page. A cursor that never ends would otherwise keep an
# account's read going for ever, so a read stops after this many pages and says it was cut off
MAX_PAGES_PER_ACCOUNT = 200

# Pluggy reads dates, not instants, so it is asked for a day more on each side and the records outside
# the window are dropped as they are read. That covers every timezone's offset from UTC
_DATE_MARGIN = timedelta(days=1)

_REJECTED_MESSAGE = "Pluggy rejected these keys. Please check the client ID and client secret of your Pluggy application and try again"
_NOT_A_KEY_MESSAGE = "That doesn't look like a Pluggy {noun}. Please copy the whole {noun} from your Pluggy application and try again"
_NOT_AN_ITEM_MESSAGE = (
    '"{item}" doesn\'t look like a Pluggy item ID. Please copy each whole item ID from your application at dashboard.pluggy.ai and try again'
)
_REPEATED_ITEM_MESSAGE = 'The Pluggy item ID "{item}" is listed more than once. Please list each item ID once and try again'
_UNKNOWN_ITEM_MESSAGE = (
    'Pluggy doesn\'t have the item ID "{item}" in this application. Please check it in your application at dashboard.pluggy.ai and try again'
)
_CLAIM_UNREACHABLE_MESSAGE = "Lumina Finance couldn't reach Pluggy. Please try again in a few minutes"
_CREDENTIAL_REJECTED_MESSAGE = "Pluggy rejected the stored keys"
_RATE_LIMITED_MESSAGE = "Pluggy asked Lumina Finance to make fewer requests"
_UNREACHABLE_MESSAGE = "Lumina Finance couldn't reach Pluggy"
_UNREADABLE_MESSAGE = "Lumina Finance couldn't read the response from Pluggy"
_TIMED_OUT_MESSAGE = "Pluggy did not respond in time"
_SERVER_NOT_ALLOWED_MESSAGE = "This Lumina Finance server is not set up to contact {host}"
_RECONNECT_MESSAGE = "Pluggy says this bank needs a reconnection. Please reconnect it in Meu Pluggy, then sync again"
_OUTDATED_MESSAGE = "Pluggy hasn't been able to update this bank lately"
_ITEM_GONE_MESSAGE = "Pluggy didn't return one of this connection's items"
_ACCOUNTS_REFUSED_MESSAGE = "Pluggy didn't return the accounts of one of this connection's items"
_ITEMS_UNAVAILABLE_MESSAGE = "Pluggy couldn't give every item right now"
_MISSING_ACCOUNT_MESSAGE = "Pluggy didn't return this account"
_MISSING_OR_UNREADABLE_ACCOUNT_MESSAGE = "Pluggy didn't return this account, or sent it in a form Lumina Finance can't read"
_CUT_OFF_MESSAGE = "Pluggy sent more pages of transactions than Lumina Finance reads at once"
_ACCOUNTS_CUT_OFF_MESSAGE = "Pluggy has more accounts under an item than Lumina Finance reads at once"
_SKIPPED_ONE_ACCOUNT_MESSAGE = "1 account from Pluggy isn't listed: it can't be read"
_SKIPPED_ACCOUNTS_MESSAGE = "{count} accounts from Pluggy aren't listed: they can't be read"
_SKIPPED_ONE_TRANSACTION_MESSAGE = "1 transaction from Pluggy isn't imported: it can't be read"
_SKIPPED_TRANSACTIONS_MESSAGE = "{count} transactions from Pluggy aren't imported: they can't be read"


@dataclass(frozen=True)
class _Credential:
    """What a Pluggy application and its items are reached with"""

    client_id: str
    client_secret: str
    item_ids: tuple[str, ...]


class _Failed(Exception):
    """One request to Pluggy didn't give a usable answer"""

    def __init__(self, error: ProviderError, *, ends_request: bool = False, is_server_refused: bool = False, status: int | None = None) -> None:
        """Hold the failure

        Args:
            error: What went wrong, as the contract reports it
            ends_request: Whether it fails every account of the operation, as a rejected key or a
                spent quota does, instead of only the item or account whose request it was
            is_server_refused: Whether this environment doesn't allow the server the request was for
            status: The HTTP status of the answer, when it was one
        """
        super().__init__(error.reason)
        self.error = error
        self.ends_request = ends_request
        self.is_server_refused = is_server_refused
        self.status = status


class _ItemFailed(_Failed):
    """Pluggy has no such item in the application"""

    def __init__(self, error: ProviderError, item_id: str) -> None:
        """Hold the failure and the item it was for"""
        super().__init__(error)
        self.item_id = item_id


@dataclass(frozen=True)
class _ItemRead:
    """An item and the accounts listed under it"""

    item: WireItem
    accounts: tuple[WireAccount, ...]

    # Whether Pluggy said the list has more pages than the one read
    is_cut_off: bool

    # How many accounts the list holds that couldn't be read
    skipped: int


@dataclass(frozen=True)
class _AccountRead:
    """The records read for one account, whether its pages ran past the cap, and how many transactions couldn't be read"""

    records: tuple[ProviderRecord, ...]
    is_cut_off: bool
    skipped: int


class PluggyAdapter(ProviderAdapter):
    """Pluggy, reached through an application's client ID and client secret and the IDs of its items"""

    provider_id = PROVIDER_ID
    provider_name = "Pluggy"
    display_order = 40
    provider_site = "pluggy.ai"
    provider_description = "One Pluggy application reaches all your Brazilian banks."
    in_beta = True
    credential_fields = (
        CredentialField(CLIENT_ID_FIELD, "Client ID", "Paste the client ID", MAX_KEY_LENGTH),
        CredentialField(CLIENT_SECRET_FIELD, "Client secret", "Paste the client secret", MAX_KEY_LENGTH),
        CredentialField(ITEM_IDS_FIELD, "Item IDs", "Paste the item IDs, separated by commas", MAX_ITEM_IDS_LENGTH),
    )
    connect_steps = (
        "Sign in at dashboard.pluggy.ai, create an application and copy its client ID and client secret.",
        "Connect your banks at meu.pluggy.ai.",
        "Copy each bank's item ID from your application at dashboard.pluggy.ai.",
        "Paste them here. Lumina Finance uses them to read your accounts and never sees your bank login.",
    )

    # Brazil's Open Finance shares 12 months of history, and some banks hold less
    history_limit_months = 12
    advertises_history = False
    revisit_overlap_days = 14

    # Pluggy documents no limit on a range, so this keeps an account's pages to a size one read holds
    max_window_days = 90
    daily_request_budget = PLUGGY_DAILY_REQUESTS
    connects_from = ConnectsFrom.SETTINGS

    @override
    @classmethod
    def on_startup(cls) -> None:
        warn_if_test_origin_set()

    def __init__(self, guard: OutboundGuard | None = None) -> None:
        """Build the adapter over Pluggy, or over a guard tests supply

        Args:
            guard: The guard requests go through
        """
        self._guard = guard or OutboundGuard([PLUGGY_ORIGIN], PLUGGY_TEST_ORIGIN)
        self._api_url = httpx.URL(PLUGGY_TEST_ORIGIN or PLUGGY_ORIGIN)

    @override
    async def claim(self, supplied: Mapping[str, str]) -> str:
        credential = _Credential(
            _read_key(supplied, CLIENT_ID_FIELD, "client ID"),
            _read_key(supplied, CLIENT_SECRET_FIELD, "client secret"),
            _read_item_ids(supplied[ITEM_IDS_FIELD]),
        )
        try:
            api_key = await self._sign_in(credential)
            results = await self._each(credential.item_ids, lambda item_id: self._get_claimed_item(api_key, item_id))
            for result in results:
                if isinstance(result, _Failed):
                    raise result
        except _Failed as failed:
            if failed.error.kind is ProviderErrorKind.CREDENTIAL_REJECTED:
                raise ClaimRefused(_REJECTED_MESSAGE) from None
            if failed.is_server_refused:
                raise ClaimRefused(failed.error.reason) from None
            if isinstance(failed, _ItemFailed):
                raise ClaimRefused(_UNKNOWN_ITEM_MESSAGE.format(item=failed.item_id)) from None
            raise ProviderUnreachable(_CLAIM_UNREACHABLE_MESSAGE) from None
        return json.dumps(
            {CLIENT_ID_FIELD: credential.client_id, CLIENT_SECRET_FIELD: credential.client_secret, ITEM_IDS_FIELD: list(credential.item_ids)}
        )

    @override
    def server_host(self, credential: str) -> str:
        return self._api_url.host

    @override
    async def discover(self, credential: str, *, currency_exponents: Mapping[str, int]) -> FetchResult:
        read_at = datetime.now(UTC)
        try:
            _, reads, failures = await self._read_items(_credential_of(credential))
        except _Failed as failed:
            return FetchResult(request_error=failed.error)
        accounts, account_errors = _accounts_of(reads, [], currency_exponents, read_at, {})
        is_accounts_cut_off = any(read.is_cut_off for read in reads)
        return FetchResult(
            accounts=tuple(accounts),
            account_errors=account_errors,
            login_errors=_login_errors(reads),
            warnings=(
                *(failure.error for failure in failures),
                *((ProviderError(ProviderErrorKind.UNKNOWN, _ACCOUNTS_CUT_OFF_MESSAGE),) if is_accounts_cut_off else ()),
                *_skipped_warnings(sum(read.skipped for read in reads), 0),
            ),
            possibly_cut_off=is_accounts_cut_off,
        )

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
            raise ValueError("A Pluggy window needs timezone-aware start and end times")
        elapsed = end.astimezone(UTC) - start.astimezone(UTC)
        if not timedelta(0) < elapsed <= timedelta(days=self.max_window_days):
            raise ValueError(f"A Pluggy window must end after it starts and span at most {self.max_window_days} days")

        parsed = _credential_of(credential)
        read_at = datetime.now(UTC)
        dates = [
            ("dateFrom", (start.astimezone(UTC) - _DATE_MARGIN).date().isoformat()),
            ("dateTo", (end.astimezone(UTC) + _DATE_MARGIN).date().isoformat()),
        ]
        try:
            api_key, reads, failures = await self._read_items(parsed)
            readable = {
                account.id: account for read in reads if read.item.is_readable for account in read.accounts if account.id in account_ids
            }
            account_reads = dict(
                zip(
                    readable,
                    await self._each(
                        list(readable.values()),
                        lambda account: self._read_account(
                            api_key, account, dates, exponent_of(account, currency_exponents), timezone, start, end, include_pending
                        ),
                    ),
                    strict=True,
                )
            )
        except _Failed as failed:
            return FetchResult(request_error=failed.error)

        records: dict[str, tuple[ProviderRecord, ...]] = {}
        read_errors: dict[str, ProviderError] = {}
        is_cut_off = False
        skipped_transactions = 0
        for account_id, read in account_reads.items():
            if isinstance(read, _Failed):
                read_errors[account_id] = read.error
                continue
            records[account_id] = read.records
            is_cut_off = is_cut_off or read.is_cut_off
            skipped_transactions += read.skipped
        accounts, account_errors = _accounts_of(reads, account_ids, currency_exponents, read_at, records)
        account_errors = {**account_errors, **read_errors}
        accounts = [found for found in accounts if found.external_id not in read_errors]

        # Nothing maps an account to its item, so an account no item listed may be on an item that
        # failed or be gone. While an item is having an outage the account is told as temporary,
        # blaming none, and otherwise it is gone, or is an entry of a list that couldn't be read. The
        # warning for those entries is left to discovery, since a fetch asks for only some accounts
        has_outage = any(failure.error.kind is ProviderErrorKind.TEMPORARY for failure in failures)
        has_unreadable = any(read.skipped for read in reads)
        if has_outage:
            unlisted = ProviderError(ProviderErrorKind.TEMPORARY, _ITEMS_UNAVAILABLE_MESSAGE)
        else:
            unlisted = ProviderError(
                ProviderErrorKind.UNKNOWN, _MISSING_OR_UNREADABLE_ACCOUNT_MESSAGE if has_unreadable else _MISSING_ACCOUNT_MESSAGE
            )
        listed_ids = {account.id for read in reads for account in read.accounts}
        for account_id in account_ids:
            if account_id not in listed_ids:
                account_errors[account_id] = unlisted
        is_accounts_cut_off = any(read.is_cut_off for read in reads)
        warnings = (
            *(failure.error for failure in failures),
            *((ProviderError(ProviderErrorKind.UNKNOWN, _ACCOUNTS_CUT_OFF_MESSAGE),) if is_accounts_cut_off else ()),
            *((ProviderError(ProviderErrorKind.UNKNOWN, _CUT_OFF_MESSAGE),) if is_cut_off else ()),
            *_skipped_warnings(0, skipped_transactions),
        )
        return FetchResult(
            accounts=tuple(accounts),
            account_errors=account_errors,
            login_errors=_login_errors([read for read in reads if any(account.id in account_ids for account in read.accounts)]),
            warnings=warnings,
            # A longer accounts list only warns. The engine halves a window flagged as cut off and never
            # clears the flag, so one item with more accounts would split every sync for ever
            possibly_cut_off=is_cut_off,
        )

    async def _read_items(self, credential: _Credential) -> tuple[str, list[_ItemRead], list[_Failed]]:
        """Sign in and read each item with its accounts

        Returns:
            The key the requests carry, the items read, and the failure of each item that alone failed

        Raises:
            _Failed: A failure that ends the request
        """
        api_key = await self._sign_in(credential)
        results = await self._each(credential.item_ids, lambda item_id: self._read_item(api_key, item_id))
        reads = [result for result in results if isinstance(result, _ItemRead)]
        failures = [result for result in results if isinstance(result, _Failed)]

        # With no item read, an empty answer would look like accounts that vanished, so it fails the request
        if failures and not reads:
            raise failures[0]
        return api_key, reads, failures

    async def _read_item(self, api_key: str, item_id: str) -> _ItemRead:
        """Read one item and list its accounts

        Raises:
            _Failed: A request failed or an answer couldn't be read
        """
        item = await self._get_item(api_key, item_id)

        # Pluggy publishes no page parameter for the list, so only the item is sent and a list that
        # says it has more pages is read as far as it goes
        try:
            body = await self._request("GET", "/accounts", api_key, params=[("itemId", item_id)])
        except _Failed as failed:
            # Pluggy returned this item a moment ago, so a refusal of its list isn't the keys' fault
            if failed.status in (400, 404):
                raise _Failed(ProviderError(ProviderErrorKind.UNKNOWN, _ACCOUNTS_REFUSED_MESSAGE)) from None
            raise
        try:
            page = read_account_page(body)
        except UnreadableResponse:
            raise _Failed(ProviderError(ProviderErrorKind.UNKNOWN, _UNREADABLE_MESSAGE)) from None
        return _ItemRead(item, page.accounts, is_cut_off=page.total_pages > 1, skipped=page.skipped)

    async def _get_claimed_item(self, api_key: str, item_id: str) -> WireItem:
        """Read one item a user has just typed in

        A typed ID can pass the shape check and still be refused with a 400, and trying again never
        helps, so the claim names it as it does an item Pluggy doesn't have

        Raises:
            _ItemFailed: Pluggy has no such item, or refused its ID
            _Failed: The request failed or its answer couldn't be read
        """
        try:
            return await self._get_item(api_key, item_id)
        except _ItemFailed:
            raise
        except _Failed as failed:
            if failed.status == 400:
                raise _ItemFailed(failed.error, item_id) from None
            raise

    async def _get_item(self, api_key: str, item_id: str) -> WireItem:
        """Read one item

        Raises:
            _ItemFailed: Pluggy has no such item in the application
            _Failed: The request failed or its answer couldn't be read
        """
        try:
            return read_item(await self._request("GET", f"/items/{item_id}", api_key))
        except UnreadableResponse:
            raise _Failed(ProviderError(ProviderErrorKind.UNKNOWN, _UNREADABLE_MESSAGE)) from None
        except _Failed as failed:
            # Pluggy answers an item that isn't the application's with a 404, and a 403 is a rejected key
            if failed.status == 404:
                raise _ItemFailed(ProviderError(ProviderErrorKind.UNKNOWN, _ITEM_GONE_MESSAGE), item_id) from None
            raise

    async def _sign_in(self, credential: _Credential) -> str:
        """Exchange the client ID and secret for the key the other requests carry

        Raises:
            _Failed: The request failed, or Pluggy rejected the pair
        """
        body = json.dumps({"clientId": credential.client_id, "clientSecret": credential.client_secret}).encode()
        try:
            return read_api_key(await self._request("POST", "/auth", None, content=body))
        except UnreadableResponse:
            raise _Failed(ProviderError(ProviderErrorKind.UNKNOWN, _UNREADABLE_MESSAGE), ends_request=True) from None
        except _Failed as failed:
            # Pluggy answers a pair it doesn't know with a 401, and a malformed one with a 400
            if failed.status in (400, 401, 403) and failed.error.kind is not ProviderErrorKind.TEMPORARY:
                raise _Failed(ProviderError(ProviderErrorKind.CREDENTIAL_REJECTED, _CREDENTIAL_REJECTED_MESSAGE), ends_request=True) from None
            raise

    async def _read_account(
        self,
        api_key: str,
        account: WireAccount,
        dates: list[tuple[str, str]],
        exponent: int | None,
        timezone: ZoneInfo,
        start: datetime,
        end: datetime,
        include_pending: bool,
    ) -> _AccountRead:
        """Read every page of one account's transactions, following the cursor Pluggy gives

        Each page is asked for with the account and dates of the first and only the position Pluggy
        gives, since Pluggy's cursor may leave the dates out
        """
        records: list[ProviderRecord] = []
        window: list[tuple[str, str]] = [("accountId", account.id), *dates]
        query = window
        seen: set[str] = set()
        skipped = 0
        for _ in range(MAX_PAGES_PER_ACCOUNT):
            body = await self._request("GET", TRANSACTIONS_PATH, api_key, params=query)
            try:
                page = read_transaction_page(
                    body, account, exponent=exponent, timezone=timezone, start=start, end=end, include_pending=include_pending
                )
            except UnreadableResponse:
                raise _Failed(ProviderError(ProviderErrorKind.UNKNOWN, _UNREADABLE_MESSAGE)) from None
            records.extend(page.records)
            skipped += page.skipped
            if page.next_after is None:
                return _AccountRead(tuple(records), is_cut_off=False, skipped=skipped)

            # A cursor Pluggy repeats would loop for ever, so it is refused as unreadable
            if page.next_after in seen:
                logger.warning("Pluggy's answer to a transaction list doesn't fit its documented shape at next (repeated)")
                raise _Failed(ProviderError(ProviderErrorKind.UNKNOWN, _UNREADABLE_MESSAGE))
            seen.add(page.next_after)
            query = [*window, ("after", page.next_after)]
        return _AccountRead(tuple(records), is_cut_off=True, skipped=skipped)

    async def _each[K, T](self, keys: Sequence[K], read: Callable[[K], Awaitable[T]]) -> list[T | _Failed]:
        """Run a read for each item or account, a few at a time, keeping a failure under its own entry

        A failure that ends the request stops the reads not yet started, since the key or the
        quota they would be sent with has just been refused

        Returns:
            The result or failure of each key, in the order of the keys

        Raises:
            _Failed: A failure that ends the request
        """
        slots = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)
        ended: _Failed | None = None

        async def run(key: K) -> T | _Failed:
            """Run one read once a slot is free"""
            nonlocal ended
            async with slots:
                if ended is not None:
                    return ended
                try:
                    return await read(key)
                except _Failed as failed:
                    if failed.ends_request:
                        ended = failed
                    return failed

        results = await asyncio.gather(*(run(key) for key in keys))
        if ended is not None:
            raise ended
        return results

    async def _request(
        self, method: str, path: str, api_key: str | None, *, params: Sequence[tuple[str, str]] | None = None, content: bytes | None = None
    ) -> bytes:
        """Send one request and return the body of a 200 answer

        Raises:
            _Failed: The request didn't reach Pluggy, or the answer wasn't a 200
        """
        url = self._api_url.copy_with(path=path)
        headers = {"User-Agent": _USER_AGENT, "Accept": "application/json"}
        if api_key is not None:
            headers["X-API-KEY"] = api_key
        if content is not None:
            headers["Content-Type"] = "application/json"
        try:
            response = await self._guard.send(method, url, headers=headers, params=params, content=content)

        # The environment no longer allows the server this connection was made with, or a
        # development instance allows only its fake Pluggy. Neither says anything about the keys,
        # so the connection isn't marked for reconnecting and its owner isn't emailed
        except OriginRefused:
            raise _Failed(
                ProviderError(ProviderErrorKind.UNKNOWN, _SERVER_NOT_ALLOWED_MESSAGE.format(host=url.host)),
                ends_request=True,
                is_server_refused=True,
            ) from None
        except AddressRefused:
            logger.warning("Refused to reach Pluggy at %s because it resolves to an address that isn't public", url.host)
            raise _Failed(ProviderError(ProviderErrorKind.TEMPORARY, _UNREACHABLE_MESSAGE), ends_request=True) from None
        except ResponseTooLargeError:
            raise _Failed(ProviderError(ProviderErrorKind.UNKNOWN, _UNREADABLE_MESSAGE)) from None

        # A lookup or connection that ran out of time never reached Pluggy
        except httpx.ConnectTimeout:
            raise _Failed(ProviderError(ProviderErrorKind.TEMPORARY, _UNREACHABLE_MESSAGE)) from None
        except httpx.TimeoutException:
            raise _Failed(ProviderError(ProviderErrorKind.TEMPORARY, _TIMED_OUT_MESSAGE)) from None
        except httpx.RequestError:
            raise _Failed(ProviderError(ProviderErrorKind.TEMPORARY, _UNREACHABLE_MESSAGE)) from None
        if response.status_code != 200:
            raise _status_failure(response)
        return response.content


def _read_key(supplied: Mapping[str, str], key: str, noun: str) -> str:
    """Return one pasted key, trimmed

    Raises:
        ClaimRefused: The key can't be a client ID or secret
    """
    value = supplied[key].strip()
    if not value or len(value) > MAX_KEY_LENGTH or not _KEY_SHAPE.fullmatch(value):
        raise ClaimRefused(_NOT_A_KEY_MESSAGE.format(noun=noun))
    return value


def _read_item_ids(text: str) -> tuple[str, ...]:
    """Return the item IDs pasted, separated by commas or spaces, each a UUID and none repeated

    Raises:
        ClaimRefused: An entry isn't an item ID or is listed twice, named in the message
    """
    found: list[str] = []
    for entry in _ITEM_SEPARATORS.split(text.strip()):
        if not entry:
            continue
        item_id = entry.lower()
        shown = entry if len(entry) <= _MAX_ECHOED_LENGTH else f"{entry[:_MAX_ECHOED_LENGTH]}…"
        if not _ITEM_ID.fullmatch(item_id):
            raise ClaimRefused(_NOT_AN_ITEM_MESSAGE.format(item=shown))
        if item_id in found:
            raise ClaimRefused(_REPEATED_ITEM_MESSAGE.format(item=shown))
        found.append(item_id)
    if not found:
        raise ClaimRefused(_NOT_AN_ITEM_MESSAGE.format(item=""))
    return tuple(found)


def _credential_of(credential: str) -> _Credential:
    """Return what a stored credential holds"""
    stored = json.loads(credential)
    return _Credential(stored[CLIENT_ID_FIELD], stored[CLIENT_SECRET_FIELD], tuple(stored[ITEM_IDS_FIELD]))


def _accounts_of(
    reads: Sequence[_ItemRead],
    account_ids: Sequence[str],
    currency_exponents: Mapping[str, int],
    read_at: datetime,
    records: Mapping[str, tuple[ProviderRecord, ...]],
) -> tuple[list[ExternalAccount], dict[str, ProviderError]]:
    """Return the accounts of the items in the contract's form, and the error of each whose item is out of date

    Args:
        reads: The items and their accounts
        account_ids: The accounts wanted, or none for every account
        currency_exponents: Minor-unit exponent of every currency Lumina Finance holds, by code
        read_at: When the items were read
        records: The records read for each account, by its id
    """
    accounts: list[ExternalAccount] = []
    errors: dict[str, ProviderError] = {}
    for read in reads:
        for account in read.accounts:
            if account_ids and account.id not in account_ids:
                continue
            accounts.append(
                external_account(
                    account, read.item, currency_exponents=currency_exponents, balance_at=read_at, records=records.get(account.id, ())
                )
            )

            # An item that needs its user is a login error. One that is merely behind is an outage
            if not read.item.is_readable and not read.item.needs_login:
                errors[account.id] = ProviderError(ProviderErrorKind.TEMPORARY, _OUTDATED_MESSAGE)
    return accounts, errors


def _skipped_warnings(accounts: int, transactions: int) -> tuple[ProviderError, ...]:
    """Return a warning for the accounts and one for the transactions Pluggy sent that couldn't be read, when there are any"""
    messages = []
    if accounts:
        messages.append(_SKIPPED_ONE_ACCOUNT_MESSAGE if accounts == 1 else _SKIPPED_ACCOUNTS_MESSAGE.format(count=accounts))
    if transactions:
        messages.append(_SKIPPED_ONE_TRANSACTION_MESSAGE if transactions == 1 else _SKIPPED_TRANSACTIONS_MESSAGE.format(count=transactions))
    return tuple(ProviderError(ProviderErrorKind.UNKNOWN, message) for message in messages)


def _login_errors(reads: Sequence[_ItemRead]) -> dict[str, ProviderError]:
    """Return the error of each item that needs its user, keyed by item ID"""
    return {read.item.id: ProviderError(ProviderErrorKind.BANK_LOGIN_NEEDED, _RECONNECT_MESSAGE) for read in reads if read.item.needs_login}


def _status_failure(response: httpx.Response) -> _Failed:
    """Return the failure an answer with a status other than 200 stands for"""
    status = response.status_code

    # Only the path is named, and an item's ID is left out of it, since no ID or key belongs in a log
    path = response.request.url.path
    logger.warning("Pluggy answered %s with status %s", "/items/{id}" if path.startswith("/items/") else path, status)

    # The edge in front of Pluggy answers its own failures with an HTML page that says nothing about the keys
    if status in (401, 403) and not _is_html(response):
        return _Failed(ProviderError(ProviderErrorKind.CREDENTIAL_REJECTED, _CREDENTIAL_REJECTED_MESSAGE), ends_request=True, status=status)
    if status == 429:
        return _Failed(ProviderError(ProviderErrorKind.RATE_LIMITED, _RATE_LIMITED_MESSAGE), ends_request=True, status=status)
    if status in (401, 403) or status >= 500:
        return _Failed(ProviderError(ProviderErrorKind.TEMPORARY, _UNREACHABLE_MESSAGE), status=status)
    return _Failed(ProviderError(ProviderErrorKind.UNKNOWN, _UNREADABLE_MESSAGE), status=status)


def _is_html(response: httpx.Response) -> bool:
    """Return whether a response is an HTML page rather than an answer from Pluggy itself"""
    return "html" in response.headers.get("content-type", "").lower() or response.text.lstrip().startswith("<")
