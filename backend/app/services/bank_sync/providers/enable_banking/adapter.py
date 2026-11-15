"""Enable Banking adapter: reads accounts, balances and transactions through a bank sign-in

The user registers an application with Enable Banking and pastes its ID and private key, then signs in at
one bank. Enable Banking answers that with a session holding the bank accounts shared, which is what the
connection stores along with the key. Every request carries a short-lived token signed with the private
key, so the key never leaves the app in a request, a URL, a log, an exception or a reason. Only the host
is ever named
"""

import asyncio
import json
import logging
import re
import uuid
from collections import Counter
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import override
from zoneinfo import ZoneInfo

import httpx
import jwt
from cryptography.exceptions import UnsupportedAlgorithm
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPrivateKey
from cryptography.hazmat.primitives.serialization import load_pem_private_key

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
    is_iso_currency_code,
)
from app.services.bank_sync.providers.enable_banking.config import (
    ENABLE_BANKING_DAILY_REQUESTS,
    ENABLE_BANKING_ORIGIN,
    ENABLE_BANKING_TEST_ORIGIN,
    PROVIDER_ID,
    warn_if_test_origin_set,
)
from app.services.bank_sync.providers.enable_banking.wire import (
    Balances,
    UnreadableResponse,
    WireAccount,
    exponent_of,
    external_account,
    read_aspsps,
    read_auth_url,
    read_balances,
    read_session,
    read_transaction_page,
)
from app.services.bank_sync.release import release_credential

logger = logging.getLogger(__name__)

# Every request names the app and its version
_USER_AGENT = f"LuminaFinance/{APP_VERSION}" if APP_VERSION else "LuminaFinance"

# The names the sign-in sends the fields under
APPLICATION_ID_FIELD = "application_id"
PRIVATE_KEY_FIELD = "private_key"
COUNTRY_FIELD = "country"
BANK_FIELD = "bank"

MAX_PRIVATE_KEY_LENGTH = 8192
MAX_BANK_LENGTH = 128
_COUNTRY = re.compile(r"[A-Za-z]{2}")
_PRIVATE_KEY = re.compile(r"-----BEGIN ((?:RSA )?PRIVATE KEY)-----(.+?)-----END \1-----", re.DOTALL)
_PEM_LINE_LENGTH = 64

# How long a request's token lives. Enable Banking accepts up to 24 hours, and a request needs seconds
_TOKEN_LIFETIME = timedelta(minutes=10)

# The longest a bank sign-in may last, whatever the bank allows
_MAX_CONSENT = timedelta(days=180)
_DEFAULT_CONSENT = timedelta(days=90)

# Requests in flight at once, one for each account's balances and transactions
MAX_CONCURRENT_REQUESTS = 4

# A bank returns a page of transactions at a time. A key that never ends would otherwise keep an
# account's read going for ever, so a read stops after this many pages and says it was cut off
MAX_PAGES_PER_ACCOUNT = 50

# A read of all an account's history may page through two years, and Enable Banking may send it empty
# pages while it looks for the oldest transaction, so it may take more pages
MAX_PAGES_PER_HISTORY_READ = 200

# Many banks share only this many days of transactions once the hour after sign-in has passed. A window
# starting further back is read with the longest strategy. It reads all the bank still shares from the
# window's start, where the default strategy would refuse the window with WRONG_TRANSACTIONS_PERIOD
_SHARED_DAYS = 90

# Enable Banking reads dates, not instants, so it is asked for a day more on each side and the records
# outside the window are dropped as they are read
_DATE_MARGIN = timedelta(days=1)

# Answers that say the session is over, whatever their status
_SESSION_OVER = frozenset({"EXPIRED_SESSION", "REVOKED_SESSION", "CLOSED_SESSION", "SESSION_DOES_NOT_EXIST", "UNAUTHORIZED_ACCESS"})
_CODE_SPENT = frozenset({"EXPIRED_AUTHORIZATION_CODE", "WRONG_AUTHORIZATION_CODE", "ALREADY_AUTHORIZED"})
_REDIRECT_REFUSED = "REDIRECT_URI_NOT_ALLOWED"

