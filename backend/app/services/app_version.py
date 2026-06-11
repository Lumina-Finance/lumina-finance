"""Application version update checks"""

import re
import time

import httpx

from app.config import APP_VERSION, UPDATE_CHECKS_ENABLED

GITHUB_LATEST_RELEASE_URL = "https://api.github.com/repos/Lumina-Finance/lumina-finance/releases/latest"
DOCKER_TAG_URL_TEMPLATE = "https://hub.docker.com/v2/repositories/luminahq/lumina-finance/tags/{tag}"
UPDATE_CHECK_CACHE_SECONDS = 6 * 60 * 60

_VERSION_PATTERN = re.compile(r"^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
_update_check_cache: tuple[str, float, dict[str, str] | None] | None = None


async def get_available_update(client: httpx.AsyncClient | None = None) -> dict[str, str] | None:
    """Return update metadata when a newer Docker image is available

    Args:
        client: Optional reusable HTTP client

    Returns:
        Update metadata, or None when no update should be shown
    """
    global _update_check_cache

    installed_version_match = _VERSION_PATTERN.fullmatch(APP_VERSION.strip())
    if installed_version_match is None or not UPDATE_CHECKS_ENABLED:
        return None

    installed_version = tuple(int(version_number) for version_number in installed_version_match.groups())
    installed_version_tag = ".".join(str(version_number) for version_number in installed_version)

    # Reuse the last result for this installed version so every sidebar render avoids external calls
    if _update_check_cache is not None:
        cached_installed_tag, expires_at, cached_update = _update_check_cache
        if cached_installed_tag == installed_version_tag and expires_at > time.monotonic():
            return cached_update

    github_release_payload = await _fetch_latest_github_release(client)
    if github_release_payload is None:
        _update_check_cache = (installed_version_tag, time.monotonic() + UPDATE_CHECK_CACHE_SECONDS, None)
        return None

    # Only stable x.x.x release tags are valid, with an optional GitHub v prefix
    github_release_tag = github_release_payload.get("tag_name")
    release_notes_url = github_release_payload.get("html_url")
    release_version_match = _VERSION_PATTERN.fullmatch(str(github_release_tag).strip())
    if release_version_match is None or not isinstance(release_notes_url, str):
        _update_check_cache = (installed_version_tag, time.monotonic() + UPDATE_CHECK_CACHE_SECONDS, None)
        return None

    # Tags are compared as numbers so 1.10.0 sorts after 1.9.0
    release_version = tuple(int(version_number) for version_number in release_version_match.groups())
    release_version_tag = ".".join(str(version_number) for version_number in release_version)
    if release_version <= installed_version:
        _update_check_cache = (installed_version_tag, time.monotonic() + UPDATE_CHECK_CACHE_SECONDS, None)
        return None

    # The update is only available once the matching Docker image tag exists
    if not await _docker_tag_exists(release_version_tag, client):
        _update_check_cache = (installed_version_tag, time.monotonic() + UPDATE_CHECK_CACHE_SECONDS, None)
        return None

    update_metadata = {
        "version": release_version_tag,
        "release_url": release_notes_url,
    }
    _update_check_cache = (installed_version_tag, time.monotonic() + UPDATE_CHECK_CACHE_SECONDS, update_metadata)
    return update_metadata


async def _fetch_latest_github_release(client: httpx.AsyncClient | None) -> dict | None:
    """Fetch the latest GitHub release payload

    Args:
        client: Optional reusable HTTP client

    Returns:
        Latest GitHub release payload, or None when it cannot be fetched
    """
    should_close_client = client is None
    http_client = client or httpx.AsyncClient(timeout=5.0)

    try:
        # GitHub is the source for the latest release candidate
        github_response = await http_client.get(GITHUB_LATEST_RELEASE_URL)
        github_response.raise_for_status()
        return github_response.json()
    except Exception:
        return None
    finally:
        if should_close_client:
            await http_client.aclose()


async def _docker_tag_exists(docker_tag: str, client: httpx.AsyncClient | None) -> bool:
    """Return whether the exact Docker Hub image tag exists

    Args:
        docker_tag: Normalised Docker image tag
        client: Optional reusable HTTP client

    Returns:
        Whether the exact Docker Hub image tag exists
    """
    should_close_client = client is None
    http_client = client or httpx.AsyncClient(timeout=5.0)

    try:
        # Docker Hub must have the exact normalised version tag before users see an update
        docker_response = await http_client.head(DOCKER_TAG_URL_TEMPLATE.format(tag=docker_tag))
        return docker_response.status_code == httpx.codes.OK
    except Exception:
        return False
    finally:
        if should_close_client:
            await http_client.aclose()
