"""Source address on the abuse log lines for sign-in, sign-up and reset requests"""

import json

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from tests.routes.support import SIGNUP_PAYLOAD, _create_user, _seed_currency

_CLIENT_ADDRESS = "203.0.113.9"
_FORGED_ADDRESS = "198.51.100.7"
_WRONG_PASSWORD = "wrong-password-1"


def _client_from(address: str) -> AsyncClient:
    """Return a test client whose requests arrive from the given address"""
    transport = ASGITransport(app=app, client=(address, 51000))
    return AsyncClient(transport=transport, base_url="http://test")


async def test_failed_sign_ins_log_the_address_in_one_form(abuse_log_lines):
    """Three failed sign-ins from one address write three lines holding that address and no email"""
    async with _client_from(_CLIENT_ADDRESS) as client:
        for _ in range(3):
            response = await client.post("/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": _WRONG_PASSWORD})
            assert response.status_code == 401

    assert len(abuse_log_lines) == 3
    for line in abuse_log_lines:
        assert json.loads(line)["ip"] == _CLIENT_ADDRESS
        assert json.loads(line)["route"] == "/auth/login"
        assert SIGNUP_PAYLOAD["email"] not in line
        assert _WRONG_PASSWORD not in line


async def test_a_successful_sign_in_logs_nothing(client, abuse_log_lines):
    """A correct sign-in is not counted toward a ban, so it writes no line"""
    await _create_user(client)
    abuse_log_lines.clear()

    async with _client_from(_CLIENT_ADDRESS) as from_address:
        response = await from_address.post("/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": SIGNUP_PAYLOAD["password"]})

    assert response.status_code == 200
    assert abuse_log_lines == []


@pytest.mark.parametrize(
    ("path", "payload"),
    [
        ("/auth/signup", {key: value for key, value in SIGNUP_PAYLOAD.items() if key != "password"}),
        ("/auth/password/forgot", {"email": SIGNUP_PAYLOAD["email"]}),
    ],
)
async def test_sign_up_and_reset_requests_log_the_address_whatever_the_outcome(abuse_log_lines, path, payload):
    """Each sign-up and reset request counts toward a ban, even one that succeeds"""
    await _seed_currency()
    async with _client_from(_CLIENT_ADDRESS) as client:
        response = await client.post(path, json=payload)

    assert response.status_code == 204
    assert len(abuse_log_lines) == 1
    assert json.loads(abuse_log_lines[0])["ip"] == _CLIENT_ADDRESS
    assert SIGNUP_PAYLOAD["email"] not in abuse_log_lines[0]


async def test_other_routes_log_nothing(abuse_log_lines):
    """A request to any other route writes no abuse line"""
    async with _client_from(_CLIENT_ADDRESS) as client:
        await client.get("/health")
        await client.get("/no-such-path")

    assert abuse_log_lines == []


async def test_a_forged_forwarding_header_does_not_change_the_logged_address(abuse_log_lines):
    """The address is the connection's own: a client cannot name a different one with a header"""
    async with _client_from(_CLIENT_ADDRESS) as client:
        await client.post(
            "/auth/login",
            json={"email": SIGNUP_PAYLOAD["email"], "password": _WRONG_PASSWORD},
            headers={"X-Forwarded-For": _FORGED_ADDRESS, "Forwarded": f"for={_FORGED_ADDRESS}", "X-Real-IP": _FORGED_ADDRESS},
        )

    assert json.loads(abuse_log_lines[0])["ip"] == _CLIENT_ADDRESS
    assert _FORGED_ADDRESS not in abuse_log_lines[0]