_BAD_ID_MESSAGE = "That doesn't look like an Enable Banking application ID. Please copy the whole application ID and try again"
_BAD_KEY_MESSAGE = (
    "That doesn't look like the private key Enable Banking gave you. Please paste the whole .pem file, "
    "from the BEGIN line to the END line, and try again"
)
_BAD_COUNTRY_MESSAGE = "Please give the bank's country as its two-letter code, such as FI or DE, and try again"
_BAD_BANK_MESSAGE = "Please give the bank's name exactly as Enable Banking lists it and try again"
# The fields a refusal about the bank itself names, so the connect form marks them and not the key
_BANK_FIELDS = (COUNTRY_FIELD, BANK_FIELD)
_UNKNOWN_BANK_MESSAGE = 'We couldn\'t find "{bank}" in {country} on Enable Banking. Please check the name and country'
_REJECTED_MESSAGE = "Enable Banking rejected this application. Please check the application ID and private key and try again"
_REDIRECT_MESSAGE = "Enable Banking doesn't accept {url} for this application. Please add it to the application's redirect URLs and try again"
_START_REFUSED_MESSAGE = "Enable Banking couldn't start a sign-in at that bank. Please check the bank's name and country and try again"
_CODE_SPENT_MESSAGE = "This bank sign-in has expired or was already used. Please connect again"
# A production application in restricted mode reaches only the accounts linked on it, so an unlinked account is left out too
_NO_ACCOUNTS_MESSAGE = (
    "Your bank shared no accounts. Please link the accounts you want on your Enable Banking application, "
    "then connect again and share them at your bank"
)
_CLAIM_REFUSED_MESSAGE = "Enable Banking connects by signing in at your bank. Please use Go to your bank"
_CLAIM_UNREACHABLE_MESSAGE = "Lumina Finance couldn't reach Enable Banking. Please try again in a few minutes"
_CREDENTIAL_REJECTED_MESSAGE = "Enable Banking rejected the stored application key, or the bank sign-in has ended"
_RATE_LIMITED_MESSAGE = "Enable Banking asked Lumina Finance to make fewer requests"
_BANK_LIMITED_MESSAGE = "The bank limits how often accounts can be read without you signed in. The next sync tries again"
_BANK_ACTION_MESSAGE = "The bank needs you to sign in again. Please reconnect this connection"
_BANK_ACTION_CLAIM_MESSAGE = "Your bank needs you to sign in again before it shares your accounts. Please connect again"
_UNREACHABLE_MESSAGE = "Lumina Finance couldn't reach Enable Banking"
_BANK_UNAVAILABLE_MESSAGE = "The bank couldn't give its accounts right now"
_UNREADABLE_MESSAGE = "Lumina Finance couldn't read the response from Enable Banking"
_TIMED_OUT_MESSAGE = "Enable Banking did not respond in time"
_SERVER_NOT_ALLOWED_MESSAGE = "This Lumina Finance server is not set up to contact {host}"
_MISSING_ACCOUNT_MESSAGE = "The bank sign-in doesn't share this account"
_CUT_OFF_MESSAGE = "The bank sent more pages of transactions than Lumina Finance reads at once"
_SKIPPED_ONE_MESSAGE = "1 transaction from Enable Banking isn't imported: it doesn't have the fields Enable Banking documents"
_SKIPPED_MESSAGE = "{count} transactions from Enable Banking aren't imported: they don't have the fields Enable Banking documents"


@dataclass(frozen=True)
class _Credential:
    """What a bank sign-in is reached with: the application's key, the session and the accounts it shares"""

    application_id: str
    private_key: str
    session_id: str
    bank_name: str
    country: str
    accounts: tuple[WireAccount, ...]

    @property
    def institution_key(self) -> str:
        """Identifies the bank, the country keeping two banks of one name apart"""
        return f"{self.country}:{self.bank_name}"


