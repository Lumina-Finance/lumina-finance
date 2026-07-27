"""OIDC provider environment seeding tests"""

from sqlalchemy import select

from app.config.oidc import OidcProviderConfig
from app.encryption import decrypt
from app.models.oidc import OidcProvider
from app.services.auth.oidc_providers import sync_oidc_providers
from tests.conftest import TestSession


def _config(slug: str = "test-idp", **overrides) -> OidcProviderConfig:
    """Return a provider declaration with defaults suitable for seeding tests"""
    values = {
        "slug": slug,
        "display_name": "Test IdP",
        "issuer": "https://idp.test",
        "client_id": "client-123",
        "client_secret": "secret-abc",
        "scopes": "openid email profile",
        **overrides,
    }
    return OidcProviderConfig(**values)


async def _get_provider(slug: str) -> OidcProvider | None:
    """Return the stored provider row for a slug"""
    async with TestSession() as session:
        result = await session.execute(select(OidcProvider).where(OidcProvider.slug == slug))
        return result.scalar_one_or_none()


async def test_sync_inserts_declared_provider():
    """A declared provider is inserted with its secret encrypted at rest"""
    async with TestSession() as session:
        await sync_oidc_providers(session, [_config()])

    provider = await _get_provider("test-idp")
    assert provider is not None
    assert provider.enabled is True
    assert provider.issuer == "https://idp.test"
    assert provider.client_secret_encrypted != "secret-abc"
    assert decrypt(provider.client_secret_encrypted) == "secret-abc"


async def test_sync_updates_existing_provider_in_place():
    """Redeclaring a slug updates the row so credential rotations apply on restart"""
    async with TestSession() as session:
        await sync_oidc_providers(session, [_config()])
    async with TestSession() as session:
        await sync_oidc_providers(session, [_config(client_id="rotated-id", client_secret="rotated-secret")])

    provider = await _get_provider("test-idp")
    assert provider.client_id == "rotated-id"
    assert decrypt(provider.client_secret_encrypted) == "rotated-secret"


async def test_sync_disables_removed_provider():
    """A provider dropped from the environment is disabled rather than deleted"""
    async with TestSession() as session:
        await sync_oidc_providers(session, [_config()])
    async with TestSession() as session:
        await sync_oidc_providers(session, [])

    provider = await _get_provider("test-idp")
    assert provider is not None
    assert provider.enabled is False


async def test_sync_reenables_redeclared_provider():
    """A disabled provider comes back when its slug is declared again"""
    async with TestSession() as session:
        await sync_oidc_providers(session, [_config()])
    async with TestSession() as session:
        await sync_oidc_providers(session, [])
    async with TestSession() as session:
        await sync_oidc_providers(session, [_config()])

    provider = await _get_provider("test-idp")
    assert provider.enabled is True
