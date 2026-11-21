"""The sign-in provider seeding, a start-up step

It is a point in app.extension that code outside the app can run alone. The lifespan in app.main
sets the order of every start-up step
"""

import logging

from app.config.oidc import OIDC_PROVIDER_CONFIGS
from app.database import async_session
from app.services.auth.oidc_providers import sync_oidc_providers

logger = logging.getLogger(__name__)


async def sync_sign_in_providers() -> None:
    """Reconcile the sign-in provider table with the environment, then log which providers are on

    Runs on every boot so credential rotations and removals apply without a migration
    """
    async with async_session() as session:
        await sync_oidc_providers(session, OIDC_PROVIDER_CONFIGS)

    if OIDC_PROVIDER_CONFIGS:
        enabled_slugs = ", ".join(provider.slug for provider in OIDC_PROVIDER_CONFIGS)
        logger.info("OIDC sign-in enabled for: %s", enabled_slugs)
    else:
        logger.info("OIDC sign-in is not configured")