class _Failed(Exception):
    """One request to Enable Banking didn't give a usable answer"""

    def __init__(
        self,
        error: ProviderError,
        *,
        ends_request: bool = False,
        is_server_refused: bool = False,
        status: int | None = None,
        code: str | None = None,
    ) -> None:
        """Hold the failure

        Args:
            error: What went wrong, as the contract reports it
            ends_request: Whether it fails every account of the operation, as a rejected key or a
                spent quota does, instead of only the account whose request it was
            is_server_refused: Whether this environment doesn't allow the server the request was for
            status: The HTTP status of the answer, when it was one
            code: The error code Enable Banking sent, when it sent one
        """
        super().__init__(error.reason)
        self.error = error
        self.ends_request = ends_request
        self.is_server_refused = is_server_refused
        self.status = status
        self.code = code


@dataclass(frozen=True)
class _AccountRead:
    """What was read for one account: its balances and records, and whether its pages ran past the cap"""

    balances: Balances
    records: tuple[ProviderRecord, ...]
    is_cut_off: bool

    # Transactions left out for not fitting the documented shape
    skipped: int = 0


class EnableBankingAdapter(ProviderAdapter):
    """Enable Banking, reached through an application's ID and private key and one bank's sign-in"""

    provider_id = PROVIDER_ID
    provider_name = "Enable Banking"
    display_order = 50
    provider_site = "enablebanking.com"
    provider_description = "Connect one European bank at a time through your own Enable Banking application."
    in_beta = True
    authorizes_at_bank = True
    credential_fields = (
        CredentialField(APPLICATION_ID_FIELD, "Application ID", "Paste the application ID", 64),
        CredentialField(
            PRIVATE_KEY_FIELD,
            "Private key",
            "Paste the key or drop the .pem file here",
            MAX_PRIVATE_KEY_LENGTH,
            file_extension=".pem",
        ),
        CredentialField(COUNTRY_FIELD, "Country", "Two-letter code, such as FI", 2),
        CredentialField(BANK_FIELD, "Bank", "The bank's name as Enable Banking lists it", MAX_BANK_LENGTH),
    )
    connect_steps = (
        "Please sign in at enablebanking.com, open the Control Panel and register a production application, keeping its .pem key file.",
        "Please add {redirect_url} to the application's redirect URLs.",
        "Please press Activate by linking accounts, then link each account you want at your bank.",
        "Please paste the application ID and the key, or drop the .pem file onto Private key, then give the bank's country and name.",
        "Please go to your bank to sign in. Lumina Finance never sees your bank login.",
    )

    # Banks share up to two years of history, and some hold less
    history_limit_months = 24
    advertises_history = False
    revisit_overlap_days = 14

    # A first import reads all its history in one window right after the bank account is linked, since a
    # bank often shares full history only for about an hour after sign-in. The window spans the whole
    # history limit, counting the month an import starts in
    max_window_days = 31 * (history_limit_months + 1)

    # Reading POST /sessions touches no bank data, so a claim spends none of the day's reads
    claim_is_counted = False
    daily_request_budget = ENABLE_BANKING_DAILY_REQUESTS
    connects_from = ConnectsFrom.SETTINGS

    @override
    @classmethod
    def on_startup(cls) -> None:
        warn_if_test_origin_set()

    def __init__(self, guard: OutboundGuard | None = None) -> None:
        """Build the adapter over Enable Banking, or over a guard tests supply

        Args:
            guard: The guard requests go through
        """
        self._guard = guard or OutboundGuard([ENABLE_BANKING_ORIGIN], ENABLE_BANKING_TEST_ORIGIN)
        self._api_url = httpx.URL(ENABLE_BANKING_TEST_ORIGIN or ENABLE_BANKING_ORIGIN)

    @override
    async def claim(self, supplied: Mapping[str, str]) -> str:
        raise ClaimRefused(_CLAIM_REFUSED_MESSAGE)

    @override
    async def start_authorization(self, supplied: Mapping[str, str], *, redirect_url: str, state: str) -> str:
        application_id, private_key, country, bank = _read_fields(supplied)
        token = _token(application_id, private_key)
        try:
            listed = read_aspsps(await self._request("GET", "/aspsps", token, params=[("country", country)]))
            chosen = next((aspsp for aspsp in listed if aspsp.name.casefold() == bank.casefold()), None)
            if chosen is None:
                raise ClaimRefused(_UNKNOWN_BANK_MESSAGE.format(bank=bank, country=country), fields=_BANK_FIELDS)
            consent = timedelta(seconds=chosen.maximum_consent_validity) if chosen.maximum_consent_validity else _DEFAULT_CONSENT
            valid_until = datetime.now(UTC) + min(consent, _MAX_CONSENT)
            body = json.dumps(
                {
                    "access": {"valid_until": valid_until.isoformat()},
                    "aspsp": {"name": chosen.name, "country": chosen.country},
                    "state": state,
                    "redirect_url": redirect_url,
                    "psu_type": "personal",
                }
            ).encode()
            return read_auth_url(await self._request("POST", "/auth", token, content=body))
        except UnreadableResponse:
            raise ProviderUnreachable(_CLAIM_UNREACHABLE_MESSAGE) from None
        except _Failed as failed:
            if failed.code == _REDIRECT_REFUSED:
                raise ClaimRefused(_REDIRECT_MESSAGE.format(url=redirect_url)) from None
            raise _refusal(failed, ClaimRefused(_START_REFUSED_MESSAGE, fields=_BANK_FIELDS)) from None

    @override
    async def claim_authorized(self, supplied: Mapping[str, str], *, code: str) -> str:
        application_id, private_key, country, bank = _read_fields(supplied)
        token = _token(application_id, private_key)
        try:
            session = read_session(await self._request("POST", "/sessions", token, content=json.dumps({"code": code}).encode()))
        except UnreadableResponse:
            raise ProviderUnreachable(_CLAIM_UNREACHABLE_MESSAGE) from None
        except _Failed as failed:
            if failed.code in _CODE_SPENT:
                raise ClaimRefused(_CODE_SPENT_MESSAGE) from None
            raise _refusal(failed, ClaimRefused(_CODE_SPENT_MESSAGE)) from None
        credential = _Credential(
            application_id,
            private_key,
            session.session_id,
            session.aspsp.name if session.aspsp else bank,
            session.aspsp.country if session.aspsp else country,
            tuple(session.accounts),
        )
        stored = json.dumps(
            {
                APPLICATION_ID_FIELD: credential.application_id,
                PRIVATE_KEY_FIELD: credential.private_key,
                "session_id": credential.session_id,
                BANK_FIELD: credential.bank_name,
                COUNTRY_FIELD: credential.country,
                "accounts": [account.model_dump(mode="json") for account in credential.accounts],
            }
        )
        if not credential.accounts:
            # Through the engine's best-effort release, so a session that can't be ended changes nothing the user is told
            await release_credential(self, stored)
            raise ClaimRefused(_NO_ACCOUNTS_MESSAGE)
        return stored

    @override
    async def release_credential(self, credential: str) -> None:
        stored = _credential_of(credential)
        try:
            await self._request("DELETE", f"/sessions/{stored.session_id}", _token(stored.application_id, stored.private_key))
        except _Failed as failed:
            # A session already gone is what was wanted
            if failed.status != 404 and failed.code not in _SESSION_OVER:
                raise

    @override
    def server_host(self, credential: str) -> str:
        return self._api_url.host

    @override
    async def discover(self, credential: str, *, currency_exponents: Mapping[str, int]) -> FetchResult:
        stored = _credential_of(credential)
        read_at = _read_time()
        try:
            reads = await self._each(stored.accounts, lambda account: self._read_balances(stored, account))
        except _Failed as failed:
            return FetchResult(request_error=failed.error)
        return _result_of(stored, stored.accounts, reads, currency_exponents, read_at)

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
            raise ValueError("An Enable Banking window needs timezone-aware start and end times")
        elapsed = end.astimezone(UTC) - start.astimezone(UTC)
        if not timedelta(0) < elapsed <= timedelta(days=self.max_window_days):
            raise ValueError(f"An Enable Banking window must end after it starts and span at most {self.max_window_days} days")

        stored = _credential_of(credential)
        read_at = _read_time()
        wanted = tuple(account for account in stored.accounts if account.identification_hash in account_ids)
        today = read_at.astimezone(timezone).date()
        request_from = start.astimezone(UTC).date() - _DATE_MARGIN
        window = _Window(
            first_day=start.astimezone(timezone).date(),
            last_day=(end - timedelta(microseconds=1)).astimezone(timezone).date(),
            request_from=request_from,
            # A bank may refuse an end date that hasn't begun, and Enable Banking reads dates in UTC, so
            # the cap is the bank's today, not the user's
            request_to=min(end.astimezone(UTC).date() + _DATE_MARGIN, read_at.date()),
            today=today,
            timezone=timezone,
            include_pending=include_pending,
            reads_history=request_from <= read_at.date() - timedelta(days=_SHARED_DAYS),
        )
        try:
            reads = await self._each(wanted, lambda account: self._read_account(stored, account, window, currency_exponents))
        except _Failed as failed:
            return FetchResult(request_error=failed.error)

        result = _result_of(stored, wanted, reads, currency_exponents, read_at)
        missing = {
            account_id: ProviderError(ProviderErrorKind.UNKNOWN, _MISSING_ACCOUNT_MESSAGE)
            for account_id in account_ids
            if account_id not in {account.identification_hash for account in stored.accounts}
        }
        is_cut_off = any(isinstance(read, _AccountRead) and read.is_cut_off for read in reads)
        skipped = sum(read.skipped for read in reads if isinstance(read, _AccountRead))
        warnings = [*result.warnings]
        if is_cut_off:
            warnings.append(ProviderError(ProviderErrorKind.UNKNOWN, _CUT_OFF_MESSAGE))
        if skipped:
            message = _SKIPPED_ONE_MESSAGE if skipped == 1 else _SKIPPED_MESSAGE.format(count=skipped)
            warnings.append(ProviderError(ProviderErrorKind.UNKNOWN, message))
        return FetchResult(
            accounts=result.accounts,
            account_errors={**result.account_errors, **missing},
            warnings=tuple(warnings),
            possibly_cut_off=is_cut_off,
        )

    async def _read_balances(self, stored: _Credential, account: WireAccount) -> _AccountRead:
        """Read one account's balances

        Raises:
            _Failed: A request failed or an answer couldn't be read
        """
        return _AccountRead(await self._balances_of(stored, account), (), is_cut_off=False)

    async def _balances_of(self, stored: _Credential, account: WireAccount) -> Balances:
        """Read the booked and the available balance of one account"""
        token = _token(stored.application_id, stored.private_key)
        try:
            return read_balances(await self._request("GET", f"/accounts/{account.uid}/balances", token))
        except UnreadableResponse:
            raise _Failed(ProviderError(ProviderErrorKind.UNKNOWN, _UNREADABLE_MESSAGE)) from None

    async def _read_account(
        self, stored: _Credential, account: WireAccount, window: _Window, currency_exponents: Mapping[str, int]
    ) -> _AccountRead:
        """Read one account's balances and every page of its transactions in the window"""
        balances = await self._balances_of(stored, account)
        currency_raw = account.currency or ""
        currency = currency_raw if is_iso_currency_code(currency_raw) else None
        exponent = exponent_of(account, currency_exponents)
        records: list[ProviderRecord] = []
        repeats: Counter[str] = Counter()
        # The longest strategy ignores date_to and reads up to today, so the records after the window are dropped as they are read
        asked: list[tuple[str, str]] = (
            [("date_from", window.request_from.isoformat()), ("strategy", "longest")]
            if window.reads_history
            else [("date_from", window.request_from.isoformat()), ("date_to", window.request_to.isoformat())]
        )
        # Every page after the first repeats the first request's parameters, as Enable Banking requires
        params = asked
        seen: set[str] = set()
        skipped = 0
        for _ in range(MAX_PAGES_PER_HISTORY_READ if window.reads_history else MAX_PAGES_PER_ACCOUNT):
            token = _token(stored.application_id, stored.private_key)
            body = await self._request("GET", f"/accounts/{account.uid}/transactions", token, params=params)
            try:
                page = read_transaction_page(
                    body,
                    currency=currency,
                    currency_raw=currency_raw,
                    exponent=exponent,
                    timezone=window.timezone,
                    first_day=window.first_day,
                    last_day=window.last_day,
                    include_pending=window.include_pending,
                    repeats=repeats,
                    today=window.today,
                )
            except UnreadableResponse:
                raise _Failed(ProviderError(ProviderErrorKind.UNKNOWN, _UNREADABLE_MESSAGE)) from None
            records.extend(page.records)
            skipped += page.skipped
            if page.continuation_key is None:
                return _AccountRead(balances, tuple(records), is_cut_off=False, skipped=skipped)

            # A key the bank repeats would loop for ever, so it is refused as unreadable
            if page.continuation_key in seen:
                raise _Failed(ProviderError(ProviderErrorKind.UNKNOWN, _UNREADABLE_MESSAGE))
            seen.add(page.continuation_key)
            params = [*asked, ("continuation_key", page.continuation_key)]
        return _AccountRead(balances, tuple(records), is_cut_off=True, skipped=skipped)

    async def _each[T](self, accounts: Sequence[WireAccount], read: Callable[[WireAccount], Awaitable[T]]) -> list[T | _Failed]:
        """Run a read for each account, a few at a time, keeping a failure under its own entry

        A failure that ends the request stops the reads not yet started, since the key or the
        quota they would be sent with has just been refused

        Returns:
            The result or failure of each account, in the order of the accounts

        Raises:
            _Failed: A failure that ends the request
        """
        slots = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)
        ended: _Failed | None = None

        async def run(account: WireAccount) -> T | _Failed:
            """Run one read once a slot is free"""
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
        return results

    async def _request(
        self, method: str, path: str, token: str, *, params: Sequence[tuple[str, str]] | None = None, content: bytes | None = None
    ) -> bytes:
        """Send one request and return the body of a 200 answer

        Raises:
            _Failed: The request didn't reach Enable Banking, or the answer wasn't a 200
        """
        url = self._api_url.copy_with(path=path)
        headers = {"User-Agent": _USER_AGENT, "Accept": "application/json", "Authorization": f"Bearer {token}"}
        if content is not None:
            headers["Content-Type"] = "application/json"
        try:
            response = await self._guard.send(method, url, headers=headers, params=params, content=content)

        # The environment no longer allows the server this connection was made with, or a
        # development instance allows only its fake. Neither says anything about the key, so the
        # connection isn't marked for reconnecting and its owner isn't emailed
        except OriginRefused:
            raise _Failed(
                ProviderError(ProviderErrorKind.UNKNOWN, _SERVER_NOT_ALLOWED_MESSAGE.format(host=url.host)),
                ends_request=True,
                is_server_refused=True,
            ) from None
        except AddressRefused:
            logger.warning("Refused to reach Enable Banking at %s because it resolves to an address that isn't public", url.host)
            raise _Failed(ProviderError(ProviderErrorKind.TEMPORARY, _UNREACHABLE_MESSAGE), ends_request=True) from None
        except ResponseTooLargeError:
            raise _Failed(ProviderError(ProviderErrorKind.UNKNOWN, _UNREADABLE_MESSAGE)) from None

        # A lookup or connection that ran out of time never reached Enable Banking
        except httpx.ConnectTimeout:
            raise _Failed(ProviderError(ProviderErrorKind.TEMPORARY, _UNREACHABLE_MESSAGE)) from None
        except httpx.TimeoutException:
            raise _Failed(ProviderError(ProviderErrorKind.TEMPORARY, _TIMED_OUT_MESSAGE)) from None
        except httpx.RequestError:
            raise _Failed(ProviderError(ProviderErrorKind.TEMPORARY, _UNREACHABLE_MESSAGE)) from None
        if response.status_code != 200:
            raise _status_failure(response)
        return response.content


