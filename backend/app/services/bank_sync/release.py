"""Giving a provider back a credential the app no longer keeps

Best effort and never part of the work it follows: the credential is already replaced, unused or gone
with its connection, so a provider that can't be reached is no reason to fail what the user asked for
"""

import asyncio
import logging
from collections.abc import Sequence

from app.encryption import decrypt
from app.services.bank_sync.availability import adapter_for
from app.services.bank_sync.outbound import outside_time_budget
from app.services.bank_sync.providers.contract import ProviderAdapter

logger = logging.getLogger(__name__)

# How long a provider has to take a credential back. A disconnect has already committed when it asks, and
# the browser gives up on a request after 30 seconds, so a slow provider mustn't make a disconnect that
# worked look as though it failed
RELEASE_TIMEOUT_SECONDS = 5.0


async def release_credential(adapter: ProviderAdapter, credential: str) -> None:
    """Give a plain credential back to its provider, ignoring any failure and giving up after a few seconds"""
    # A stalled provider can spend a request's time budget before its claim fails or a reconnect
    # replaces a credential, and the access is still worth ending then, within this shorter limit
    try:
        with outside_time_budget():
            async with asyncio.timeout(RELEASE_TIMEOUT_SECONDS):
                await adapter.release_credential(credential)
    except Exception:
        # Best-effort: the provider ends what it holds open by itself in time, and the user's request has been served
        logger.warning("Could not release a credential held by the %s provider", adapter.provider_id, exc_info=True)


async def release_stored_credential(provider_id: str, encrypted: str) -> None:
    """Give back a credential as a connection stored it, unless the provider's folder is gone"""
    adapter = adapter_for(provider_id)
    if adapter is None:
        return
    try:
        credential = decrypt(encrypted)
    except Exception:
        # Best-effort: a credential that can't be read can't be given back, and nothing else depends on it
        logger.warning("Could not read a stored credential to release it to the %s provider", provider_id, exc_info=True)
        return
    await release_credential(adapter, credential)


async def release_stored_credentials(credentials: Sequence[tuple[str, str]]) -> None:
    """Give back several stored credentials at once, so the wait is one provider's time limit rather than the sum

    Args:
        credentials: Each connection's provider and its credential as stored
    """
    await asyncio.gather(*(release_stored_credential(provider, encrypted) for provider, encrypted in credentials))
