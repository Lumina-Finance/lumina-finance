"""A scripted bank provider for testing the provider-neutral sync engine

Tests queue the exact outcomes they need, including ones a real provider may never produce, such as
a removed record, and read back the requests the engine made. A fetch gives each bank account asked
for that its outcome leaves out an error of its own, as the contract has every provider do. Every
test runs with it installed under FAKE_PROVIDER, enabled and offered, so engine and route tests need
no real provider
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from typing import override
from zoneinfo import ZoneInfo

import pytest

from app.models.bank_connection import ConnectsFrom
from app.models.bank_sync_job import ProviderErrorKind
from app.services.bank_sync.availability import InstalledProvider, installed_providers
from app.services.bank_sync.providers.contract import (
    ClaimRefused,
    CredentialField,
    ExternalAccount,
    FetchResult,
    ProviderAdapter,
    ProviderError,
    ProviderRecord,
)

# The id the fake provider is installed under, which test connections, links and bank transactions store
FAKE_PROVIDER = "fake"

# The key the fake provider's one credential field is sent under
ACCESS_KEY = "access_key"


def use_adapter(monkeypatch: pytest.MonkeyPatch, adapter: ProviderAdapter, *, enabled: bool = True, offered: bool = True) -> None:
    """Install an adapter under its provider id for the test, with the deployment switches given"""
    monkeypatch.setitem(installed_providers(), adapter.provider_id, InstalledProvider(adapter=adapter, enabled=enabled, offered=offered))


def remove_provider(monkeypatch: pytest.MonkeyPatch, provider_id: str) -> None:
    """Leave a provider uninstalled for the test, as though its folder were deleted"""
    monkeypatch.delitem(installed_providers(), provider_id, raising=False)


@dataclass(frozen=True)
class FetchCall:
    """One fetch the engine asked the fake for"""

    credential: str
    account_ids: tuple[str, ...]
    start: datetime
    end: datetime
    include_pending: bool


class FakeProviderAdapter(ProviderAdapter):
    """Answers each operation from what the test queued, in order, leaving pending records out of a fetch that didn't ask for them"""

    provider_id = FAKE_PROVIDER
    provider_name = "Fake Bank"
    display_order = 0
    provider_site = "Fake Bank Online"
    provider_description = "One access key reaches every account you hold at Fake Bank."
    credential_fields = (CredentialField(ACCESS_KEY, "Access key", "Paste the key", 512),)
    connect_steps = ("Sign in to Fake Bank Online.", "Create an access key and paste it here.")
    history_limit_months = 12
    advertises_history = False
    revisit_overlap_days = 14
    max_window_days = 90
    daily_request_budget = 20
    connects_from = ConnectsFrom.SETTINGS

    def __init__(self) -> None:
        """Start with nothing claimable and no outcomes queued"""
        # Each supplied credential claims once, giving its stored credential or raising its error
        self.claimable: dict[str, str | Exception] = {}

        # Every set of credentials the engine handed to claim, in order
        self.claims: list[dict[str, str]] = []

        # Answers to discover and fetch alike, given out in order, an error raised in place of an answer
        self.outcomes: list[FetchResult | Exception] = []
        self.discoveries: list[str] = []
        self.fetches: list[FetchCall] = []

    @override
    async def claim(self, supplied: Mapping[str, str]) -> str:
        self.claims.append(dict(supplied))
        outcome = self.claimable.pop(supplied[ACCESS_KEY], None)
        if outcome is None:
            raise ClaimRefused("This access key has already been used. Create a new one in Fake Bank Online")
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    @override
    def server_host(self, credential: str) -> str:
        return "fake-bank.example"

    @override
    async def discover(self, credential: str, *, currency_exponents: Mapping[str, int]) -> FetchResult:
        self.discoveries.append(credential)
        return self._next_outcome()

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
        self.fetches.append(FetchCall(credential, tuple(account_ids), start, end, include_pending))
        outcome = self._next_outcome()
        if outcome.request_error is not None:
            return outcome

        # A provider not asked for pending records sends none
        accounts = outcome.accounts
        if not include_pending:
            accounts = tuple(
                replace(account, records=tuple(record for record in account.records if not record.pending)) for account in accounts
            )
        returned = {account.external_id for account in accounts}
        left_out = ProviderError(ProviderErrorKind.TEMPORARY, f"{self.provider_name} didn't return this account")
        missing = {
            account_id: left_out for account_id in account_ids if account_id not in returned and account_id not in outcome.account_errors
        }
        return replace(outcome, accounts=accounts, account_errors={**outcome.account_errors, **missing})

    def _next_outcome(self) -> FetchResult:
        """Give out the next queued answer, or raise it when it is an error"""
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def _bank_account(
    external_id: str,
    login_key: str = "CON-harbour",
    records: Sequence[ProviderRecord] = (),
    currency: str | None = "CAD",
    currency_raw: str | None = None,
) -> ExternalAccount:
    """Return a bank account as the provider lists it, in its account's currency unless told otherwise, with the records a fetch brought back

    The provider sends a currency's code as it is, unless told otherwise
    """
    return ExternalAccount(
        external_id=external_id,
        name=external_id,
        institution_key="ORG-harbour",
        institution_name="Harbour Bank",
        login_key=login_key,
        currency=currency,
        currency_raw=currency_raw or currency,
        balance=100_00,
        available_balance=None,
        balance_at=datetime(2026, 10, 4, tzinfo=UTC),
        records=tuple(records),
    )


def _returned(*external_ids: str) -> FetchResult:
    """Return a response bringing back each bank account whole"""
    return FetchResult(accounts=tuple(_bank_account(external_id) for external_id in external_ids))