@dataclass(frozen=True)
class _Window:
    """The days one fetch covers, in the user's timezone, and what to ask Enable Banking for"""

    first_day: date
    last_day: date
    request_from: date
    request_to: date
    today: date
    timezone: ZoneInfo
    include_pending: bool

    # Whether the window starts further back than many banks share, so it is read with the longest strategy
    reads_history: bool


def _read_time() -> datetime:
    """Return when a read is made, which dates its balances and decides how far back it reaches

    Signed tokens keep their own clock, since Enable Banking checks them against the real time
    """
    return datetime.now(UTC)


def _read_fields(supplied: Mapping[str, str]) -> tuple[str, str, str, str]:
    """Return the application ID, the private key as a PEM, the country and the bank name

    Raises:
        ClaimRefused: A field can't be what it names
    """
    application_id = supplied[APPLICATION_ID_FIELD].strip()
    try:
        application_id = str(uuid.UUID(application_id))
    except ValueError:
        raise ClaimRefused(_BAD_ID_MESSAGE, fields=(APPLICATION_ID_FIELD,)) from None
    country = supplied[COUNTRY_FIELD].strip()
    if not _COUNTRY.fullmatch(country):
        raise ClaimRefused(_BAD_COUNTRY_MESSAGE, fields=(COUNTRY_FIELD,))
    bank = supplied[BANK_FIELD].strip()
    if not bank or len(bank) > MAX_BANK_LENGTH:
        raise ClaimRefused(_BAD_BANK_MESSAGE, fields=(BANK_FIELD,))
    return application_id, _read_private_key(supplied[PRIVATE_KEY_FIELD]), country.upper(), bank


