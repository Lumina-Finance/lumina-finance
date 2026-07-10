"""OIDC provider seeding and lookup service"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import OidcProviderConfig
from app.encryption import encrypt
from app.models.oidc import OidcProvider


async def sync_oidc_providers(db: AsyncSession, configs: list[OidcProviderConfig]) -> None:
    """Reconcile the provider table with the environment declarations

    Declared providers are inserted or updated in place by slug, so credential rotations apply
    on restart. Rows no longer declared are disabled rather than deleted so linked identities
    survive a temporary removal and re-enabling needs no relinking

    Args:
        db: Active database session
        configs: Provider declarations parsed from the environment
    """
    # Load every row once so the reconcile is a single read followed by targeted writes
    result = await db.execute(select(OidcProvider))
    existing_by_slug = {provider.slug: provider for provider in result.scalars()}

    for config in configs:
        provider = existing_by_slug.get(config.slug)
        if provider is None:
            provider = OidcProvider(slug=config.slug)
            db.add(provider)
        provider.display_name = config.display_name
        provider.issuer = config.issuer
        provider.client_id = config.client_id
        provider.client_secret_encrypted = encrypt(config.client_secret)
        provider.scopes = config.scopes
        provider.enabled = True

    declared_slugs = {config.slug for config in configs}
    for slug, provider in existing_by_slug.items():
        if slug not in declared_slugs:
            provider.enabled = False

    await db.commit()


async def list_enabled_oidc_providers(db: AsyncSession) -> list[OidcProvider]:
    """Return enabled providers for the sign-in page, oldest declaration first

    Args:
        db: Active database session

    Returns:
        Enabled provider rows in a stable order
    """
    providers_query = (
        select(OidcProvider).where(OidcProvider.enabled).order_by(OidcProvider.created_at, OidcProvider.slug)
    )

    # List the providers whose sign-in buttons the login page offers
    result = await db.execute(providers_query)
    return list(result.scalars())


async def get_enabled_oidc_provider_by_slug(db: AsyncSession, slug: str) -> OidcProvider | None:
    """Return an enabled provider by its slug

    Args:
        db: Active database session
        slug: Provider slug from the request path

    Returns:
        The enabled provider row when one matches
    """
    provider_query = select(OidcProvider).where(OidcProvider.slug == slug, OidcProvider.enabled)

    # Resolve the provider a sign-in attempt names, ignoring disabled rows
    result = await db.execute(provider_query)
    return result.scalar_one_or_none()


async def get_enabled_oidc_provider_by_id(db: AsyncSession, provider_id: uuid.UUID) -> OidcProvider | None:
    """Return an enabled provider by its identifier

    Args:
        db: Active database session
        provider_id: Provider identifier stored on a pending authorization request

    Returns:
        The enabled provider row when one matches
    """
    provider_query = select(OidcProvider).where(OidcProvider.id == provider_id, OidcProvider.enabled)

    # Resolve the provider a callback belongs to, refusing one disabled mid-flight
    result = await db.execute(provider_query)
    return result.scalar_one_or_none()
