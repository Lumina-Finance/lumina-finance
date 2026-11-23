"""What the allowance check does to account creation, the full table every other record kind's route repeats one case of

A refusal answers 403 with the check's own sentence and creates nothing. A check that raises is a
fault in the installed code, so the request fails as any server fault does and creates nothing
"""

import asyncio
import contextlib

from httpx import ASGITransport, AsyncClient

from app.allowance_hook import AllowanceKind, AllowanceRequest, Refusal, set_allowance_check
from app.main import app
from tests.routes.accounts._account_helpers import _create_second_user
from tests.routes.support import _account_names, _create_account, _create_user, _get_auth_header
from tests.routes.support.allowance_helpers import ALLOWANCE_REASON, install_check
from tests.routes.support.authorization_helpers import _sign_up_other_user

# How long a check waits for another request to join it, long enough for a loaded host to start both
_PARTNER_WAIT_SECONDS = 3


def _install_check_waiting_for_another_request_with_a_maximum_of_one() -> list[int]:
    """Install a check that waits after being asked for a second request to be asked too, then refuses what would pass one account

    A request holding the user's lock keeps the second out of the check, so the wait ends only by
    running out. The returned list holds the number of requests inside the check as each one
    enters, so its largest value says how many were in it together
    """
    running = 0
    asked = 0
    partner_arrived = asyncio.Event()
    overlaps: list[int] = []

    async def check(request: AllowanceRequest) -> Refusal | None:
        nonlocal running, asked
        running += 1
        asked += 1
        overlaps.append(running)
        if asked == 2:
            partner_arrived.set()
        try:
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(partner_arrived.wait(), _PARTNER_WAIT_SECONDS)
            return Refusal(ALLOWANCE_REASON) if request.held + request.adding > 1 else None
        finally:
            running -= 1

    set_allowance_check(check)
    return overlaps


async def test_create_account_refused_by_the_check_says_the_checks_reason_and_creates_nothing(client):
    """The sentence the check gave is what the user reads, and the account isn't there afterwards"""
    headers = _get_auth_header(await _create_user(client))
    install_check(refused={AllowanceKind.ACCOUNT})

    refused = await _create_account(client, headers)

    assert refused.status_code == 403, refused.text
    assert refused.json()["detail"] == ALLOWANCE_REASON
    assert await _account_names(client, headers) == []


async def test_create_account_refused_by_a_check_allowing_one_passes_once_one_is_deleted(client):
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
    """An archived account still counts for the check, and only deleting it lets another in"""
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
    """A check that errors never lets the account in, and the user is shown the usual server fault"""
    headers = _get_auth_header(await _create_user(client))

    async def check(request: AllowanceRequest) -> Refusal | None:
        raise ConnectionError("The check failed")

    set_allowance_check(check)
    async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test") as failing_client:
        failed = await _create_account(failing_client, headers)

    assert failed.status_code == 500
    assert await _account_names(client, headers) == []


async def test_two_creates_at_once_under_a_check_allowing_one_let_exactly_one_in(client):
    """The second request waits for the first to end before counting, so it sees the account the first made and is refused"""
    headers = _get_auth_header(await _create_user(client))
    overlaps = _install_check_waiting_for_another_request_with_a_maximum_of_one()

    responses = await asyncio.gather(_create_account(client, headers, name="First"), _create_account(client, headers, name="Second"))

    assert sorted(response.status_code for response in responses) == [201, 403]
    assert max(overlaps) == 1, "both requests were inside the check together, so nothing held the second back"
    assert len(await _account_names(client, headers)) == 1


async def test_two_users_creating_at_once_do_not_wait_for_each_other(client):
    """The lock is the user's own, so a second user's create runs beside the first's and both get their account"""
    headers = _get_auth_header(await _create_user(client))
    other_headers, _ = await _sign_up_other_user(client)
    overlaps = _install_check_waiting_for_another_request_with_a_maximum_of_one()

    responses = await asyncio.gather(_create_account(client, headers, name="Mine"), _create_account(client, other_headers, name="Theirs"))

    assert [response.status_code for response in responses] == [201, 201]
    assert max(overlaps) == 2, "one user's create waited for the other's"