def _read_private_key(text: str) -> str:
    """Return a pasted RSA private key as a PEM, whether its lines were kept, joined by spaces or run together

    Raises:
        ClaimRefused: The text isn't an unencrypted RSA private key
    """
    found = _PRIVATE_KEY.search(text)
    if found is None:
        raise ClaimRefused(_BAD_KEY_MESSAGE, fields=(PRIVATE_KEY_FIELD,))
    label, body = found.group(1), re.sub(r"\s+", "", found.group(2))
    lines = [body[start : start + _PEM_LINE_LENGTH] for start in range(0, len(body), _PEM_LINE_LENGTH)]
    pem = "\n".join([f"-----BEGIN {label}-----", *lines, f"-----END {label}-----"]) + "\n"
    try:
        key = load_pem_private_key(pem.encode(), password=None)
    except ValueError, TypeError, UnsupportedAlgorithm:
        raise ClaimRefused(_BAD_KEY_MESSAGE, fields=(PRIVATE_KEY_FIELD,)) from None
    if not isinstance(key, RSAPrivateKey):
        raise ClaimRefused(_BAD_KEY_MESSAGE, fields=(PRIVATE_KEY_FIELD,))
    return pem


def _token(application_id: str, private_key: str) -> str:
    """Sign the short-lived token a request carries, naming the application as the key's ID"""
    issued = datetime.now(UTC)
    claims = {
        "iss": "enablebanking.com",
        "aud": "api.enablebanking.com",
        "iat": int(issued.timestamp()),
        "exp": int((issued + _TOKEN_LIFETIME).timestamp()),
    }
    return jwt.encode(claims, private_key, algorithm="RS256", headers={"kid": application_id})


