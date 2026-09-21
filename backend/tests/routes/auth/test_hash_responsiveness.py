"""Authentication hashing must leave the event loop available for other requests"""

import asyncio
import importlib
import threading

import pytest

from tests.routes.support import SIGNUP_PAYLOAD, _create_user, _seed_currency


@pytest.mark.parametrize(
    ("service", "primitive", "path", "existing_user", "expected_status"),
    [
        ("signup", "hash_password", "/auth/signup", False, 201),
        ("login", "is_password_valid", "/auth/login", True, 200),
        ("login", "hash_dummy_password_for_timing", "/auth/login", False, 401),
    ],
)
async def test_currency_request_completes_while_auth_hash_is_pending(
    client, monkeypatch, service, primitive, path, existing_user, expected_status
):
    """Hold real password work in its worker and complete a separate request before releasing it"""
    if existing_user:
        await _create_user(client)
    else:
        await _seed_currency()

    module = importlib.import_module(f"app.services.auth.{service}")
    original = getattr(module, primitive)
    loop = asyncio.get_running_loop()
    loop_thread = threading.get_ident()
    entered = asyncio.Event()
    release = threading.Event()

    def held_hash(*args):
        assert threading.get_ident() != loop_thread, "Password work blocked the event-loop thread"
        loop.call_soon_threadsafe(entered.set)
        assert release.wait(timeout=10), "Password worker was not released"
        return original(*args)

    monkeypatch.setattr(module, primitive, held_hash)
    payload = SIGNUP_PAYLOAD if service == "signup" else {
        "email": SIGNUP_PAYLOAD["email"], "password": SIGNUP_PAYLOAD["password"],
    }
    request = asyncio.create_task(client.post(path, json=payload))
    waiting = asyncio.create_task(entered.wait())
    try:
        async with asyncio.timeout(10):
            done, _ = await asyncio.wait({request, waiting}, return_when=asyncio.FIRST_COMPLETED)
            if request in done:
                await request
                pytest.fail("Authentication completed before its password worker was released")
            response = await client.get("/currencies")
            assert response.status_code == 200
            assert not request.done()
    finally:
        release.set()
        waiting.cancel()
        await asyncio.gather(waiting, return_exceptions=True)
        response = await request

    assert response.status_code == expected_status
