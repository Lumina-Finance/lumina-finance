"""A scripted provider that connects by signing in at the bank, for testing the engine's bank-return flow

It stands in for any provider with authorizes_at_bank set, so the flow's tests need no real provider.
Tests queue the codes the bank may send back and read what the engine asked of it
"""

import asyncio
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import override

from app.services.bank_sync.providers.contract import ClaimRefused, CredentialField
from tests.services.bank_sync.fake_provider import FakeProviderAdapter

# The id this provider is installed under. Test connections made through the flow store it
AUTHORIZING_PROVIDER = "signin_bank"

# The key of its one credential field
APPLICATION_KEY = "application_key"


@dataclass(frozen=True)
class StartCall:
    """One sign-in the engine asked the provider to start"""

    supplied: Mapping[str, str]
    redirect_url: str
    state: str


class AuthorizingProviderAdapter(FakeProviderAdapter):
    """Answers a bank sign-in from what the test queued, and lists the accounts of the fake provider once connected"""

    provider_id = AUTHORIZING_PROVIDER
    provider_name = "Sign-in Bank"
    provider_site = "Sign-in Bank Developer Portal"
    provider_description = "Sign in at your bank to share every account you hold there."
    credential_fields = (CredentialField(APPLICATION_KEY, "Application key", "Paste the key", 512),)
    connect_steps = ("Register this address: {redirect_url}",)
    authorizes_at_bank = True

    def __init__(self) -> None:
        """Start with no sign-in started and no code claimable"""
        super().__init__()

        # Each code the bank may send back claims once, giving its stored credential or raising its error
        self.codes: dict[str, str | Exception] = {}
        self.starts: list[StartCall] = []
        self.start_error: Exception | None = None
        self.authorized: list[tuple[Mapping[str, str], str]] = []
        self.released: list[str] = []
        self.release_error: Exception | None = None

        # Seconds a release takes to answer, for a provider that is slow to take an access back
        self.release_delay = 0.0

        # Runs inside claim_authorized, after the provider has been asked and before it answers, such
        # as a disconnect that lands while the provider is answering
        self.while_claiming: Callable[[], Awaitable[None]] | None = None

    @override
    async def claim(self, supplied: Mapping[str, str]) -> str:
        raise ClaimRefused("Sign-in Bank connects by signing in at your bank")

    @override
    async def start_authorization(self, supplied: Mapping[str, str], *, redirect_url: str, state: str) -> str:
        self.starts.append(StartCall(dict(supplied), redirect_url, state))
        if self.start_error is not None:
            raise self.start_error
        return f"https://bank.example/sign-in?state={state}"

    @override
    async def claim_authorized(self, supplied: Mapping[str, str], *, code: str) -> str:
        self.authorized.append((dict(supplied), code))
        if self.while_claiming is not None:
            await self.while_claiming()
        outcome = self.codes.pop(code, None)
        if outcome is None:
            raise ClaimRefused("Sign-in Bank didn't accept this sign-in. Please connect again")
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    @override
    async def release_credential(self, credential: str) -> None:
        await asyncio.sleep(self.release_delay)
        self.released.append(credential)
        if self.release_error is not None:
            raise self.release_error
