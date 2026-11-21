"""Two start-up steps, the database key check and the sign-in provider seeding

Each is a point in app.extension that code outside the app can run alone. The lifespan in app.main
sets the order of every start-up step
"""

import logging

from app.config.oidc import OIDC_PROVIDER_CONFIGS
from app.database import async_session, engine
from app.db.bank_transaction_key import verify_key_matches_hashes
from app.db.encryption_key import verify_key_matches_data
from app.services.auth.oidc_providers import sync_oidc_providers

logger = logging.getLogger(__name__)


async def verify_database_keys() -> None:
    """Fail startup unless the encryption key and the bank transaction hash key are the ones the database was made with

    The OIDC seeding rewrites the client secret under whatever key resolved, so a process holding the
    wrong one would mix two keys inside that column. The container entrypoint checks this too, and the
    app's lifespan runs this step before the seeding. Code serving the app without the lifespan gets the
    check only by running this step itself
    """
    async with engine.connect() as connection:
        await verify_key_matches_data(connection)

        # A missing key would refuse every OFX import, and another key than the hashes were made
        # with would let every statement imported again bring back what is already saved
        await verify_key_matches_hashes(connection)


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
