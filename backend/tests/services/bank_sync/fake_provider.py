"""A scripted bank provider for testing the provider-neutral sync engine

Tests queue the exact outcomes they need, including ones SimpleFIN never produces, such as a
removed record, and read back the requests the engine made
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import override
from zoneinfo import ZoneInfo

from app.models.bank_connection import ConnectsFrom
from app.services.bank_sync.providers.contract import (
    ClaimRefused,
    FetchResult,
    ProviderAdapter,
)


@dataclass(frozen=True)
class FetchCall:
    """One fetch the engine asked the fake for"""

    credential: str
    account_ids: tuple[str, ...]
    start: datetime
    end: datetime
    include_pending: bool


class FakeProviderAdapter(ProviderAdapter):
    """Answers each operation from what the test queued, in order"""

    provider_id = "fake"
    provider_name = "Fake Bank"
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

        # Answers to discover and fetch alike, given out in order
        self.outcomes: list[FetchResult] = []
        self.discoveries: list[str] = []
        self.fetches: list[FetchCall] = []

    @override
    async def claim(self, supplied_credential: str) -> str:
        outcome = self.claimable.pop(supplied_credential, None)
        if outcome is None:
            raise ClaimRefused("This setup token has already been used. Create a new one in SimpleFIN Bridge")
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    @override
    async def discover(self, credential: str, *, currency_exponents: Mapping[str, int]) -> FetchResult:
        self.discoveries.append(credential)
        return self.outcomes.pop(0)

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
        return self.outcomes.pop(0)