def _credential_of(credential: str) -> _Credential:
    """Return what a stored credential holds"""
    stored = json.loads(credential)
    return _Credential(
        stored[APPLICATION_ID_FIELD],
        stored[PRIVATE_KEY_FIELD],
        stored["session_id"],
        stored[BANK_FIELD],
        stored[COUNTRY_FIELD],
        tuple(WireAccount.model_validate(account) for account in stored["accounts"]),
    )


def _result_of(
    stored: _Credential,
    accounts: Sequence[WireAccount],
    reads: Sequence[_AccountRead | _Failed],
    currency_exponents: Mapping[str, int],
    read_at: datetime,
) -> FetchResult:
    """Return what the reads of the accounts found, with the error of each that failed under its own entry"""
    found: list[ExternalAccount] = []
    account_errors: dict[str, ProviderError] = {}
    for account, read in zip(accounts, reads, strict=True):
        if isinstance(read, _Failed):
            account_errors[account.identification_hash] = read.error
            continue
        found.append(
            external_account(
                account,
                institution_key=stored.institution_key,
                institution_name=stored.bank_name,
                balances=read.balances,
                currency_exponents=currency_exponents,
                balance_at=read_at,
                records=read.records,
            )
        )
    return FetchResult(accounts=tuple(found), account_errors=account_errors)


