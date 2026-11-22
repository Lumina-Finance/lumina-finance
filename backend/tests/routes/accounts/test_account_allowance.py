"""What the allowance check does to account creation, the full table every other record kind's route repeats one case of

A refusal answers 403 with the deployment's own sentence and creates nothing. A check that raises is a
fault in the deployment's code, so the request fails as any server fault does and creates nothing
"""

from httpx import ASGITransport, AsyncClient

from app.allowance_hook import AllowanceKind, AllowanceRequest, Refusal, set_allowance_check
from app.main import app
from tests.routes.accounts._account_helpers import _create_second_user
from tests.routes.support import _create_account, _create_user, _get_auth_header
from tests.routes.support.allowance_helpers import ALLOWANCE_REASON, install_check


async def _account_names(client, headers) -> list[str]:
    """Return the names of the user's accounts"""
    return [account["name"] for account in (await client.get("/accounts", headers=headers)).json()]


async def test_create_account_refused_by_the_check_says_the_deployments_reason_and_creates_nothing(client):
    """The sentence the deployment gave is what the user reads, and the account isn't there afterwards"""
    headers = _get_auth_header(await _create_user(client))
    install_check(refused={AllowanceKind.ACCOUNT})

    refused = await _create_account(client, headers)

    assert refused.status_code == 403, refused.text
    assert refused.json()["detail"] == ALLOWANCE_REASON
    assert await _account_names(client, headers) == []


async def test_create_account_at_the_limit_is_refused_until_one_is_deleted(client):
    """The check is told what the user holds and is adding, and deleting an account makes room for another"""
    headers = _get_auth_header(await _create_user(client))
    asked = install_check(maximum=1)

    first = await _create_account(client, headers, name="First")
    second = await _create_account(client, headers, name="Second")
    deleted = await client.delete(f"/accounts/{first.json()['id']}", headers=headers)
    third = await _create_account(client, headers, name="Third")

    assert [response.status_code for response in (first, second, deleted, third)] == [201, 403, 204, 201]
    assert [(request.kind, request.held, request.adding) for request in asked] == [(AllowanceKind.ACCOUNT, held, 1) for held in (0, 1, 0)]
    assert await _account_names(client, headers) == ["Third"]


async def test_create_account_counts_an_archived_account_until_it_is_deleted(client):
    """Archiving gives no room back at the limit, and only deleting the archived account does"""
    headers = _get_auth_header(await _create_user(client))
    asked = install_check(maximum=1)
    first = await _create_account(client, headers, name="First")
    archived = await client.patch(f"/accounts/{first.json()['id']}", json={"is_archived": True}, headers=headers)

    second = await _create_account(client, headers, name="Second")
    deleted = await client.delete(f"/accounts/{first.json()['id']}", headers=headers)
    third = await _create_account(client, headers, name="Third")

    assert [response.status_code for response in (first, archived, second, deleted, third)] == [201, 200, 403, 204, 201]
    assert [request.held for request in asked] == [0, 1, 0]


async def test_create_account_counts_only_the_users_own_accounts(client):
    """Another user holding an account doesn't use up this user's room"""
    headers = _get_auth_header(await _create_user(client))
    other_headers = _get_auth_header(await _create_second_user(client))
    await _create_account(client, other_headers, name="Theirs")
    asked = install_check(maximum=1)

    created = await _create_account(client, headers, name="Mine")

    assert created.status_code == 201, created.text
    assert [request.held for request in asked] == [0]


async def test_create_account_with_a_check_that_raises_fails_as_a_server_fault_and_creates_nothing(client):
    """A deployment's check that errors never lets the account in, and the user is shown the usual server fault"""
    headers = _get_auth_header(await _create_user(client))

    async def check(request: AllowanceRequest) -> Refusal | None:
        raise ConnectionError("The plan service is down")

    set_allowance_check(check)
    async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test") as failing_client:
        failed = await _create_account(failing_client, headers)

    assert failed.status_code == 500
    assert await _account_names(client, headers) == []
