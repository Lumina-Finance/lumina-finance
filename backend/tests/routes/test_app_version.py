from app.routes import app_version


async def test_get_app_version_returns_installed_version(client, monkeypatch):
    """Version endpoint returns the installed app version"""
    monkeypatch.setattr(app_version, "APP_VERSION", "1.2.3")

    async def get_available_update():
        return None

    monkeypatch.setattr(app_version, "get_available_update", get_available_update)

    response = await client.get("/version")

    assert response.status_code == 200
    assert response.json() == {
        "version": "1.2.3",
        "update": None,
    }


async def test_get_app_version_returns_available_update(client, monkeypatch):
    """Version endpoint returns available update metadata"""
    monkeypatch.setattr(app_version, "APP_VERSION", "1.2.3")

    async def get_available_update():
        return {
            "version": "1.3.0",
            "release_url": "https://github.com/Lumina-Finance/lumina-finance/releases/tag/v1.3.0",
        }

    monkeypatch.setattr(app_version, "get_available_update", get_available_update)

    response = await client.get("/version")

    assert response.status_code == 200
    assert response.json() == {
        "version": "1.2.3",
        "update": {
            "version": "1.3.0",
            "release_url": "https://github.com/Lumina-Finance/lumina-finance/releases/tag/v1.3.0",
        },
    }