def _refusal(failed: _Failed, refused: ClaimRefused) -> ClaimRefused | ProviderUnreachable:
    """Return what a failed request while connecting means to the user

    Args:
        failed: The failure
        refused: The refusal when Enable Banking refused the request for a reason that isn't the key's
    """
    if failed.error.kind is ProviderErrorKind.CREDENTIAL_REJECTED:
        if failed.code == "ASPSP_PSU_ACTION_REQUIRED":
            return ClaimRefused(_BANK_ACTION_CLAIM_MESSAGE)
        return ClaimRefused(_REJECTED_MESSAGE, fields=(APPLICATION_ID_FIELD, PRIVATE_KEY_FIELD))
    if failed.is_server_refused:
        return ClaimRefused(failed.error.reason)
    if failed.status is not None and 400 <= failed.status < 500 and failed.status != 429:
        return refused
    return ProviderUnreachable(_CLAIM_UNREACHABLE_MESSAGE)


def _status_failure(response: httpx.Response) -> _Failed:
    """Return the failure an answer with a status other than 200 stands for"""
    status = response.status_code
    code = _error_code(response)

    # The edge in front of Enable Banking answers its own failures with an HTML page that says nothing about the key
    if code in _SESSION_OVER or (status in (401, 403) and not _is_html(response)):
        return _Failed(
            ProviderError(ProviderErrorKind.CREDENTIAL_REJECTED, _CREDENTIAL_REJECTED_MESSAGE), ends_request=True, status=status, code=code
        )
    if code == "ASPSP_RATE_LIMIT_EXCEEDED":
        return _Failed(ProviderError(ProviderErrorKind.RATE_LIMITED, _BANK_LIMITED_MESSAGE), status=status, code=code)
    if status == 429:
        return _Failed(ProviderError(ProviderErrorKind.RATE_LIMITED, _RATE_LIMITED_MESSAGE), ends_request=True, status=status, code=code)

    # The user signs in again by connecting again, since Enable Banking has no sign-in of its own to go back to
    if code == "ASPSP_PSU_ACTION_REQUIRED":
        return _Failed(ProviderError(ProviderErrorKind.CREDENTIAL_REJECTED, _BANK_ACTION_MESSAGE), ends_request=True, status=status, code=code)
    if code in ("ASPSP_TIMEOUT", "ASPSP_ERROR"):
        return _Failed(ProviderError(ProviderErrorKind.TEMPORARY, _BANK_UNAVAILABLE_MESSAGE), status=status, code=code)
    if status in (401, 403) or status >= 500:
        return _Failed(ProviderError(ProviderErrorKind.TEMPORARY, _UNREACHABLE_MESSAGE), status=status, code=code)
    return _Failed(ProviderError(ProviderErrorKind.UNKNOWN, _UNREADABLE_MESSAGE), status=status, code=code)


def _error_code(response: httpx.Response) -> str | None:
    """Return the error code Enable Banking's answer carries, or None when it carries none"""
    try:
        body = response.json()
    except ValueError:
        return None
    code = body.get("error") if isinstance(body, dict) else None
    return code if isinstance(code, str) else None


def _is_html(response: httpx.Response) -> bool:
    """Return whether a response is an HTML page rather than an answer from Enable Banking itself"""
    return "html" in response.headers.get("content-type", "").lower() or response.text.lstrip().startswith("<")
