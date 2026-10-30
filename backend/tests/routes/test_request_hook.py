from httpx import ASGITransport, AsyncClient

from app.main import app
from app.request_hook import UNMATCHED_ROUTE
from tests.routes.support import SIGNUP_PAYLOAD, _create_account, _create_user, _get_auth_header

_SERVER_ERROR_PATH = "/test/server-error"

_OVERSIZED_BODY = b"x" * (10 * 1024 * 1024 + 1)


@app.get(_SERVER_ERROR_PATH)
async def _test_server_error():
    """Test-only route failing the way an unhandled bug does"""
    raise RuntimeError("deliberate failure")


async def test_signed_in_request_tells_observers_the_route_template(client, request_records):
    """A signed-in request carries the route's template, not the account's ID"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    account_id = (await _create_account(client, headers)).json()["id"]
    request_records.clear()

    response = await client.get(f"/accounts/{account_id}", headers=headers)

    assert response.status_code == 200
    assert len(request_records) == 1
    record = request_records[0]
    assert (record.method, record.route, record.status) == ("GET", "/accounts/{account_id}", 200)
    assert account_id not in repr(record.route)


async def test_sign_in_request_carries_no_user_and_no_email(client, request_records):
    """A sign-in names its route, and the email typed is nowhere on the record"""
    response = await client.post("/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": "wrong-password-1"})

    assert response.status_code == 401
    assert len(request_records) == 1
    record = request_records[0]
    assert (record.method, record.route, record.status) == ("POST", "/auth/login", 401)
    assert SIGNUP_PAYLOAD["email"] not in repr(record.route)


async def test_unhandled_error_still_reaches_observers_as_a_500(request_records):
    """A request ending in an unhandled error is reported with status 500 and the time taken"""
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as failing_client:
        response = await failing_client.get(_SERVER_ERROR_PATH)

    assert response.status_code == 500
    assert len(request_records) == 1
    assert request_records[0].status == 500
    assert request_records[0].route == _SERVER_ERROR_PATH
    assert request_records[0].duration_seconds >= 0


async def test_unmatched_path_gets_the_placeholder_and_not_the_path(client, request_records):
    """A path no route matches is reported with the placeholder, never the path or its query string"""
    response = await client.get("/wp-admin/secret-probe?token=hunter2")

    assert response.status_code == 404
    assert request_records[0].status == 404
    assert request_records[0].route == UNMATCHED_ROUTE


async def test_request_refused_before_routing_still_reaches_observers(client, request_records):
    """A request an inner layer refuses, such as an oversized body, is still reported"""
    response = await client.post("/health", content=_OVERSIZED_BODY)

    assert response.status_code == 413
    assert request_records[0].status == 413
