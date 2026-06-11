import pytest

from app.services import app_version


async def test_update_checks_skip_when_disabled(monkeypatch):
    """Disabled update checks skip release checks"""
    monkeypatch.setattr(app_version, "APP_VERSION", "1.2.3")
    monkeypatch.setattr(app_version, "UPDATE_CHECKS_ENABLED", False)
    monkeypatch.setattr(app_version, "_update_check_cache", None)

    async def fetch_release(_client):
        raise AssertionError("Unexpected GitHub release check")

    monkeypatch.setattr(app_version, "_fetch_latest_github_release", fetch_release)

    assert await app_version.get_available_update() is None


async def test_update_checks_skip_when_installed_version_is_missing(monkeypatch):
    """Missing installed versions skip release checks"""
    monkeypatch.setattr(app_version, "APP_VERSION", "")
    monkeypatch.setattr(app_version, "UPDATE_CHECKS_ENABLED", True)
    monkeypatch.setattr(app_version, "_update_check_cache", None)

    async def fetch_release(_client):
        raise AssertionError("Unexpected GitHub release check")

    monkeypatch.setattr(app_version, "_fetch_latest_github_release", fetch_release)

    assert await app_version.get_available_update() is None


async def test_update_ignores_suffixed_release_tag(monkeypatch):
    """Suffixed release tags do not trigger updates"""
    monkeypatch.setattr(app_version, "APP_VERSION", "1.2.3")
    monkeypatch.setattr(app_version, "UPDATE_CHECKS_ENABLED", True)
    monkeypatch.setattr(app_version, "_update_check_cache", None)

    async def fetch_release(_client):
        return {
            "tag_name": "v1.3.0-canary",
            "html_url": "https://github.com/Lumina-Finance/lumina-finance/releases/tag/v1.3.0-canary",
        }

    async def docker_tag_exists(_docker_tag, _client):
        raise AssertionError("Unexpected Docker tag check")

    monkeypatch.setattr(app_version, "_fetch_latest_github_release", fetch_release)
    monkeypatch.setattr(app_version, "_docker_tag_exists", docker_tag_exists)

    assert await app_version.get_available_update() is None


async def test_update_requires_matching_docker_tag(monkeypatch):
    """Available updates require a matching Docker tag"""
    monkeypatch.setattr(app_version, "APP_VERSION", "1.2.3")
    monkeypatch.setattr(app_version, "UPDATE_CHECKS_ENABLED", True)
    monkeypatch.setattr(app_version, "_update_check_cache", None)
    checked_docker_tags = []

    async def fetch_release(_client):
        return {
            "tag_name": "v1.3.0",
            "html_url": "https://github.com/Lumina-Finance/lumina-finance/releases/tag/v1.3.0",
        }

    async def docker_tag_exists(docker_tag, _client):
        checked_docker_tags.append(docker_tag)
        return False

    monkeypatch.setattr(app_version, "_fetch_latest_github_release", fetch_release)
    monkeypatch.setattr(app_version, "_docker_tag_exists", docker_tag_exists)

    assert await app_version.get_available_update() is None
    assert checked_docker_tags == ["1.3.0"]


@pytest.mark.parametrize(
    ("installed_version", "release_tag", "expected_version"),
    [
        ("1.2.3", "v2.0.0", "2.0.0"),
        ("1.2.3", "v1.3.0", "1.3.0"),
        ("1.2.3", "v1.2.4", "1.2.4"),
        ("1.9.0", "v1.10.0", "1.10.0"),
    ],
)
async def test_update_detects_newer_release_versions(
    monkeypatch,
    installed_version,
    release_tag,
    expected_version,
):
    """Available updates detect newer release versions"""
    monkeypatch.setattr(app_version, "APP_VERSION", installed_version)
    monkeypatch.setattr(app_version, "UPDATE_CHECKS_ENABLED", True)
    monkeypatch.setattr(app_version, "_update_check_cache", None)
    release_url = f"https://github.com/Lumina-Finance/lumina-finance/releases/tag/{release_tag}"
    checked_docker_tags = []

    async def fetch_release(_client):
        return {
            "tag_name": release_tag,
            "html_url": release_url,
        }

    async def docker_tag_exists(docker_tag, _client):
        checked_docker_tags.append(docker_tag)
        return True

    monkeypatch.setattr(app_version, "_fetch_latest_github_release", fetch_release)
    monkeypatch.setattr(app_version, "_docker_tag_exists", docker_tag_exists)

    assert await app_version.get_available_update() == {
        "version": expected_version,
        "release_url": release_url,
    }
    assert checked_docker_tags == [expected_version]


async def test_update_check_result_is_cached(monkeypatch):
    """Update check results are cached"""
    monkeypatch.setattr(app_version, "APP_VERSION", "1.2.3")
    monkeypatch.setattr(app_version, "UPDATE_CHECKS_ENABLED", True)
    monkeypatch.setattr(app_version, "_update_check_cache", None)
    release_check_count = 0
    docker_check_count = 0

    async def fetch_release(_client):
        nonlocal release_check_count
        release_check_count += 1
        return {
            "tag_name": "v1.3.0",
            "html_url": "https://github.com/Lumina-Finance/lumina-finance/releases/tag/v1.3.0",
        }

    async def docker_tag_exists(_docker_tag, _client):
        nonlocal docker_check_count
        docker_check_count += 1
        return True

    monkeypatch.setattr(app_version, "_fetch_latest_github_release", fetch_release)
    monkeypatch.setattr(app_version, "_docker_tag_exists", docker_tag_exists)

    first_update = await app_version.get_available_update()
    second_update = await app_version.get_available_update()

    assert first_update == second_update
    assert release_check_count == 1
    assert docker_check_count == 1
